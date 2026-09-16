/**
 * The Bergamot provider as the Chromium background sees it: the same engine,
 * reached by message instead of by worker.
 *
 * On Chromium the background is a service worker, and a service worker cannot
 * spawn the engine's worker - the service worker spec forbids nested workers.
 * So the worker lives in an offscreen document (`offscreen/engine-host.js`),
 * and this provider's whole job is to make sure that document exists and to
 * hand it the one question the direct provider would have answered. The host
 * reads models from IndexedDB itself - same extension origin, same database -
 * so only strings ever cross the message boundary, never model bytes.
 */

import { offscreenApi, webext } from "../../../browser.js";
import { ErrorCode, asResult, fail } from "../../../protocol.js";
import { engineCall } from "./host-protocol.js";

const HOST_PAGE = "offscreen/engine-host.html";

/**
 * How often to touch an extension API while a translation is in flight.
 * Chromium stops an idle service worker after 30 seconds, and a background
 * awaiting the host's answer is exactly that idle: the first translation of a
 * session loads a model and can take longer than the limit. A cheap API call
 * resets the clock - the pattern Chrome's own documentation recommends - and
 * it runs only while an answer is owed, so an idle background still sleeps.
 */
const HEARTBEAT_MS = 20_000;

/** @type {Promise<void> | null} */
let creating = null;

/**
 * Creates the offscreen document if it is not standing. Failures are
 * swallowed on purpose: the one expected failure is "a document already
 * exists" - another call won the race, which is what was asked for - and for
 * any real failure the send that follows is the honest reporter.
 *
 * @returns {Promise<void>}
 */
function ensureHost() {
  const offscreen = offscreenApi();
  if (offscreen === null) return Promise.reject(new Error("no offscreen API in this browser"));

  creating ??= offscreen
    .createDocument({
      url: HOST_PAGE,
      reasons: ["WORKERS"],
      justification:
        "Runs the packaged translation engine in a Web Worker; a service worker cannot spawn workers.",
    })
    .catch(() => undefined)
    .finally(() => {
      creating = null;
    });
  return creating;
}

/**
 * The host, raised for its side effects: standing up, it reports the color
 * scheme the toolbar icon should match (see `theme-icon.js`), and after five
 * idle minutes it takes itself down again. The background calls this on
 * browser startup - the one moment the icon is guaranteed stale and no page
 * is open to correct it.
 *
 * @returns {Promise<void>}
 */
export function raiseEngineHost() {
  return ensureHost().catch(() => {});
}

/**
 * One send, with "nobody answered" folded into `undefined`: a missing host
 * rejects when no other extension page is open and resolves with nothing when
 * one is, and the caller has to treat both as the same silence.
 *
 * @param {import("../../index.js").TranslateInput} job
 * @returns {Promise<unknown>}
 */
async function callHost(job) {
  try {
    return await webext().runtime.sendMessage(engineCall(job));
  } catch {
    return undefined;
  }
}

/** @type {import("../../index.js").Provider} */
export const bergamotViaHost = {
  id: "bergamot-offscreen",

  async translate(job) {
    const heartbeat = setInterval(() => {
      void webext()
        .runtime.getPlatformInfo()
        .catch(() => {});
    }, HEARTBEAT_MS);

    try {
      let answer = await callHost(job);
      if (answer === undefined) {
        // No host standing - first translation since the browser started, or
        // the host closed itself after sitting idle. Raise it and ask again.
        await ensureHost();
        answer = await callHost(job);
      }
      // `asResult` turns silence and shapelessness alike into `internal`; a
      // real answer - success or a code like `model_missing` - passes through.
      return /** @type {import("../../../protocol.js").Result<import("../../../protocol.js").Translation>} */ (
        asResult(answer)
      );
    } catch {
      return fail(ErrorCode.INTERNAL);
    } finally {
      clearInterval(heartbeat);
    }
  },
};
