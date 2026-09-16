/**
 * The sentence a selection sits in.
 *
 * The engine is much better at a word when it can see the sentence around it:
 * measured on the real en-pl model, thirty ambiguous words came out in the right
 * sense 25 times inside their sentence and 10 times on their own. What it will
 * not do is say which target word the selected one became - this build exposes
 * no alignment - so the sentence is not used to sharpen the gloss. It is shown,
 * translated, behind "More".
 *
 * Finding where a sentence starts is a guess dressed as a rule, and the rule
 * here is deliberately small: a stop ends a sentence unless it is doing another
 * job, and it may be wearing a closing quotation mark when it does. Everything
 * it gets wrong costs a slightly longer or shorter piece of context - never a
 * wrong translation of the phrase itself, which is translated on its own either
 * way.
 *
 * No DOM in this file: the caller hands over text and two offsets, so all of
 * this is testable without a browser.
 */

import { trimPhrase } from "./normalize.js";

/**
 * Ends a sentence on its own, whatever follows it. The one member is the line
 * break the page's blocks leave behind: a heading has no full stop and is still
 * the end of what it says. The breaks a file was wrapped with are not in the
 * text this gets - the scanner reads them as the spaces the reader sees
 * (`unwrapLines`) - so a break here is always one the reader can see too.
 */
const HARD_STOP = "\n";

/** What a sentence can end with, before whatever closes over it. */
const STOPS = new Set([".", "!", "?", "…"]);

/**
 * Marks that may stand between the stop and the space after it and still leave
 * the stop an ending: the quote the sentence was spoken inside, the bracket it
 * was written inside. Straight `"` and `'` are listed by hand - Unicode files
 * them under "other punctuation" together with the apostrophe, so no property
 * catches them.
 *
 * This is what a full stop in quoted prose hides behind, and without it half of
 * a news article is one sentence: `... negative.” Instead he said ...` has no
 * ending in it, so the context around a phrase further down the paragraph grows
 * until it is thrown away for being too long, and the reader gets nothing.
 */
const CLOSERS = new RegExp("[\\p{Pf}\\p{Pe}\"']", "u");

/**
 * A footnote reference, which hangs off a stop exactly like a closing quote:
 * `... in 1809.[1] He was ...`. Wikipedia is where a reader of a foreign
 * language spends half their time, and this is how Wikipedia writes.
 *
 * Sticky rather than anchored, so it can be tried at a position without
 * slicing the text first.
 */
const FOOTNOTE = new RegExp("\\[\\d+\\]", "yu");

/**
 * How far past its stop an ending may reach. `.”)` and `.[12]` are the long
 * ones; the bound is what keeps the walk backwards from every character in a
 * block from being a walk over the whole block.
 */
const LONGEST_ENDING = 8;

/**
 * Abbreviations that end in a full stop and are regularly followed by a capital
 * letter, which is the only case the rules below cannot tell from a sentence
 * ending. Single letters (`J. R. R. Tolkien`, `e.g.`) are handled by a rule
 * rather than a list, and lower-case abbreviations (`np.`, `itd.`) by the one
 * about what follows.
 */
const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "st", "sr", "jr", "vs", "etc", "fig", "no", "vol", "ok",
]);

/**
 * How long a piece of context may get before it stops being a sentence and
 * starts being a paragraph somebody forgot to punctuate. Past this the reader
 * gets no context rather than a wall of text and the decoding time it costs.
 *
 * Six hundred rather than the four hundred it started at: one ordinary
 * sentence of a news article - a bracketed aside and two quotations in it -
 * measured 423 characters, and the reader got nothing at all for it. The cost
 * is paid where a fresh selection is answered, because there the sentence
 * rides in the same batch as the phrase and the bubble waits for both.
 */
export const MAX_SENTENCE_LENGTH = 600;

/**
 * @param {string} text
 * @param {number} index of the character before the full stop
 * @returns {string} the word ending at `index`, lower-cased
 */
function wordBefore(text, index) {
  let start = index + 1;
  while (start > 0 && /\p{L}/u.test(text[start - 1] ?? "")) start -= 1;
  return text.slice(start, index + 1).toLowerCase();
}

/**
 * The last character of the ending that begins with the stop at `stop`: the
 * stop itself, or the last of the marks hung on it. `Really?!`, `over.”`,
 * `(really.)`, `1809.[1]` all end at their last character rather than at the
 * punctuation mark in the middle of them.
 *
 * @param {string} text
 * @param {number} stop
 * @returns {number}
 */
function endOfEnding(text, stop) {
  let at = stop + 1;
  for (;;) {
    const character = text[at];
    if (character === undefined) break;
    if (STOPS.has(character) || CLOSERS.test(character)) {
      at += 1;
      continue;
    }
    FOOTNOTE.lastIndex = at;
    if (FOOTNOTE.test(text)) {
      at = FOOTNOTE.lastIndex;
      continue;
    }
    break;
  }
  return at - 1;
}

/**
 * The stop of the ending that finishes at `index`, or null when the character
 * there is not the last of one.
 *
 * @param {string} text
 * @param {number} index
 * @returns {number | null}
 */
function stopOf(text, index) {
  for (let at = index; at >= 0 && index - at <= LONGEST_ENDING; at -= 1) {
    if (STOPS.has(text[at] ?? "") && endOfEnding(text, at) === index) return at;
  }
  return null;
}

/**
 * Whether the character at `index` ends a sentence - the whole ending, so the
 * quote a sentence was spoken inside stays with it instead of opening the next
 * one.
 *
 * Exported for the reader's reading aloud (D87), which cuts an article into
 * utterances at exactly these places: one rule, so a full stop that is not an
 * ending here is not a pause in the voice either. `Mr. Smith` read as two
 * utterances would put a breath in the middle of a name.
 *
 * @param {string} text
 * @param {number} index
 * @returns {boolean}
 */
export function endsSentence(text, index) {
  const character = text[index];
  if (character === undefined) return false;
  if (character === HARD_STOP) return true;
  // The cheap door first: this runs over every character of an article when the
  // reader is being read to, and only a handful of them can end anything.
  if (!STOPS.has(character) && !CLOSERS.test(character)) return false;

  const stop = stopOf(text, index);
  if (stop === null) return false;

  const next = text[index + 1];
  // `3.14`, `example.com` and `Yahoo!Inc`: a stop with text hard against it is
  // inside something, not after it.
  if (next !== undefined && !/\s/u.test(next)) return false;

  if (text[stop] === ".") {
    const word = wordBefore(text, stop - 1);
    // One letter before the stop is an initial or `e.g.`, never the end of a
    // sentence somebody wrote.
    if (word.length === 1) return false;
    if (ABBREVIATIONS.has(word)) return false;
  }

  // What follows decides the rest. A lower-case letter continues what was
  // already going on, and so does a digit: sentences rarely start with one,
  // while `godz. 15`, `vol. 3` and `p. 40` are everywhere.
  //
  // A question mark and an exclamation mark answer to this too, which is the
  // other half of reading quoted prose: `He said “stop!” and the driver
  // braked` is one sentence, and taking the `!` for an ending left the reader
  // a piece of context beginning with a closing quotation mark. What ends a
  // sentence for real - `“Stop!” The driver braked.` - is followed by a
  // capital either way.
  const following = text.slice(index + 1).match(/\S/u)?.[0];
  if (following === undefined) return true;
  return !/[\p{Ll}\p{N}]/u.test(following);
}

/**
 * The sentence containing `[start, end)`, or `null` when there is no useful one.
 *
 * Null means "say nothing extra": the selection already is the whole sentence,
 * or what is around it is too long to be one, or the offsets make no sense.
 *
 * @param {string} text of one block, as the reader sees it
 * @param {number} start of the selection within it
 * @param {number} end of the selection within it
 * @returns {string | null}
 */
export function sentenceAround(text, start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null;
  if (start < 0 || end > text.length || start >= end) return null;

  let from = 0;
  // Stops strictly before the selection only: a full stop inside it is part of
  // what was selected, not a boundary of the sentence it sits in.
  for (let index = start - 1; index >= 0; index -= 1) {
    if (endsSentence(text, index)) {
      from = index + 1;
      break;
    }
  }

  let to = text.length;
  for (let index = Math.max(start, end - 1); index < text.length; index += 1) {
    if (endsSentence(text, index)) {
      to = index + 1;
      break;
    }
  }

  const sentence = text.slice(from, to).trim();
  if (sentence.length === 0 || sentence.length > MAX_SENTENCE_LENGTH) return null;

  // Nothing to add: the selection is the sentence, so translating it twice would
  // print the same line under itself. Compared without the punctuation at the
  // edges, because dragging over a sentence usually catches the full stop and
  // sometimes does not, and that is not a difference worth a second line.
  if (trimPhrase(sentence) === trimPhrase(text.slice(start, end))) return null;

  return sentence;
}
