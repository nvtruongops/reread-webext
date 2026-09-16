/**
 * What a saved phrase is, and the rules about it that need no database to hold.
 *
 * Kept apart from `vocab.js` for the same reason the download layer is kept
 * apart from the model store: everything here is a value in and a value out, so
 * the rules that decide what gets written can be tested under `node --test`,
 * where there is no IndexedDB to open.
 */

import { collapseWhitespace, normalize, trimPhrase } from "../normalize.js";
import { ErrorCode, fail, ok } from "../protocol.js";
import { MAX_SENTENCE_LENGTH } from "../sentence.js";

/**
 * A phrase somebody kept.
 *
 * `phrase` is what is shown and exported, `normalized` is what is matched -
 * they are two forms of the same thing and both are stored, because deriving
 * one from the other at read time would tie every read to the version of
 * `normalize()` that happens to be in the package.
 *
 * `translations` is a list, and holds exactly one entry for everything this
 * milestone can produce. It is a list because a word has more than one meaning:
 * once the bubble translates in context (G2 in the docs), the meaning that fits
 * the sentence in front of the reader goes first and the ones kept earlier stay
 * behind it. Deciding that shape now costs one array literal; deciding it after
 * the first release costs a database migration.
 *
 * The four counts (D209) are what the reader did with the phrase after
 * keeping it, and they are all a row remembers of that: how many times its
 * bubble was opened (a press on an underline, or a fresh selection of a
 * phrase already kept), and how many times it occurred in the texts the
 * reader finished - a part of a book left through the Next button under its
 * text, an article marked as read - each with the time it last happened.
 * Never where: no page, no title, no text. A row from before D209 has none,
 * which reads as zero (`countsOf`).
 *
 * `context` is the sentence the phrase stood in when it was kept (D210): the
 * one the bubble had around the selection, as the page shows it - never its
 * translation, and never more than one sentence (`MAX_SENTENCE_LENGTH`). It
 * is the second half of a flashcard, and it is the one field here a reader
 * has to ask for: written only while the setting that asks for it is on,
 * which is off until they turn it on. A row keeps its first sentence - a
 * later save changes the meanings and leaves it alone (`resaved`) - and a
 * phrase kept from the phrases page or from a two-column file has none
 * until it is met in a sentence again: the next bubble opened over it with
 * the setting on fills the row (D216, `withSentence`), as a save would.
 * Absent otherwise, and absent on every row from before D210; the field
 * was reserved from M2 on and written by nobody until then (O2 in the docs).
 *
 * @typedef {object} Phrase
 * @property {string} id
 * @property {string} langFrom
 * @property {string} langTo
 * @property {string} phrase
 * @property {string} normalized
 * @property {string[]} translations at least one, most specific first
 * @property {number} createdAt epoch milliseconds
 * @property {string} [context] the sentence the phrase was kept from (D210), when one was
 * @property {string} [sourceUrl] reserved, written by nobody - see O3 in the docs
 * @property {number} [recallCount] bubble openings since the phrase was kept (D209)
 * @property {number} [lastRecallAt] epoch milliseconds of the last one
 * @property {number} [readCount] occurrences in the texts finished since then (D209)
 * @property {number} [lastReadAt] epoch milliseconds of the last text finished with it
 */

/**
 * What the reader did with a phrase, as one batch: how many bubble
 * openings and how many occurrences in finished texts to add.
 *
 * @typedef {{ recalled: number, read: number }} Counts
 */

/**
 * The same ceiling the translator facade puts on what it will translate. It is
 * therefore unreachable from the bubble - a selection this long never got a
 * translation to save. It is here so that a malformed message cannot write a
 * page into the vocabulary.
 */
export const MAX_PHRASE_LENGTH = 1000;

/**
 * The meanings, as they are stored: one line each, no blank ones, no
 * duplicates, in the order they were given. Whitespace is collapsed here rather
 * than at export time, because the TSV this ends up in has no escaping at all -
 * a tab or a newline in a translation would be a broken row in somebody's Anki
 * import, and the honest place to prevent that is before it is written.
 *
 * @param {string[]} translations
 * @returns {string[]}
 */
function cleanTranslations(translations) {
  /** @type {string[]} */
  const cleaned = [];
  for (const translation of translations) {
    const one = collapseWhitespace(translation);
    if (one.length > 0 && !cleaned.includes(one)) cleaned.push(one);
  }
  return cleaned;
}

/**
 * The sentence as it is stored, or nothing: one line with the whitespace
 * folded, for the reason the meanings are folded - the TSV it ends up in has
 * no escaping, and a newline in a sentence would be a broken row in Anki.
 * Longer than a sentence can be is not a sentence but a paragraph, and it
 * came over a message, so it is left out rather than written: the bubble
 * never offers one past the same ceiling, and the store keeps the promise
 * on its own side too.
 *
 * @param {string | undefined} context
 * @returns {string | undefined}
 */
export function cleanSentence(context) {
  if (typeof context !== "string") return undefined;
  const sentence = collapseWhitespace(context);
  if (sentence.length === 0 || sentence.length > MAX_SENTENCE_LENGTH) return undefined;
  return sentence;
}

/**
 * @param {object} input
 * @param {string} input.text as selected, or as it came out of an import
 * @param {string[]} input.translations what the reader is keeping it for
 * @param {string} input.langFrom
 * @param {string} input.langTo
 * @param {string} input.id
 * @param {number} input.now epoch milliseconds
 * @param {string} [input.context] the sentence the phrase stood in (D210), when
 *   the page had one and the setting asked for it - the caller answers for the
 *   setting, this only for the sentence's shape
 * @returns {import("../protocol.js").Result<Phrase>}
 */
export function buildPhrase({ text, translations, langFrom, langTo, id, now, context }) {
  if (text.length > MAX_PHRASE_LENGTH) return fail(ErrorCode.TOO_LONG);

  const phrase = trimPhrase(text);
  const normalized = normalize(text);
  const meanings = cleanTranslations(translations);
  // A selection of nothing but punctuation, or an edit box left empty. The
  // bubble offers to save neither, so getting here means a request nobody
  // should have sent.
  if (normalized.length === 0 || meanings.length === 0) return fail(ErrorCode.INTERNAL);

  /** @type {Phrase} */
  const built = { id, langFrom, langTo, phrase, normalized, translations: meanings, createdAt: now };
  const sentence = cleanSentence(context);
  if (sentence !== undefined) built.context = sentence;
  return ok(built);
}

/**
 * Whether a row carries a sentence (D210) - as a string with something in
 * it, which is the only way one is ever written; a copy edited by hand can
 * hold anything, and anything else reads as none.
 *
 * @param {Phrase} phrase
 * @returns {boolean}
 */
export function hasSentence(phrase) {
  return typeof phrase.context === "string" && phrase.context.length > 0;
}

/**
 * Saving a phrase that is already known.
 *
 * The row keeps its identity - same `id`, same `createdAt`, same reserved
 * fields, same counts - and takes the two things the reader just decided:
 * how the phrase is written and what it means. The key is not touched,
 * because the key is how this row was found.
 *
 * Saving replaces the meanings rather than adding to them, and that is the
 * whole rule: a save says "this phrase means exactly what the bubble is
 * showing". Adding a meaning is then adding a line in the bubble, not a second
 * kind of message.
 *
 * The sentence (D210) is the one thing a save does not replace: the row
 * keeps the sentence it was first kept from, because that is the meeting the
 * flashcard is about, and a phrase met again in another sentence is the same
 * phrase - the meanings may have been corrected, the card's example stays.
 * Only a row without one takes the sentence this save brings: a phrase kept
 * before the setting was on, or from the phrases page, gets its sentence the
 * first time it is saved from a bubble with the setting on.
 *
 * @param {Phrase} existing
 * @param {Phrase} incoming
 * @returns {Phrase}
 */
export function resaved(existing, incoming) {
  /** @type {Phrase} */
  const next = { ...existing, phrase: incoming.phrase, translations: incoming.translations };
  if (!hasSentence(existing) && hasSentence(incoming)) next.context = incoming.context;
  return next;
}

/**
 * A saved row met again in a sentence (D216): the bubble over it opened
 * with a sentence around the phrase, and the row has none - kept before
 * the setting was on, from the phrases page, or from a two-column file.
 * The sentence fills the row the way a save's does (`resaved`) and nothing
 * else moves; a row with a sentence keeps it, the first sentence staying
 * as it does everywhere. The sentence came over a message and takes the
 * shape rule on the way in (`cleanSentence`): nothing, or a paragraph past
 * the ceiling, fills nothing. The same object back when there is nothing
 * to take, so the store can tell there is nothing to write.
 *
 * @param {Phrase} existing
 * @param {string | undefined} sentence as the page had it
 * @returns {Phrase}
 */
export function withSentence(existing, sentence) {
  if (hasSentence(existing)) return existing;
  const cleaned = cleanSentence(sentence);
  if (cleaned === undefined) return existing;
  return { ...existing, context: cleaned };
}

/**
 * A saved row met by an import (D212): the file's sentence fills a row that
 * has none, and nothing else moves - the row's meanings are this reader's
 * decision, the file is somebody's past (`putMissingPhrases`' rule), and
 * the first sentence stays as it does on a re-save above. The same rule as
 * a bubble's (`withSentence`), told with a row: the same object back when
 * there is nothing to take, so the store can tell there is nothing to
 * write.
 *
 * @param {Phrase} existing
 * @param {Phrase} incoming as the file's row was built
 * @returns {Phrase}
 */
export function withImportedSentence(existing, incoming) {
  return hasSentence(incoming) ? withSentence(existing, incoming.context) : existing;
}

/**
 * The later of two moments, when either is one.
 *
 * @param {unknown} a
 * @param {unknown} b
 * @returns {number | undefined}
 */
function laterOf(a, b) {
  /** @type {number[]} */
  const moments = [];
  for (const one of [a, b]) if (typeof one === "number" && Number.isFinite(one)) moments.push(one);
  return moments.length === 0 ? undefined : Math.max(...moments);
}

/**
 * A row built from the backup of everything (D213), with the counts the
 * file kept for it: the two tallies and their moments, each taken only
 * when it is what it says it is - a broken count must not cost the phrase.
 * A count of zero is not written, the store's own rule for a row nobody
 * checked.
 *
 * @param {Phrase} phrase as `buildPhrase` made it
 * @param {{ recallCount?: number, lastRecallAt?: number, readCount?: number, lastReadAt?: number }} counts
 * @returns {Phrase}
 */
export function withRestoredCounts(phrase, counts) {
  /** @type {Phrase} */
  const next = { ...phrase };
  if (isCount(counts.recallCount) && counts.recallCount > 0) {
    next.recallCount = counts.recallCount;
    const at = laterOf(counts.lastRecallAt, undefined);
    if (at !== undefined) next.lastRecallAt = at;
  }
  if (isCount(counts.readCount) && counts.readCount > 0) {
    next.readCount = counts.readCount;
    const at = laterOf(counts.lastReadAt, undefined);
    if (at !== undefined) next.lastReadAt = at;
  }
  return next;
}

/**
 * A saved row met by the backup of everything (D213): what the file knows
 * and the row does not is taken - the sentence where there was none (the
 * TSV import's rule, D212), and of each count the greater, with the later
 * of the two moments - and what the row says stays: its meanings, its
 * spelling, the day it was kept. Never lower: the backup was made
 * somewhere the reader read as well, not instead. The same object back
 * when nothing rises, so the store can tell there is nothing to write.
 *
 * @param {Phrase} existing
 * @param {Phrase} incoming as the file's row was built
 * @returns {Phrase}
 */
export function restored(existing, incoming) {
  let next = withImportedSentence(existing, incoming);
  const mine = countsOf(existing);
  const theirs = countsOf(incoming);
  const own = () => (next === existing ? (next = { ...existing }) : next);
  if (theirs.recalls > mine.recalls) {
    const row = own();
    row.recallCount = theirs.recalls;
    const at = laterOf(existing.lastRecallAt, incoming.lastRecallAt);
    if (at !== undefined) row.lastRecallAt = at;
  }
  if (theirs.reads > mine.reads) {
    const row = own();
    row.readCount = theirs.reads;
    const at = laterOf(existing.lastReadAt, incoming.lastReadAt);
    if (at !== undefined) row.lastReadAt = at;
  }
  return next;
}

/**
 * @param {unknown} value
 * @returns {value is number} a whole, non-negative number - what a count is
 */
export function isCount(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The counts as a row carries them, absent ones read as zero: every row
 * kept before D209 has none, and nothing is rewritten to give it any.
 *
 * @param {Phrase} phrase
 * @returns {{ recalls: number, reads: number }}
 */
export function countsOf(phrase) {
  return {
    recalls: isCount(phrase.recallCount) ? phrase.recallCount : 0,
    reads: isCount(phrase.readCount) ? phrase.readCount : 0,
  };
}

/**
 * A row with a batch of counts added (D209). Only the four count fields
 * move; a batch that adds nothing gives the row back untouched - the same
 * object, so a store can tell there is nothing to write. A time is stamped
 * only for the count that grew: the last bubble opening and the last
 * finished text are two different moments.
 *
 * Counts that are not whole positive numbers add nothing rather than
 * poisoning the row - the batch came over a message, and a row with `NaN`
 * in it would sort nowhere and show nothing.
 *
 * @param {Phrase} phrase
 * @param {Counts} counts
 * @param {number} now epoch milliseconds
 * @returns {Phrase}
 */
export function counted(phrase, counts, now) {
  const recalled = isCount(counts.recalled) ? counts.recalled : 0;
  const read = isCount(counts.read) ? counts.read : 0;
  if (recalled === 0 && read === 0) return phrase;

  const { recalls, reads } = countsOf(phrase);
  /** @type {Phrase} */
  const next = { ...phrase };
  if (recalled > 0) {
    next.recallCount = recalls + recalled;
    next.lastRecallAt = now;
  }
  if (read > 0) {
    next.readCount = reads + read;
    next.lastReadAt = now;
  }
  return next;
}
