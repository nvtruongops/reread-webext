/**
 * The sentence at the top of a page that runs in private browsing.
 *
 * Every page of this extension opens the databases itself - the reading
 * list, the marks, the vocabulary - and Firefox hands an extension page in a
 * private window its own partition: an IndexedDB in memory, empty, and
 * discarded with the private session, while the background, never private,
 * keeps the real one. So the reading list shows nothing there, a book
 * imported there vanishes with the session, and a reader who slipped into
 * private browsing on a phone thinks the library is gone (a user's report,
 * 2026-08-30 - everything was back in a normal tab). The partition is the
 * browser's and nothing here can reach across it; what the page can do is
 * say what it sees, first thing, before an empty list says it wrongly.
 *
 * Chromium's extension pages share one database in both modes and never
 * report a private context (`inPrivateContext`), so nothing shows there -
 * rightly: there is nothing to explain.
 */

import { inPrivateContext } from "./browser.js";
import { t } from "./i18n.js";

/**
 * Fills and shows the page's `#private-note` when the page runs in private
 * browsing; leaves it hidden otherwise. The element is written into each
 * page's markup where the note should stand, so the pages decide the place
 * and this decides the words.
 *
 * @param {Pick<Document, "getElementById">} [doc]
 * @param {() => boolean} [isPrivate]
 * @returns {boolean} whether the note is showing
 */
export function privateNote(doc = document, isPrivate = inPrivateContext) {
  if (!isPrivate()) return false;
  const note = doc.getElementById("private-note");
  if (note === null) return false;
  note.textContent = t("private_browsing_note");
  note.hidden = false;
  return true;
}
