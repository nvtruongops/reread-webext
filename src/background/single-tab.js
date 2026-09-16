/**
 * One extension page, one tab: pressing the row that leads to a page this
 * extension owns brings the existing tab forward instead of opening a copy -
 * and, since D147, turns a tab showing another of this extension's pages to
 * the one asked for before it opens a fresh tab at all.
 *
 * The reader lives this way (`reader-tab.js`) and so do the saved-phrases
 * page and the settings (`room-tab.js`), each remembered under its own
 * `storage.session` key - `src/lib/session.js` says why session storage and
 * nothing longer-lived.
 *
 * Nothing here needs the `tabs` permission. Selecting a tab and focusing a
 * window are allowed without it, and so is finding out that a tab is gone: the
 * call for an id that no longer exists rejects, and that rejection is the test.
 * Finding a page by asking `tabs.query` for its address is what would need
 * one - and would not even work, `moz-extension://` pages being outside
 * `<all_urls>`. Turning a tab to a page of this extension needs none either.
 */

import { tabsShowing, tabsShowingAny } from "../lib/own-tabs.js";

/**
 * The rooms of this extension - the pages a tab may be turned from and to.
 * Not the popup: on Android it is a page in a tab too, and it closes itself
 * the moment it has sent its press, so a tab turned from it would be a tab
 * closing under the page it was just given.
 */
export const ROOM_PAGES = ["reader/reader.html", "vocab/vocab.html", "options/options.html"];

/**
 * Which tab is the page's one tab, checked against what this extension's
 * pages actually are (D140). The stored id names a tab, but a tab is not that
 * page forever: the reader walks to the settings and to the saved phrases in
 * place (D139/D141), and an id left pointing at the walked-away tab made
 * every raise bring forward the wrong page - the page's own sign-out cannot
 * be the only guard, because a last write before leaving is exactly the kind
 * of thing a browser may drop. With a witness, the stored id counts only
 * while the page still lives in that tab, and the page living in some other
 * tab - opened by hand, walked to, or orphaned by a dropped write - is
 * adopted rather than duplicated. Without one, the id is trusted the way it
 * always was.
 *
 * @param {object} where
 * @param {() => Promise<number | null>} where.read the remembered id
 * @param {string} where.url the page the tab must be showing
 * @param {(() => Promise<unknown>) | undefined} where.ask see `tabsShowing`
 * @returns {Promise<number | null>}
 */
export async function tabOnDuty({ read, url, ask }) {
  const stored = await read();
  const seen = await tabsShowing(url, ask);
  if (seen === null) return stored;
  if (stored !== null && seen.includes(stored)) return stored;
  return seen.length > 0 ? (seen[0] ?? null) : null;
}

/**
 * The tabs a page may be turned into when no tab shows it (D147): every tab
 * showing one of this extension's rooms, in the order they are worth
 * trying - the tab the press came from first (a menu row pressed in a room
 * turns that room, the way the reader's own rows have walked in place since
 * D139), the tab remembered for the page next (the one that walked away
 * from it and now shows some other room - the tab that piled up the copies
 * this rule ends), then any other. Nothing without a witness: an engine that
 * cannot say what a tab shows gets a fresh tab, as it always did.
 *
 * @param {object} where
 * @param {(number | null | undefined)[]} where.preferred tab ids worth trying first, in order
 * @param {string[]} where.rooms the rooms, as `runtime.getURL` names them
 * @param {(() => Promise<unknown>) | undefined} where.ask see `tabsShowing`
 * @returns {Promise<number[]>}
 */
export async function adoptable({ preferred, rooms, ask }) {
  const seen = await tabsShowingAny(rooms, ask);
  if (seen === null) return [];
  /** @type {number[]} */
  const first = [];
  for (const id of preferred) {
    if (typeof id === "number" && seen.includes(id)) first.push(id);
  }
  return [...new Set([...first, ...seen])];
}

/**
 * Bringing a tab back rather than opening another one - and, given a page,
 * turning the tab to it on the way. Two calls, because they fail for
 * different reasons: a tab that is gone means try the next one or open a
 * new one, while a window that vanished between the two awaits means
 * nothing at all - the tab is already selected and returning `false` here
 * would open the second copy this module exists to prevent.
 *
 * @param {Pick<WebExtBrowser["tabs"], "update">} tabs
 * @param {WebExtBrowser["windows"]} windows
 * @param {number} id
 * @param {string} [url] the page to turn the tab to; none to raise it as it is
 * @returns {Promise<boolean>} whether the page is now in front of the reader
 */
async function focusTab(tabs, windows, id, url) {
  /** @type {WebExtTab} */
  let tab;
  try {
    tab = await tabs.update(id, url === undefined ? { active: true } : { url, active: true });
  } catch {
    return false;
  }

  // Selected in its own window is not the same as looked at: the page can sit
  // in a window behind this one, and stopping here would look like the button
  // did nothing.
  if (typeof tab.windowId === "number") {
    try {
      await windows.update(tab.windowId, { focused: true });
    } catch {
      // The window closed while we were selecting a tab in it - or this is
      // Android, which has no `windows` API at all. Nothing to do either way:
      // on a phone the selected tab is the visible one already.
    }
  }
  return true;
}

/**
 * @param {object} deps
 * @param {Pick<WebExtBrowser["tabs"], "create" | "update">} deps.tabs
 * @param {WebExtBrowser["windows"]} deps.windows
 * @param {string} deps.url the page, as its tabs are recognized by
 * @param {string} [deps.landing] where to land on it - the page with a fragment
 *   naming a section (D192); the page itself when nothing was asked for
 * @param {() => Promise<number | null>} deps.read which tab it was, last anybody looked
 * @param {(tabId: number | null) => Promise<void>} deps.write
 * @param {() => Promise<number[]>} deps.adopt the tabs worth turning to the page, in order
 *   (`adoptable`), asked only once no tab shows it
 * @returns {Promise<void>}
 */
export async function raiseOrOpen({ tabs, windows, url, landing = url, read, write, adopt }) {
  const known = await read();
  // Raised as it is, unless a place on the page was asked for (D192): then
  // the tab is turned to it - the same document, a fragment on - which is
  // how the settings open at the dictionaries in a tab already showing them.
  if (known !== null && (await focusTab(tabs, windows, known, landing === url ? undefined : landing))) return;

  for (const id of await adopt()) {
    if (await focusTab(tabs, windows, id, landing)) {
      await write(id);
      return;
    }
  }

  const opened = await tabs.create({ url: landing });
  // No id means nothing to come back to, and the id we have is the stale one
  // that just failed. Keeping it would send the next press after a dead tab.
  await write(typeof opened.id === "number" ? opened.id : null);
}
