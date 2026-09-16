/**
 * What a selection means, in the part of it that is not a page.
 *
 * Two questions live here, and they are here rather than in the content script
 * for the reason `sentence.js` is: neither needs a DOM, both were reported as
 * bugs that looked like something else, and this is where `node --test` can
 * reach them. What is left in `src/content/reading.js` is the half that has to
 * ask the browser - where the pointer was, and what the page has under it.
 */

import { keyTokens } from "./matcher/tokenize.js";

/**
 * How far a press may travel and still be a click rather than a drag. Four
 * pixels, because a hand resting on a mouse moves it and nobody means it.
 */
const DRAG_SLOP = 4;

/**
 * How many words a phrase may have before keeping it becomes a decision rather
 * than a consequence.
 *
 * Looking a word up is already the decision: a reader reaches for a translation
 * when the context did not give the meaning away, and that is exactly the word
 * worth meeting again. Asking them to confirm it is asking twice, in the middle
 * of a sentence they were reading.
 *
 * Longer than this and the selection is usually a sentence somebody wanted to
 * read rather than a phrase they wanted to keep - so that one waits for Save.
 */
const AUTO_KEEP_MAX_WORDS = 4;

/** What is to be done with a phrase that has just been translated. */
/** @typedef {"none" | "ask" | "automatic"} Keeping */

/**
 * Whether the gesture a release ends is one that could have made a selection.
 *
 * Firefox does not take a selection away when the press lands inside it: it
 * waits for the release, so that the text could have been dragged instead. The
 * content script listens in the capture phase, ahead of that - so a click meant
 * to dismiss the bubble arrives with the old selection still in the document,
 * and reading it answers a phrase nobody selected, out loud and with another
 * trip through the engine, over a page whose highlight is about to disappear.
 * With a selection spanning several paragraphs almost every click outside the
 * bubble lands inside the selection, which is exactly how this was reported.
 *
 * So the gesture decides rather than the document: a selection is made by
 * dragging or by a repeated click, and a single press that did not travel is a
 * click whatever `getSelection()` still says. Where the browser did collapse
 * the selection first this changes nothing - there was nothing to read either
 * way.
 *
 * @param {{ from: { x: number, y: number } | null, to: { x: number, y: number }, clicks: number }} gesture
 * @returns {boolean}
 */
export function madeSelection({ from, to, clicks }) {
  // A double click takes a word and a triple takes a paragraph, and neither of
  // them moves a pixel.
  if (clicks >= 2) return true;
  // No press of ours behind it: a synthetic release, or one whose press went
  // somewhere this never saw. Reading the selection is the older behaviour and
  // the safer guess.
  if (from === null) return true;
  return Math.abs(to.x - from.x) > DRAG_SLOP || Math.abs(to.y - from.y) > DRAG_SLOP;
}

/**
 * What happens to a phrase once its translation is in: nothing, a Save button,
 * or the vocabulary without anybody being asked (D22).
 *
 * Three selections have nothing to keep. One that is nothing but punctuation
 * has no key to be stored under; one whose translation came back empty has no
 * meaning to store; and one that no scan could find again would be stored into
 * a vocabulary that will never show it - a row in the database, a line in the
 * export and a card for something the reader will never meet marked on a page.
 * That last one is `findable` in `src/content/scan.js`, and it is what a
 * selection running from one paragraph into the next always is.
 *
 * `deliberate` is which of the listeners this selection came through, and only
 * a deliberate one may write without asking (D73, revised with D80). A mouse
 * gesture ends, and its end asserts the whole selection - the reader let go
 * exactly there; the reader page's own touch gesture ends in a `touchend` and
 * asserts the same. A selection that merely held still under a settle timer
 * asserts nothing: the system's handles report no end to a page, so the timer
 * answers mid-drag as readily as after it - and a device round of 0.2.5 showed
 * the first word of every dragged phrase being kept before the drag got going.
 * That channel now only ever shows; keeping there costs one press of Save.
 *
 * @param {{ normalized: string, gloss: string, findable: boolean, deliberate?: boolean }} phrase
 * @returns {Keeping}
 */
export function keeping({ normalized, gloss, findable, deliberate = true }) {
  if (normalized.length === 0 || gloss.length === 0 || !findable) return "none";
  if (!deliberate) return "ask";
  return keyTokens(normalized).length > AUTO_KEEP_MAX_WORDS ? "ask" : "automatic";
}

/**
 * Whether a pointer type selects the way a finger does.
 *
 * A pen is a finger here (D80): on a touch screen the system draws the same
 * selection bar and handles for both, and a stylus tap means what a fingertip
 * means. What stands apart is the mouse, whose gesture has an end the page can
 * hear - every gate that tells the two worlds apart asks this one question.
 *
 * @param {string} pointerType as a `PointerEvent` reports it
 * @returns {boolean}
 */
export function touchPointer(pointerType) {
  return pointerType === "touch" || pointerType === "pen";
}

/**
 * Whether a key press is the platform's copy chord - the reader page's
 * clipboard bridge (D110): its article refuses the native selection (D80,
 * D86), so Ctrl+C has nothing to copy there unless the page answers it.
 *
 * Exactly one of Ctrl and Meta, because the platforms disagree on which and
 * pressing both is no chord anybody's hand means. Shift is refused - Ctrl+
 * Shift+C is the browser's own door to its developer tools - and Alt turns
 * the key into a different character on some layouts. The uppercase `C` is
 * let through on purpose: Caps Lock changes what `key` says, not what the
 * hand asked for.
 *
 * @param {{ key: string, ctrl: boolean, meta: boolean, alt: boolean, shift: boolean }} press
 * @returns {boolean}
 */
export function copyCombo({ key, ctrl, meta, alt, shift }) {
  if (key !== "c" && key !== "C") return false;
  return ctrl !== meta && !alt && !shift;
}
