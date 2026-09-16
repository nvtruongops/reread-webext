/**
 * What the reader writes into the browser's session history, and how it reads
 * it back (D102).
 *
 * Opening a document from the reading list pushes one history entry, so that
 * leaving it is a real step back - the same step the browser's Back button,
 * Alt+Left, a mouse's back button and Android's back gesture already take.
 * The page never invents a gesture or a shortcut of its own for this: it
 * makes the browser's own navigation mean the right thing instead.
 *
 * The state is validated on the way back in, not trusted: an entry can
 * outlive the code that wrote it (a restored session carries entries from
 * before an update), and `history.state` after a reload is whatever was
 * stored, not whatever this build expects. Kept without a DOM so the rule
 * can be read and tested at once.
 */

/**
 * A history entry standing for one opened document. `kind` says which store
 * answers for it; `url` is the row's key - a book's id plays the part an
 * article's address plays, the same convention the list rows use.
 *
 * @typedef {object} DocState
 * @property {"article" | "book"} kind
 * @property {string} url
 */

/**
 * The property that marks an entry as ours. Named after the extension rather
 * than something generic, because `history.state` is a shared namespace with
 * anything else that ever ran on this page.
 */
const MARK = "reread";

/**
 * The state a document's history entry carries.
 *
 * @param {"article" | "book"} kind
 * @param {string} url
 * @returns {DocState & { [MARK]: "doc" }}
 */
export function docState(kind, url) {
  return { [MARK]: "doc", kind, url };
}

/**
 * The document an entry stands for, or null for every entry that is not one
 * of ours - the base entry the page loaded on, a fragment jump's copy of it,
 * or a shape some other version of this page once wrote.
 *
 * @param {unknown} state
 * @returns {DocState | null}
 */
export function asDocState(state) {
  if (typeof state !== "object" || state === null) return null;
  const { [MARK]: mark, kind, url } = /** @type {Record<string, unknown>} */ (state);
  if (mark !== "doc") return null;
  if (kind !== "article" && kind !== "book") return null;
  if (typeof url !== "string" || url.length === 0) return null;
  return { kind, url };
}

/**
 * A history entry standing for one visit to the highlights page (D108):
 * every document's quotes with `scope` null, one document's when the page
 * was opened from that document's own menu. An entry per visit for the
 * same reason a document gets one - Back from a quote's article must land
 * on the quotes it was opened from.
 *
 * @typedef {object} MarksState
 * @property {string | null} scope a document's key, or null for all of them
 */

/**
 * The state a highlights-page entry carries.
 *
 * @param {string | null} scope
 * @returns {MarksState & { [MARK]: "marks" }}
 */
export function marksState(scope) {
  return { [MARK]: "marks", scope };
}

/**
 * The highlights visit an entry stands for, or null for every other entry -
 * validated field by field like a document's, and for the same reason: an
 * entry can outlive the build that wrote it.
 *
 * @param {unknown} state
 * @returns {MarksState | null}
 */
export function asMarksState(state) {
  if (typeof state !== "object" || state === null) return null;
  const { [MARK]: mark, scope } = /** @type {Record<string, unknown>} */ (state);
  if (mark !== "marks") return null;
  if (scope !== null && (typeof scope !== "string" || scope.length === 0)) return null;
  return { scope };
}
