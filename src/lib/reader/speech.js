/**
 * Reading a whole article aloud, as arithmetic (D87).
 *
 * The engine is the same `speechSynthesis` a phrase is spoken with (D83,
 * `lib/tts.js`); what an article adds is length, and length is what this file
 * is about. An article is not handed over as one utterance:
 *
 *   - engines have limits on how much text they take at once, and the ones that
 *     do not still answer a `cancel()` in the middle of a chapter by losing the
 *     place entirely;
 *   - pause and resume have to land somewhere the voice can start again from,
 *     and the natural somewhere is a sentence;
 *   - the sentence being spoken is the only thing every engine agrees on. Words
 *     arrive as `boundary` events where the platform bothers to send them, and
 *     Android regularly does not - so what is underlined has to degrade to the
 *     sentence rather than to nothing.
 *
 * So the article's text is cut into chunks at sentence ends, and everything
 * here is offsets into that one string: which chunk, which word inside it. The
 * text and the offsets come from the page (`reader/read-aloud.js` joins the
 * article's text nodes and maps offsets back onto them), and nothing in this
 * file touches a DOM - which is what lets the rules be tested.
 */

import { endsSentence } from "../sentence.js";

/**
 * How long one utterance may get when nothing punctuates it. A wall of text
 * without a full stop happens - a heading, a poem, a page of transcript - and
 * a chunk that swallowed all of it would take pause, resume and the sentence
 * underline down with it. The number is a little over a long sentence, so real
 * prose is never cut by it.
 */
export const MAX_CHUNK = 300;

/** @typedef {{ start: number, end: number }} Chunk offsets into the article's text */

/** What counts as part of a word: letters and digits, in any script. */
const WORD = /[\p{L}\p{N}]/u;

/**
 * The marks that are only part of a word when a letter follows: the two
 * apostrophes (U+0027, U+2019, and U+02BC for the languages that spell one
 * that way), the hyphen, and the two hyphens a page can break a word across a
 * line with. Written as escapes rather than as themselves: a literal soft
 * hyphen in the source is a character nobody would ever see in a diff.
 */
const JOINER = /[-\u0027\u2019\u02BC\u00AD\u2011]/u;

/** @param {string} character */
function isSpace(character) {
  return /\s/u.test(character);
}

/**
 * Whether the character at `at` continues the word that is being walked.
 *
 * @param {string} text
 * @param {number} at
 * @returns {boolean}
 */
function continuesWord(text, at) {
  const character = text[at] ?? "";
  if (WORD.test(character)) return true;
  return JOINER.test(character) && WORD.test(text[at + 1] ?? "");
}

/**
 * One chunk, if there is anything in it to say. The edges are trimmed because
 * the article's text carries a line break for every block boundary (see
 * `prosePieces`): a chunk that kept them would underline the gap between two
 * paragraphs, and hand the engine leading whitespace to think about.
 *
 * @param {Chunk[]} into
 * @param {string} text
 * @param {number} from
 * @param {number} to
 */
function add(into, text, from, to) {
  let start = from;
  let end = to;
  while (start < end && isSpace(text[start] ?? "")) start += 1;
  while (end > start && isSpace(text[end - 1] ?? "")) end -= 1;
  // Nothing but whitespace, or nothing at all: two blocks in a row, the break
  // between them, the end of the article.
  if (end > start) into.push({ start, end });
}

/**
 * Where to cut a run of text that has gone on too long without an ending: the
 * last word boundary before the limit, so the voice at least stops between two
 * words. With no space in the whole run - one enormous token - the limit
 * itself, because something has to give.
 *
 * @param {string} text
 * @param {number} from
 * @param {number} limit
 * @returns {number}
 */
function wrapPoint(text, from, limit) {
  for (let at = limit; at > from + 1; at -= 1) {
    if (isSpace(text[at - 1] ?? "")) return at;
  }
  return limit;
}

/**
 * The article, cut into the pieces a voice speaks one at a time.
 *
 * Sentence ends are the cut, by the same rule the bubble finds the sentence
 * around a phrase with (`endsSentence`) - which counts a line break as one, so
 * every block of the article ends a chunk whether it is punctuated or not. A
 * heading is therefore its own utterance, and so is a list item.
 *
 * @param {string} text the whole article as one string
 * @returns {Chunk[]} in reading order, whitespace-only pieces left out
 */
export function chunkText(text) {
  /** @type {Chunk[]} */
  const chunks = [];
  let from = 0;
  let at = 0;

  while (at < text.length) {
    if (endsSentence(text, at)) {
      add(chunks, text, from, at + 1);
      from = at + 1;
      at = from;
      continue;
    }
    if (at - from + 1 >= MAX_CHUNK) {
      const cut = wrapPoint(text, from, at + 1);
      add(chunks, text, from, cut);
      from = cut;
      at = from;
      continue;
    }
    at += 1;
  }
  // Whatever the last ending left over - an article that does not end in a
  // full stop is the usual case, not the exception.
  add(chunks, text, from, text.length);

  return chunks;
}

/**
 * The word a `boundary` event points at, as offsets into the same text.
 *
 * Engines are inconsistent here in three ways, and each is answered:
 *
 *   - `charLength` is optional and regularly missing or zero, so the word is
 *     walked out of the text when it is not given;
 *   - some engines point at the whitespace before the word rather than at its
 *     first letter, so leading whitespace is skipped;
 *   - some count the punctuation after a word into its length, and underlining
 *     a comma reads as a mistake, so trailing non-word characters are dropped.
 *
 * Null means there is nothing to underline - past the end of the text, or a
 * position with only whitespace and punctuation left in front of it. The
 * caller leaves the sentence underlined and says nothing about the word, which
 * is what a device with no `boundary` events at all gets for the whole reading.
 *
 * @param {string} text
 * @param {number} index `charIndex` from the event, an offset into `text`
 * @param {number} [length] `charLength` from the event, when it says anything
 * @returns {Chunk | null}
 */
export function wordSpan(text, index, length = 0) {
  if (!Number.isInteger(index) || index < 0 || index >= text.length) return null;

  let start = index;
  while (start < text.length && isSpace(text[start] ?? "")) start += 1;
  if (start >= text.length) return null;

  // The engine's own answer is trusted only where it starts: a length measured
  // from `index` says nothing about a word that began after the whitespace.
  let end = length > 0 && start === index ? Math.min(start + length, text.length) : start;
  while (end < text.length && continuesWord(text, end)) end += 1;
  while (end > start && !WORD.test(text[end - 1] ?? "")) end -= 1;

  return end > start ? { start, end } : null;
}
