/**
 * The saved-phrases page and the settings as one tab each, not one tab per
 * press.
 *
 * Unlike the reader there is nothing to point either page at: the phrases
 * page shows the vocabulary of the configured pair, and the pair travels
 * through the settings, never through this press; the settings show what
 * they show. So the whole job is the shared half - raise the remembered
 * tab, turn a tab of ours to the page, or open one (`single-tab.js`) -
 * under a `storage.session` key of each page's own (`src/lib/session.js`).
 *
 * The settings joined here in D147. Until then they were the browser's
 * `runtime.openOptionsPage`, which raises a settings tab already open on
 * both engines but knows nothing of the extension's other tabs - so the
 * reader's walk to the settings in place (D139) left a settings tab behind
 * every time the reader was next raised elsewhere, and Michał's tab bar
 * held eight of them (2026-08-29).
 */

import { webext } from "../lib/browser.js";
import { readSettingsTab, readVocabTab, writeSettingsTab, writeVocabTab } from "../lib/session.js";
import { ROOM_PAGES, adoptable, raiseOrOpen, tabOnDuty } from "./single-tab.js";

const VOCAB_PAGE = "vocab/vocab.html";
const SETTINGS_PAGE = "options/options.html";

/**
 * Only the calls this module makes, so the test fake has to fake exactly that
 * much and no more.
 *
 * @typedef {object} RoomTabDeps
 * @property {Pick<WebExtBrowser["tabs"], "create" | "update">} [tabs]
 * @property {WebExtBrowser["windows"]} [windows]
 * @property {WebExtBrowser["storage"]["session"]} [session]
 * @property {string} [url]
 * @property {string[]} [rooms] the extension's rooms, as `runtime.getURL` names
 *   them - injected by the tests
 * @property {number} [from] the tab the press came from, when it came from a
 *   page of this extension: the first tab worth turning to the page (D147)
 * @property {() => Promise<unknown>} [contexts] the extension's own open
 *   contexts, `runtime.getContexts` shaped - injected by the tests
 * @property {string} [section] a section of the page to land on (D192), by
 *   its anchor - the settings at the dictionaries; the top when none
 * @property {string} [text] a phrase for the saved-phrases page to look up on
 *   arrival (D197), in its "Add a phrase" fold - the popup's field's door to
 *   the place where a press on a meaning saves
 */

/**
 * @param {object} room
 * @param {string} room.page the page, relative to the extension's root
 * @param {(session: WebExtBrowser["storage"]["session"]) => Promise<number | null>} room.read
 * @param {(tabId: number | null, session: WebExtBrowser["storage"]["session"]) => Promise<void>} room.write
 * @param {string} [room.fragment] where on the page to land, as the fragment
 *   the page reads - a section's anchor (D192), a phrase to look up (D197)
 * @param {RoomTabDeps} deps
 * @returns {Promise<void>}
 */
async function openRoom({ page, read, write, fragment }, deps) {
  const session = deps.session ?? webext().storage.session;
  const url = deps.url ?? webext().runtime.getURL(page);
  const rooms = deps.rooms ?? ROOM_PAGES.map((room) => webext().runtime.getURL(room));

  await raiseOrOpen({
    tabs: deps.tabs ?? webext().tabs,
    windows: deps.windows ?? webext().windows,
    url,
    // The page is what a tab is recognized by (a fragment on it still starts
    // with it, `tabsShowing`); the landing is where the press asked to be.
    landing: fragment === undefined ? url : `${url}#${fragment}`,
    // The witness, exactly the reader's (D140/D141, `single-tab.js`): since
    // the reader's menu walks to these pages in place, a tab can both stop
    // being the page (it walked on) and start somewhere nobody remembered -
    // the walked-to page is adopted, so a popup press raises it rather than
    // opening a copy beside it.
    read: () => tabOnDuty({ read: () => read(session), url, ask: deps.contexts }),
    // No tab showing the page: one showing another room of ours is turned
    // to it before a fresh tab is opened (D147) - the tab the press came
    // from first, which is how a menu row in the reader or the phrases
    // still walks in place.
    adopt: async () => adoptable({ preferred: [deps.from, await read(session)], rooms, ask: deps.contexts }),
    write: (tabId) => write(tabId, session),
  });
}

/**
 * @param {RoomTabDeps} [deps] injected by the tests; the background passes none
 * @returns {Promise<void>}
 */
export function openVocabulary(deps = {}) {
  // The phrase rides in the fragment the page reads on arrival and on every
  // turn of an open tab (`#lookup=`, `vocab.js`), encoded so that whatever
  // was typed - a space, a hash, a slash - survives the address.
  const fragment = deps.text === undefined ? undefined : `lookup=${encodeURIComponent(deps.text)}`;
  return openRoom({ page: VOCAB_PAGE, read: readVocabTab, write: writeVocabTab, fragment }, deps);
}

/**
 * @param {RoomTabDeps} [deps] injected by the tests; the background passes none
 * @returns {Promise<void>}
 */
export function openSettings(deps = {}) {
  return openRoom({ page: SETTINGS_PAGE, read: readSettingsTab, write: writeSettingsTab, fragment: deps.section }, deps);
}
