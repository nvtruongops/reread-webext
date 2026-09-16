/**
 * Everything this extension keeps for the length of a browser session, which is
 * four numbers and nothing else.
 *
 * `storage.local` holds what has to survive a restart - the settings and the
 * copy of the vocabulary pages read. `storage.session` holds what must *not*:
 * tab ids. Ids start over when the browser does, so one written to `local`
 * would name a stranger's tab the next morning, and the toolbar button would
 * jump to it. Session storage lasts exactly as long as a tab id means anything,
 * and it survives the event page being killed, which a variable would not.
 *
 * No key carries anything about what is being read. The page the reader shows
 * travels as one answer to one question and is never written down - the
 * same answer O2 and O3 gave to storing context and source URLs, for the same
 * reason: an address is browsing history, and this extension does not keep any.
 */

import { webext } from "./browser.js";

/** Which tab the reader is, so pressing the button twice does not open two. */
export const READER_TAB_KEY = "readerTabId";

/** Which tab the saved-phrases page is, for the same reason. */
export const VOCAB_TAB_KEY = "vocabTabId";

/**
 * Which tab the settings are, for the same reason - since D147, when the
 * settings stopped being the browser's `openOptionsPage` and joined the
 * other two pages under one rule.
 */
export const SETTINGS_TAB_KEY = "settingsTabId";

/**
 * What the reader was last pointed at, and when: a tab to read, or the
 * highlights page (the menu's row on the pages that are not the reader). The
 * timestamp is not decoration: pressing the button twice on the same page has
 * to reach the reader, and a value that did not change is a
 * `storage.onChanged` that never fires.
 */
export const READER_SOURCE_KEY = "readerSource";

/** @typedef {{ tabId: number, at: number } | { marks: true, at: number }} ReaderSource */

/**
 * The marker the reader leaves in a tab's own `sessionStorage` as it walks to
 * the settings in that same tab (D139/D140), and the settings page's licence
 * to wear its back arrow. Not `storage.session`: the question is "did THIS
 * tab walk here from us", and the tab's own storage is the one store scoped
 * exactly like the question - shared by our two pages (same origin),
 * invisible to every other tab, gone with the tab. The referrer could not be
 * the witness: browsers carry referrers only between http(s) documents, and
 * an extension page's scheme is not one, so it reads empty on both engines
 * (the reason the arrow never showed, Michał's report from Chrome).
 */
export const BACK_ROAD_KEY = "reread.backRoad";

/**
 * @param {string} key
 * @param {WebExtBrowser["storage"]["session"]} session
 * @returns {Promise<number | null>}
 */
async function readTabId(key, session) {
  const stored = await session.get(key);
  const id = stored[key];
  return typeof id === "number" ? id : null;
}

/**
 * @param {string} key
 * @param {number | null} tabId
 * @param {WebExtBrowser["storage"]["session"]} session
 * @returns {Promise<void>}
 */
async function writeTabId(key, tabId, session) {
  if (tabId === null) await session.remove(key);
  else await session.set({ [key]: tabId });
}

/**
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<number | null>}
 */
export async function readReaderTab(session = webext().storage.session) {
  return readTabId(READER_TAB_KEY, session);
}

/**
 * @param {number | null} tabId
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function writeReaderTab(tabId, session = webext().storage.session) {
  await writeTabId(READER_TAB_KEY, tabId, session);
}

/**
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<number | null>}
 */
export async function readVocabTab(session = webext().storage.session) {
  return readTabId(VOCAB_TAB_KEY, session);
}

/**
 * @param {number | null} tabId
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function writeVocabTab(tabId, session = webext().storage.session) {
  await writeTabId(VOCAB_TAB_KEY, tabId, session);
}

/**
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<number | null>}
 */
export async function readSettingsTab(session = webext().storage.session) {
  return readTabId(SETTINGS_TAB_KEY, session);
}

/**
 * @param {number | null} tabId
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function writeSettingsTab(tabId, session = webext().storage.session) {
  await writeTabId(SETTINGS_TAB_KEY, tabId, session);
}

/**
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<ReaderSource | null>}
 */
export async function readReaderSource(session = webext().storage.session) {
  const stored = await session.get(READER_SOURCE_KEY);
  const source = stored[READER_SOURCE_KEY];
  if (typeof source !== "object" || source === null) return null;
  const { tabId, at, marks } = /** @type {Record<string, unknown>} */ (source);
  if (typeof at !== "number") return null;
  if (marks === true) return { marks: true, at };
  if (typeof tabId !== "number") return null;
  return { tabId, at };
}

/**
 * @param {ReaderSource} source
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function writeReaderSource(source, session = webext().storage.session) {
  await session.set({ [READER_SOURCE_KEY]: source });
}

/**
 * Points the reader at nothing, which is how the reader ends up on its reading
 * list. Written rather than removed: the reader reacts to the key *changing*,
 * and removing a key that is already absent is a change nobody hears. The
 * value fails `readReaderSource`'s validation on purpose - a source with no
 * tab reads back as no source, and the timestamp is what makes each press an
 * event of its own.
 *
 * @param {() => number} [now]
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function clearReaderSource(now = Date.now, session = webext().storage.session) {
  await session.set({ [READER_SOURCE_KEY]: { at: now() } });
}

/**
 * Points the reader at the highlights page - the menu's Highlights row
 * pressed anywhere but the reader itself. Written for `clearReaderSource`'s
 * reason: the write is the signal a standing reader hears, and the timestamp
 * makes each press its own.
 *
 * @param {() => number} [now]
 * @param {WebExtBrowser["storage"]["session"]} [session]
 * @returns {Promise<void>}
 */
export async function writeMarksSource(now = Date.now, session = webext().storage.session) {
  await session.set({ [READER_SOURCE_KEY]: { marks: true, at: now() } });
}
