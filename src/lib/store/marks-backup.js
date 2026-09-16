/**
 * The copy of the highlights that outlives the database: every document's
 * marks with their notes, and the one thing about each document the
 * highlights page needs once the document itself is gone - its title. The
 * second copy after the vocabulary's (`backup.js`, where the reasons are:
 * Safari deletes the origin's IndexedDB after thirty days without a touch on
 * the extension's pages, and `storage.local` is where that does not reach).
 *
 * The vocabulary's three rules hold here too - one writer, always in full,
 * from a read that succeeded; restored only into nothing; asked before every
 * write - and three things are particular to marks:
 *
 *   - the reader page is the writer. It is the only page that writes marks,
 *     and the copy is rebuilt from the store after every write that touches
 *     them, whichever module made it (`marks.js`, `articles.js`, `books.js`).
 *   - content, positions and books are not copied. Content is found again
 *     (a page saves itself when opened, D124), a book is re-imported, a
 *     position is a convenience; the marks are the reader's own work and the
 *     one thing nobody can type in again. Beside each document's row the
 *     copy keeps the document's kind and title as they stood when it was
 *     written, so a quote can still be named after its document is gone.
 *   - "nothing" means an empty library: no article, no book, no marks - the
 *     shape a deletion leaves. What comes back are marks whose documents are
 *     gone. The highlights page shows them under the copied title
 *     (`marks-list.js`), and they reattach the day the same address is saved
 *     again: a first save keeps the marks it finds (`articles.js`), because
 *     only this copy could have put them there.
 *
 * The store arrives as parameters (`marks.js` supplies IndexedDB) so the
 * rules can be tested against stand-ins; the storage side defaults to
 * `storage.local`.
 */

import { inPrivateContext, webext } from "../browser.js";
import { asMark, compareMarks } from "../reader/marks.js";
import { copiesWritable } from "./private-copies.js";

/** @typedef {import("../reader/marks.js").Mark} Mark */

/**
 * What the copy remembers about a document beside its marks.
 *
 * @typedef {{ kind: "article" | "book", title: string }} DocTitle
 */

/**
 * @typedef {object} BackupDoc
 * @property {string} docId an article's url, a book's id - the marks row's key
 * @property {"article" | "book"} kind
 * @property {string} title
 * @property {Mark[]} marks in reading order
 */

/**
 * @typedef {object} MarksBackup
 * @property {1} version
 * @property {number} writtenAt epoch milliseconds
 * @property {BackupDoc[]} docs
 */

/**
 * @typedef {object} MarksBackupDeps
 * @property {() => Promise<{ marks: Map<string, Mark[]>, titles: Map<string, DocTitle> }>} snapshot
 *   every marks row and the titles the library can still put to them
 * @property {() => Promise<boolean>} empty whether the library holds no article, no book and no marks
 * @property {(docs: BackupDoc[]) => Promise<void>} putRows the marks rows written back - into an
 *   empty library only, checked again where the write is atomic
 * @property {() => Promise<unknown>} read whatever stands under the copy's key
 * @property {(backup: MarksBackup) => Promise<void>} write
 * @property {() => number} now
 */

/** The key in `storage.local`, beside the vocabulary's copy. */
export const MARKS_BACKUP_KEY = "marksBackup";

const VERSION = 1;

/**
 * The most marks one document brings back - the article file's own ceiling
 * (`articles-file.js`): far above any honest reading, low enough that a
 * hand-made copy cannot plant a megabyte row behind one address.
 */
const MAX_MARKS_PER_DOC = 1000;

/**
 * The storage half of the dependencies, the same on every page - except
 * that in a private window the write does nothing (D171,
 * `private-copies.js`): the area is shared with the normal windows, and a
 * rebuild there would carry the private session's marks - and the absence
 * of the ones it deleted - into the copy the normal windows restore from.
 *
 * @param {() => boolean} [isPrivate] for tests; the browser's answer by default
 * @returns {Pick<MarksBackupDeps, "read" | "write" | "now">}
 */
export function storageDeps(isPrivate = inPrivateContext) {
  const writable = copiesWritable(isPrivate);
  return {
    read: async () => (await webext().storage.local.get(MARKS_BACKUP_KEY))[MARKS_BACKUP_KEY],
    write: async (backup) => {
      if (writable) await webext().storage.local.set({ [MARKS_BACKUP_KEY]: backup });
    },
    now: () => Date.now(),
  };
}

/**
 * The copy as the store stands: one entry per marks row, sorted by document
 * so two copies of the same library are the same value. A row whose document
 * the library no longer names keeps the row's own key as its title - the
 * copy carries what is there, and a name is better than none.
 *
 * @param {Map<string, Mark[]>} marks keyed by `docId`
 * @param {Map<string, DocTitle>} titles
 * @param {number} now
 * @returns {MarksBackup}
 */
export function marksBackupOf(marks, titles, now) {
  /** @type {BackupDoc[]} */
  const docs = [];
  for (const [docId, list] of marks) {
    if (list.length === 0) continue;
    const doc = titles.get(docId);
    docs.push({
      docId,
      kind: doc?.kind ?? "article",
      title: doc?.title ?? docId,
      marks: [...list].sort(compareMarks),
    });
  }
  docs.sort((a, b) => a.docId.localeCompare(b.docId));
  return { version: VERSION, writtenAt: now, docs };
}

/**
 * @param {unknown} value
 * @returns {BackupDoc | null}
 */
function asDoc(value) {
  if (typeof value !== "object" || value === null) return null;
  const { docId, kind, title, marks } = /** @type {Record<string, unknown>} */ (value);
  if (typeof docId !== "string" || docId.length === 0) return null;
  if (kind !== "article" && kind !== "book") return null;
  if (!Array.isArray(marks)) return null;
  const kept = marks
    .slice(0, MAX_MARKS_PER_DOC)
    .map(asMark)
    .filter((mark) => mark !== null)
    .sort(compareMarks);
  if (kept.length === 0) return null;
  return { docId, kind, title: typeof title === "string" && title.length > 0 ? title : docId, marks: kept };
}

/**
 * Whatever stood under the key, narrowed: a shape from another version is no
 * copy at all, and a document whose row makes no sense is dropped rather
 * than restored.
 *
 * @param {unknown} stored
 * @returns {MarksBackup | null}
 */
export function asMarksBackup(stored) {
  if (typeof stored !== "object" || stored === null) return null;
  const { version, writtenAt, docs } = /** @type {Record<string, unknown>} */ (stored);
  if (version !== VERSION || typeof writtenAt !== "number" || !Array.isArray(docs)) return null;

  /** @type {BackupDoc[]} */
  const clean = [];
  for (const row of docs) {
    const doc = asDoc(row);
    if (doc !== null) clean.push(doc);
  }
  return { version: VERSION, writtenAt, docs: clean };
}

/**
 * The titles the copy remembers - what the highlights page puts to a quote
 * whose document is gone.
 *
 * @param {MarksBackup | null} backup
 * @returns {Map<string, DocTitle>}
 */
export function keptTitles(backup) {
  /** @type {Map<string, DocTitle>} */
  const titles = new Map();
  for (const doc of backup?.docs ?? []) titles.set(doc.docId, { kind: doc.kind, title: doc.title });
  return titles;
}

/**
 * @param {MarksBackup} backup
 * @returns {number} how many marks the copy holds, across its documents
 */
export function marksInBackup(backup) {
  return backup.docs.reduce((sum, doc) => sum + doc.marks.length, 0);
}

/**
 * The copy rebuilt from the whole store. Nothing is written when the store
 * cannot be read - the exception is the caller's, and the copy stays what it
 * was.
 *
 * @param {MarksBackupDeps} deps
 * @returns {Promise<number>} how many marks the copy now holds
 */
export async function rebuildMarksBackup(deps) {
  const { marks, titles } = await deps.snapshot();
  const backup = marksBackupOf(marks, titles, deps.now());
  await deps.write(backup);
  return marksInBackup(backup);
}

/**
 * The marks written back from the copy, when - and only when - the library is
 * empty and the copy is not. The emptiness is asked first and the copy read
 * only then, so on every ordinary call this costs three counts and nothing
 * else.
 *
 * @param {MarksBackupDeps} deps
 * @returns {Promise<number>} how many documents' marks came back
 */
export async function restoreMarks(deps) {
  if (!(await deps.empty())) return 0;
  const backup = asMarksBackup(await deps.read());
  if (backup === null || backup.docs.length === 0) return 0;
  await deps.putRows(backup.docs);
  return backup.docs.length;
}

/**
 * The copy as it stands, for the pages that read it without writing: the
 * highlights page for its titles, the settings page for its line.
 *
 * @param {Pick<MarksBackupDeps, "read">} [deps]
 * @returns {Promise<MarksBackup | null>}
 */
export async function readMarksBackup(deps = storageDeps()) {
  try {
    return asMarksBackup(await deps.read());
  } catch {
    return null;
  }
}
