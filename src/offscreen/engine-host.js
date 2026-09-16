/**
 * The engine host: the offscreen document the Chromium background delegates
 * translation to, because a service worker cannot spawn the engine's worker.
 *
 * It is the direct Bergamot provider, verbatim, moved into a context that has
 * `Worker` - nothing here translates, loads or caches anything itself. Models
 * come out of IndexedDB, which this document shares with every other extension
 * context, so the background's question can be three strings and the answer
 * one `Result`.
 *
 * Firefox never opens this page; its event page runs the same provider
 * in-process. The build ships it only in the Chromium package.
 */

import { webext } from "../lib/browser.js";
import { ErrorCode, fail } from "../lib/protocol.js";
import { asEngineCall, schemeReport } from "../lib/translator/providers/bergamot/host-protocol.js";
import { bergamot } from "../lib/translator/providers/bergamot/index.js";

/**
 * How long a warm engine may sit unasked before this document closes itself
 * and takes the engine's memory with it. The same economics as Firefox's
 * event page dying - a translation after the nap pays the reload, every hour
 * of reading that never happened pays nothing.
 */
const IDLE_LIMIT_MS = 5 * 60_000;

let inFlight = 0;

/** @type {ReturnType<typeof setTimeout> | undefined} */
let idleTimer;

function armIdleClose() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    // A translation can outlast the timer; closing under it would kill the
    // worker mid-sentence. The finished call re-arms.
    if (inFlight === 0) window.close();
  }, IDLE_LIMIT_MS);
}

webext().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // Everything a content script sends the background also lands here; the
  // host answers exactly its own calls and stays silent about the rest, or
  // it would race the background for `sendResponse`.
  const job = asEngineCall(message);
  if (job === null) return false;

  inFlight += 1;
  clearTimeout(idleTimer);
  bergamot
    .translate(job)
    .then(sendResponse, () => sendResponse(fail(ErrorCode.INTERNAL)))
    .finally(() => {
      inFlight -= 1;
      armIdleClose();
    });
  return true;
});

armIdleClose();

// The host's second, incidental job: it is the one page guaranteed to stand
// whenever the background works, and a page can ask what a service worker
// cannot - which color scheme the browser is in. Reported on start (this is
// how the toolbar icon is right moments after the browser launches, see
// `runtime.onStartup` in the background) and again if the scheme flips while
// the engine is warm. Nobody answering is fine: the report is a courtesy.
const media = matchMedia("(prefers-color-scheme: dark)");
const reportScheme = () => {
  void webext().runtime.sendMessage(schemeReport(media.matches)).catch(() => {});
};
reportScheme();
media.addEventListener("change", reportScheme);
