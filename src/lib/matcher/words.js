/**
 * Which word an offset falls in - the pure half of selecting by touch (D80).
 *
 * The reader page selects by tap and drag rather than through the browser's
 * own selection, and a touch is a point, not a range: the DOM half turns the
 * point into a character offset with `caretPositionFromPoint`, and this module
 * turns the offset into a word of the tokenization phrases are matched in.
 * Same tokens, same boundaries - a phrase selected this way is exactly a
 * phrase the matcher can find again.
 *
 * Three questions, because the gestures ask differently. A touch coming down
 * wants the word it landed on and nothing else - a touch on no word selects
 * nothing. A drag in progress wants the nearest word, so that a finger
 * crossing the gap between two words never makes the selection flicker away.
 * And a tap beside a standing selection asks where its word stands against
 * the run - the neighbour grows it, anything farther is just a tap (D81).
 */

/** @typedef {import("./tokenize.js").Token} Token */

/**
 * The word an offset falls inside, edges included.
 *
 * A caret position lies between characters, so an offset equal to a token's
 * end came from a tap on its last character and still means that word. Two
 * tokens can never dispute an offset: adjacent word characters are one token
 * by construction, so between two tokens there is always at least one
 * character of something else.
 *
 * @param {Token[]} tokens
 * @param {number} offset into the text the tokens came from
 * @returns {number} index into `tokens`, or -1 when the offset touches no word
 */
export function wordIndexAt(tokens, offset) {
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token !== undefined && offset >= token.start && offset <= token.end) return index;
  }
  return -1;
}

/**
 * Where a word stands against a selected run of tokens: inside it, one step
 * off either end - the word a tap may grow the run by - or apart.
 *
 * The one-step rule is the tap-extension's whole grammar (D81): a tap is
 * also how a reader dismisses things, and only the word right next to the
 * selection reads unambiguously as "this one too". A word farther out keeps
 * meaning what a tap anywhere means.
 *
 * @param {{ from: number, to: number }} span token indices, ends inclusive
 * @param {number} index
 * @returns {"within" | "left" | "right" | "apart"}
 */
export function besideSpan(span, index) {
  // The tokenizer's "no word here" is -1, which a run starting at 0 would
  // otherwise read as its left neighbour.
  if (index < 0) return "apart";
  if (index >= span.from && index <= span.to) return "within";
  if (index === span.from - 1) return "left";
  if (index === span.to + 1) return "right";
  return "apart";
}

/**
 * What a character has to be for the highlighter to drag it in at a mark's
 * edge (D107): not a word character - the tokenizer's own class, or the two
 * modules would disagree about where a word ends - and not whitespace. What
 * is left is punctuation standing glued to the edge word: the quote mark a
 * quotation opens with, the full stop it closes on, brackets, commas. A
 * phrase for the vocabulary must not take these (its key drops them anyway);
 * a mark is a quote for notes, and a quote without its own quotation marks
 * reads clipped.
 */
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;
const WHITESPACE = /\s/u;

/**
 * @param {string} text
 * @param {number} at
 * @returns {boolean}
 */
function glued(text, at) {
  const character = text[at];
  if (character === undefined) return false;
  return !WHITESPACE.test(character) && !WORD_CHARACTER.test(character);
}

/**
 * A mark's start, walked left over the punctuation glued to its first word -
 * as far as the whitespace or the word before it, whichever comes first.
 * `"It` starts at the quote mark; `word. Next` starting at `Next` takes
 * nothing, because a space stands between.
 *
 * @param {string} text
 * @param {number} offset a word's start in `text`
 * @returns {number}
 */
export function gluedStart(text, offset) {
  while (offset > 0 && glued(text, offset - 1)) offset -= 1;
  return offset;
}

/**
 * A mark's end, walked right over the punctuation glued to its last word:
 * `Maryland.` ends after the full stop, `science,"` after the comma and the
 * closing quote.
 *
 * @param {string} text
 * @param {number} offset a word's end in `text`, exclusive
 * @returns {number}
 */
export function gluedEnd(text, offset) {
  while (glued(text, offset)) offset += 1;
  return offset;
}

/**
 * Whether a stretch of text holds no word at all - only space and
 * punctuation. This is what makes a tapped word "the neighbour" of a mark
 * (D107): between the mark's edge and the word there is nothing a reader
 * would call text, so growing over the gap grows by exactly one word - the
 * same one-step reading `besideSpan` gives the translation gesture.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function wordless(text) {
  return !WORD_CHARACTER.test(text);
}

/**
 * The word nearest an offset - the drag's forgiving question.
 *
 * Distance is measured to the token's edges, zero inside it, and the earlier
 * token wins a tie, which keeps the answer stable while a finger sits in the
 * middle of a gap.
 *
 * @param {Token[]} tokens
 * @param {number} offset into the text the tokens came from
 * @returns {number} index into `tokens`, or -1 only when there are no tokens
 */
export function nearestWordIndex(tokens, offset) {
  let best = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) continue;
    const distance = offset < token.start ? token.start - offset : offset > token.end ? offset - token.end : 0;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
    // Inside a token, and tokens do not overlap: nothing further can be nearer.
    if (distance === 0) break;
  }
  return best;
}

/**
 * The word a mark's edge stands on, read the way the edge means it (D181):
 * for a start, the first word at or after the offset; for an end, the last
 * word at or before it - an end's offset being its last character, the way
 * a painted range holds it. The nearest word would answer wrong at exactly
 * the edges the highlighter makes: a mark's own glued punctuation (D107)
 * stands as close to the word beside the mark as to the word it belongs to,
 * and `nearestWordIndex` breaks that tie toward the first token it meets.
 *
 * @param {import("./tokenize.js").Token[]} tokens
 * @param {number} offset
 * @param {"start" | "end"} edge
 * @returns {number} index into `tokens`, or -1 when no word stands on that side
 */
export function edgeWordIndex(tokens, offset, edge) {
  if (edge === "start") {
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if (token !== undefined && token.end > offset) return index;
    }
    return -1;
  }
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index];
    if (token !== undefined && token.start <= offset) return index;
  }
  return -1;
}
