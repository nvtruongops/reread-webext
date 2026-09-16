/**
 * What runs on every page the reader opens.
 *
 * Three things. The first is deciding which of three states this page is in,
 * and it is a hierarchy with silence at the top: a site switched off in the
 * popup gets nothing at all; a page in reader-only mode - or under the
 * translation-off setting, whose ordinary pages have nothing else left to
 * offer - gets the launcher, one listener whose whole offer is "read this in
 * the reader" (`launcher.js`);
 * any other page gets the full reading side - selections, the bubble, keeping
 * a phrase and underlining the ones already kept, all in `reading.js`, because
 * the reader page runs exactly the same code against the article it built
 * (D42). Reader-only is a choice in the settings, and with none made the
 * platform decides: on Android on, elsewhere off - the background publishes
 * which platform this is (`PLATFORM_KEY`), because a content script cannot ask.
 *
 * The second is the deciding itself, kept live. All three inputs live in
 * `storage.local`, so the settings are what this listens to: the popup writes
 * them, the options page writes them, and every open tab of the site notices
 * through the same storage event - which matters, because neither of those
 * pages could address the tabs of one site without the `tabs` permission this
 * extension does not have. On a switched-off site the whole footprint is this
 * listener and the message listener below: no scan, no observer, nothing on
 * the page.
 *
 * The third is the two questions a tab ever answers - the background asking
 * for the page after the reader was pointed here, and the popup asking which
 * site this is. A message listener costs nothing while nobody asks: no timer,
 * no observer, nothing added to the page. It stays on whatever the mode, and
 * has to: it is also how the popup knows what to call this site when offering
 * to switch it back on.
 */

import { webext } from "../lib/browser.js";
import { CONFIG_KEY, PLATFORM_KEY, osFrom, pageMode, withDefaults } from "../lib/config.js";
import { MODELS_KEY, asInventory, needsModelHint } from "../lib/models/inventory.js";
import { ErrorCode, MAX_PAGE_HTML, Message, asPageRequest, fail, ok } from "../lib/protocol.js";
import { pageHtml } from "../lib/reader/page-html.js";
import { MIRROR_KEY } from "../lib/store/mirror.js";
import { setLauncherHint, setLauncherScale, startLauncher, stopLauncher } from "./launcher.js";
import { start, stop } from "./reading.js";

/** @typedef {"off" | "launcher" | "reading"} Mode */

/** @type {Mode} */
let mode = "off";
/** Whether a settings change already decided, making the startup read stale. */
let decided = false;
/** Whether anything has decided yet - what a platform-only event may act on. */
let ready = false;
/** The last word on each input, so either changing can re-decide alone. */
let config = withDefaults(undefined);
let os = "";
/** An event beat the startup read to the os; the older read must not undo it. */
let osKnown = false;
/** Which pairs have a model (`lib/models/inventory.js`); null = nobody has said. */
let inventory = /** @type {import("../lib/models/inventory.js").ModelInventory | null} */ (null);

/**
 * The hierarchy lives in `pageMode` (`lib/config.js`), where `node --test`
 * reaches it: host switched off beats everything, translation switched off
 * and reader-only mode each mean the launcher, and reading is what is left.
 *
 * @returns {Mode}
 */
function decide() {
  return pageMode(config, os, location.hostname);
}

/**
 * @param {Mode} wanted
 * @param {Record<string, unknown>} [stored] the startup read, the one time there is one
 */
function apply(wanted, stored) {
  // Before the early return, because this is also how the settings page
  // reaches a launcher already running (D85): `apply` runs on every settings
  // change, most of which change no mode. The reading side needs no such
  // hand-down - it watches storage itself.
  setLauncherScale(config.bubbleScale / 100);
  // The same hand-down for the model hint: installing the first model has to
  // reach a launcher already standing on an open page, or the offer keeps
  // telling somebody to do what they just did.
  setLauncherHint(needsModelHint(config, inventory));
  if (wanted === mode) return;
  if (mode === "reading") stop();
  if (mode === "launcher") stopLauncher();
  mode = wanted;
  // The whole body, and follow it: a page loads its own content, swaps
  // articles under a router and edits text in place, and underlines have to
  // keep up.
  if (wanted === "reading") start({ root: document.body, observe: true, stored });
  if (wanted === "launcher") startLauncher();
}

// One read of `storage.local` at startup, the same one `reading.js` would have
// made - it decides what to start, and when that is the reading side, feeds it.
void webext()
  .storage.local.get([CONFIG_KEY, MIRROR_KEY, PLATFORM_KEY, MODELS_KEY])
  .then((stored) => {
    if (decided) return;
    config = withDefaults(stored[CONFIG_KEY]);
    if (!osKnown) os = osFrom(stored[PLATFORM_KEY]);
    if (inventory === null) inventory = asInventory(stored[MODELS_KEY]);
    ready = true;
    apply(decide(), stored);
  })
  .catch(() => {
    // Storage unreachable says nothing about this site being switched off, so
    // run: `reading.js` has its own answer to storage being broken.
    if (decided) return;
    ready = true;
    apply("reading");
  });

webext().storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const configChange = changes[CONFIG_KEY];
  const platformChange = changes[PLATFORM_KEY];
  const modelsChange = changes[MODELS_KEY];
  if (configChange === undefined && platformChange === undefined && modelsChange === undefined) {
    return;
  }

  // The platform never changes for a device, but the key can appear once: an
  // update publishes it under pages that loaded before it existed, and on
  // Android that arrival is what flips an open page into reader-only mode.
  if (platformChange !== undefined) {
    os = osFrom(platformChange.newValue);
    osKnown = true;
  }
  // The model inventory changes the launcher's hint, never the mode - so it
  // rides the same re-apply and needs none of the platform's bookkeeping.
  if (modelsChange !== undefined) inventory = asInventory(modelsChange.newValue);
  if (configChange !== undefined) {
    config = withDefaults(configChange.newValue);
    decided = true;
    ready = true;
  }
  // A platform arriving before the config was ever read may not decide alone:
  // it would be deciding over the default settings, on a site somebody may
  // have switched off. It waits the moment the startup read needs, which picks
  // the fresher os up from here.
  if (ready) apply(decide());
});

// The document is serialized as it stands rather than re-downloaded, which is
// what makes the reader work behind a login and on a page built by scripts -
// and what keeps the promise that this extension makes no request of its own.
webext().runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const request = asPageRequest(message);
  if (request === null) return false;

  // Which site this is, said by the page itself: the popup has a tab id and no
  // address, because reading addresses is what the `tabs` permission is for.
  if (request.kind === Message.PAGE_INFO) {
    sendResponse(ok({ hostname: location.hostname }));
    return false;
  }

  // Not the bare `outerHTML`: a page with scripting on keeps `<noscript>` as
  // raw text, which the reader's scriptless parser would read as markup - and
  // one fallback nested in another then swallows the article (`page-html.js`).
  const html = pageHtml(document);
  // Answered on the spot, so `return false` rather than the usual `true`:
  // there is nothing to wait for, and claiming otherwise leaves the background
  // holding a promise nobody will settle.
  sendResponse(
    html.length > MAX_PAGE_HTML
      ? fail(ErrorCode.TOO_LONG)
      : ok({ url: location.href, title: document.title, html }),
  );
  return false;
});
