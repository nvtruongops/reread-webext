/**
 * From the words of a dictionary to the rows that go into the database.
 *
 * The one rule that matters here: a dictionary is keyed by the same
 * `normalize()` that keys the vocabulary. Not something similar, the same
 * function - or a phrase saved as one thing would be looked up as another, and
 * the two halves of this extension would disagree about what "the same word"
 * means. It also means the key rules only exist once, so a change to them is
 * still a change in one place.
 *
 * Normalising collapses spellings the dictionary kept apart (`Bank` and `bank`,
 * `naïve` and `naive` do not, but case does), so entries can land on one key.
 * They are merged rather than fought over: two meanings of one word are exactly
 * what the second layer of the bubble is for.
 *
 * Rows leave here in batches, as they are made, and what is kept between
 * batches is the least that still keeps the rules above true: the key of
 * every word by its position (a synonym points at a position), and the set of
 * keys that already have a row. A word whose key was written in an earlier
 * batch - `'word'` three thousand entries after `word`, once the quotes come
 * off - cannot be merged here, so its senses go out as an addition for the
 * writer to fold into the row it already has. The result is the same rows the
 * old one-array-of-everything produced, for a fraction of the memory.
 *
 * Every batch also says where the dictionary stands once the batch is in
 * (`RowProgress`), and a later run can pick up from there: the records before
 * that point are walked again - cheaply, their words keyed but their data not
 * read - only to rebuild the two things kept between batches, and the rows
 * start again where the last written batch stopped. Which entries of that
 * stretch could not be read is the one fact the walk cannot recover without
 * reading them, so the progress carries their positions.
 */

import { normalize } from "../normalize.js";
import { LIMITS } from "./text.js";

/**
 * @typedef {object} DictionaryRow
 * @property {string} dictId
 * @property {string} key `normalize(headword)`
 * @property {string} headword as the dictionary spells it
 * @property {string[]} senses empty in an alias row
 * @property {string} [aliasOf] the key this word is another spelling of
 */

/**
 * Senses for a row an earlier batch already wrote.
 *
 * @typedef {object} SenseAddition
 * @property {string} dictId
 * @property {string} key
 * @property {string[]} senses in dictionary order, neither deduplicated nor
 *   capped - the merge into the stored row does both, exactly as it would have
 *   had the entries been adjacent
 */

/**
 * Where an import stands once a batch is in - enough to go on from there.
 *
 * @typedef {object} RowProgress
 * @property {"entries" | "aliases"} phase which file the next batch starts in
 * @property {number} next the index position (entries) or the count of synonym
 *   records already consumed (aliases) the next batch starts from
 * @property {number[]} skipped positions of the entries that could not be read
 * @property {number} done records read so far, words and synonyms together
 * @property {number} entryCount so far
 * @property {number} aliasCount so far
 * @property {number} bytes so far, of the rows yielded
 */

/**
 * @typedef {object} RowBatch
 * @property {DictionaryRow[]} rows
 * @property {SenseAddition[]} additions
 * @property {number} done records read so far, words and synonyms together
 * @property {RowProgress} progress where the import stands once this batch is written
 */

/**
 * @typedef {object} RowSummary
 * @property {number} entryCount words with a row of their own
 * @property {number} aliasCount other spellings from the synonym file
 * @property {number} bytes what the rows cost as UTF-8; what the additions add
 *   is known only to whoever writes them, and is theirs to count
 * @property {number} skipped entries whose data could not be read
 */

/**
 * How many rows go into the database at a time.
 *
 * A dictionary from Wiktionary is a few hundred thousand rows, and one
 * transaction holding all of them is a transaction that owns the database for
 * as long as it takes. Batches let the page say where it is and let the browser
 * breathe between them.
 */
export const BATCH_ROWS = 5000;

/**
 * @param {string} text
 * @returns {number} how many bytes this would be as UTF-8
 */
export function utf8Length(text) {
  let total = 0;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    if (code < 0x80) total += 1;
    else if (code < 0x800) total += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      total += 4;
      at += 1;
    } else total += 3;
  }
  return total;
}

/**
 * @param {DictionaryRow} row
 * @returns {number}
 */
function rowBytes(row) {
  let total = utf8Length(row.key) + utf8Length(row.headword) + utf8Length(row.aliasOf ?? "");
  for (const sense of row.senses) total += utf8Length(sense);
  return total;
}

/**
 * Folds the senses of one more entry into a word's list.
 *
 * Homographs arrive as separate entries under one word, and a dictionary that
 * repeats itself should not make the bubble repeat itself - so a sense already
 * there is not added again, and the list stops at the limit a bubble can show.
 *
 * @param {string[]} into the senses a row has; extended in place
 * @param {string[]} more the senses to add, in order
 * @returns {string[]} what was added
 */
export function mergeSenses(into, more) {
  /** @type {string[]} */
  const added = [];
  for (const sense of more) {
    if (into.length >= LIMITS.senses) break;
    if (into.includes(sense)) continue;
    into.push(sense);
    added.push(sense);
  }
  return added;
}

/**
 * The first index position whose entry a resumed run still has to read.
 *
 * Everything before it is walked for its words only (see `entriesOf`): in the
 * entries phase that is the stretch already written, in the aliases phase the
 * whole index.
 *
 * @param {RowProgress | null} progress
 * @returns {number}
 */
export function entriesReadFrom(progress) {
  if (progress === null) return 0;
  return progress.phase === "entries" ? progress.next : Number.POSITIVE_INFINITY;
}

/**
 * The rows of one dictionary, batch by batch.
 *
 * Words first, then the synonym file: an alias never shadows a word the
 * dictionary has in its own right, and never points at itself - `dogs` may be
 * a synonym of `dog`, but if `dogs` has its own entry, that entry is the better
 * answer. A synonym pointing at an entry that could not be read, or at a
 * position the index does not have, points at nothing and is dropped.
 *
 * Given `resume`, the run starts where a written batch stopped: records before
 * that point only rebuild the keys (their data is not read - `entriesOf` was
 * told the same boundary, see `entriesReadFrom`), and `skipped` says which of
 * them had no row to key. The rows then come out exactly as an uninterrupted
 * run would have written them from that point on.
 *
 * Returns (as the generator's final value) the counts the dictionary's record
 * is finished with.
 *
 * @param {string} dictId
 * @param {{ entries: Iterable<import("./import.js").Entry>, aliases: Iterable<import("./import.js").Alias> }} source
 * @param {{ batchSize?: number, resume?: RowProgress | null }} [options]
 * @returns {Generator<RowBatch, RowSummary, undefined>}
 */
export function* rowBatches(dictId, { entries, aliases }, { batchSize = BATCH_ROWS, resume = null } = {}) {
  /**
   * Where each readable word ended up, for the synonym file to follow: the key
   * at the record's position, and nothing at the positions of records that
   * were not words or could not be read.
   *
   * @type {string[]}
   */
  const keys = [];
  /** @type {Set<string>} every key that has a row, in this batch or an earlier one */
  const taken = new Set();

  /** @type {Map<string, DictionaryRow>} */
  let batch = new Map();
  /** @type {Map<string, SenseAddition>} */
  let additions = new Map();

  // Entries below the first, and synonyms up to the second, were written by
  // the run being resumed; they are walked for their keys and nothing else.
  const replayEntriesBelow = entriesReadFrom(resume);
  const replayAliasesThrough = resume !== null && resume.phase === "aliases" ? resume.next : 0;
  const skippedBefore = new Set(resume?.skipped ?? []);

  /** @type {"entries" | "aliases"} */
  let phase = "entries";
  let lastPosition = -1;
  let aliasOrdinal = 0;

  let done = 0;
  let entryCount = resume?.entryCount ?? 0;
  let aliasCount = resume?.aliasCount ?? 0;
  let bytes = resume?.bytes ?? 0;
  /** @type {number[]} */
  const skipped = [...(resume?.skipped ?? [])];

  /** @returns {RowBatch} */
  const flush = () => {
    const rows = [...batch.values()];
    for (const row of rows) bytes += rowBytes(row);
    /** @type {RowProgress} */
    const progress = {
      phase,
      next: phase === "entries" ? lastPosition + 1 : aliasOrdinal,
      skipped: [...skipped],
      done,
      entryCount,
      aliasCount,
      bytes,
    };
    const out = { rows, additions: [...additions.values()], done, progress };
    batch = new Map();
    additions = new Map();
    return out;
  };

  for (const entry of entries) {
    done += 1;
    lastPosition = entry.position;

    if (entry.position < replayEntriesBelow) {
      if (skippedBefore.has(entry.position)) continue;
      const key = normalize(entry.headword);
      if (key.length === 0) continue;
      keys[entry.position] = key;
      taken.add(key);
      continue;
    }

    if (entry.senses.length === 0) {
      skipped.push(entry.position);
      continue;
    }

    const key = normalize(entry.headword);
    // A headword that is nothing but punctuation has no key to be found under.
    if (key.length === 0) continue;
    keys[entry.position] = key;

    const pending = batch.get(key);
    if (pending !== undefined) {
      mergeSenses(pending.senses, entry.senses);
    } else if (taken.has(key)) {
      const addition = additions.get(key);
      if (addition === undefined) additions.set(key, { dictId, key, senses: [...entry.senses] });
      else addition.senses.push(...entry.senses);
    } else {
      batch.set(key, { dictId, key, headword: entry.headword, senses: [...entry.senses] });
      taken.add(key);
      entryCount += 1;
    }

    if (batch.size >= batchSize) yield flush();
  }

  phase = "aliases";

  for (const alias of aliases) {
    done += 1;
    aliasOrdinal += 1;
    const key = normalize(alias.headword);
    if (key.length === 0 || taken.has(key)) continue;

    const targetKey = keys[alias.target];
    if (targetKey === undefined || targetKey === key) continue;

    taken.add(key);
    // Written by the run being resumed: its key is taken, its row is there.
    if (aliasOrdinal <= replayAliasesThrough) continue;

    batch.set(key, { dictId, key, headword: alias.headword, senses: [], aliasOf: targetKey });
    aliasCount += 1;

    if (batch.size >= batchSize) yield flush();
  }

  if (batch.size > 0 || additions.size > 0) yield flush();

  return { entryCount, aliasCount, bytes, skipped: skipped.length };
}
