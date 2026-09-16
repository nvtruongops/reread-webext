/**
 * The vocabulary as the backup of everything carries it (D213): every pair,
 * every phrase, with what the TSV files cannot hold - the day it was kept,
 * the sentence (D210) and the four counts (D209). One JSON object in the
 * reading list's file's shape: a `format` marker, a `version` for a future
 * reader, and the rows. Indented, because the point of the file is that
 * somebody can open it and see their vocabulary. The TSV files stay the
 * exchange formats - Anki and the KOReader plugin read those; this one is
 * ours, written into `reread-backup.zip` beside the reading list and the
 * highlights and never on its own (`backup-file.js`).
 *
 * The rows are the wire's rows (`RestoreRow` in `protocol.js`): what the
 * page reads off the file is exactly what the background is handed,
 * narrowed by one rule in one place. Import adds and never rewrites what a
 * saved row says - it takes only what the row lacks (`restored` in
 * `phrase.js`), so the same file twice writes nothing the second time.
 *
 * Everything here is a value in and a value out; the database and the
 * message wire live elsewhere.
 */

import { asRestoreRow } from "../protocol.js";
import { countsOf, hasSentence } from "./phrase.js";

/** @typedef {import("./phrase.js").Phrase} Phrase */
/** @typedef {import("../protocol.js").RestoreRow} RestoreRow */

/** What the file says it is, and the first thing reading one checks. */
const FORMAT = "reread-vocabulary";

/**
 * Written for whoever reads this file after the format grows. Reading
 * ignores it today: whether an entry is a row is decided entry by entry, so
 * a newer file yields what this version can read and counts the rest.
 */
const VERSION = 1;

/** The entry's name inside the backup of everything. */
export const VOCABULARY_ENTRY = "vocabulary.json";

/**
 * The rows the file carries, in file order: by pair, then oldest first
 * with the id as the tie - the TSV's own order within a pair - so two
 * exports of the same vocabulary are the same file. A field a row does not
 * have is not written: a phrase never checked carries no count, one
 * without a sentence no sentence, and the file of somebody who never
 * turned either on reads as plainly as their TSV.
 *
 * @param {Phrase[]} phrases as the store holds them, any pair
 * @returns {RestoreRow[]}
 */
export function vocabularyRows(phrases) {
  return [...phrases]
    .sort(
      (a, b) =>
        a.langFrom.localeCompare(b.langFrom) ||
        a.langTo.localeCompare(b.langTo) ||
        a.createdAt - b.createdAt ||
        a.id.localeCompare(b.id),
    )
    .map((phrase) => {
      /** @type {RestoreRow} */
      const row = {
        langFrom: phrase.langFrom,
        langTo: phrase.langTo,
        text: phrase.phrase,
        translations: [...phrase.translations],
        createdAt: phrase.createdAt,
      };
      if (hasSentence(phrase)) row.context = /** @type {string} */ (phrase.context);
      const { recalls, reads } = countsOf(phrase);
      if (recalls > 0) {
        row.recallCount = recalls;
        if (typeof phrase.lastRecallAt === "number") row.lastRecallAt = phrase.lastRecallAt;
      }
      if (reads > 0) {
        row.readCount = reads;
        if (typeof phrase.lastReadAt === "number") row.lastReadAt = phrase.lastReadAt;
      }
      return row;
    });
}

/**
 * The whole file, as one string.
 *
 * @param {Phrase[]} phrases
 * @returns {string}
 */
export function toVocabularyFile(phrases) {
  return JSON.stringify({ format: FORMAT, version: VERSION, phrases: vocabularyRows(phrases) }, null, 2) + "\n";
}

/**
 * Reads what `toVocabularyFile` writes. A text that is not ours at all -
 * not JSON, no marker - holds zero rows rather than throwing: the page
 * turns that into one sentence. A broken entry between good ones is
 * counted and dropped, the rule of every file here: one bad entry must not
 * cost the file, and a count the reader can see beats a silent shrug.
 *
 * @param {string} text
 * @returns {{ rows: RestoreRow[], invalid: number }}
 */
export function fromVocabularyFile(text) {
  /** @type {unknown} */
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], invalid: 0 };
  }
  if (typeof parsed !== "object" || parsed === null) return { rows: [], invalid: 0 };
  const { format, phrases } = /** @type {Record<string, unknown>} */ (parsed);
  if (format !== FORMAT || !Array.isArray(phrases)) return { rows: [], invalid: 0 };

  /** @type {RestoreRow[]} */
  const rows = [];
  let invalid = 0;
  for (const entry of phrases) {
    const row = asRestoreRow(entry);
    if (row === null) invalid += 1;
    else rows.push(row);
  }
  return { rows, invalid };
}
