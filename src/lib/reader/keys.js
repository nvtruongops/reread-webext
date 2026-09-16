/**
 * Which key means what while the reader is reading aloud (D87).
 *
 * A rule rather than a listener, and in its own file, because it is the part
 * that was wrong twice: a keyboard shortcut on a page full of text has to say
 * no far more often than yes, and every "no" here is somebody else's key -
 * the space bar that scrolls, the space a filter box is entitled to, the space
 * a focused button answers with a press of its own. Kept without a DOM so the
 * whole of it can be read and tested at once.
 *
 * The one thing that is *not* decided here is whether anything is being read:
 * with the voice off, none of these keys is ours at all, and the caller
 * (`reader/reader.js`) asks that question before this one.
 */

/** @typedef {"toggle" | "back" | "forward" | "slower" | "faster"} SpeechAction */

/**
 * What a press was aimed at, as much of it as the rule needs.
 *
 * @typedef {object} Press
 * @property {string} key `KeyboardEvent.key`
 * @property {boolean} alt
 * @property {boolean} ctrl
 * @property {boolean} meta
 * @property {string} tag the tag name of what had focus, upper case, or `""`
 * @property {boolean} editable whether what had focus is being typed into
 */

/**
 * Text being typed into. Every key belongs to the box, including the arrows -
 * a caret moves with them, and stepping a sentence instead would be the
 * feature reaching into somebody's typing.
 */
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Things that answer the space bar by being pressed. Only the space bar is
 * theirs: the arrows and the speed keys mean nothing to a button, so a hand
 * that has just clicked Forward can still step back with the arrow it expects
 * to work. (The pointer's click leaves no focus behind at all - `reader.js`
 * blurs it - so in practice this is about a button reached with Tab.)
 */
const PRESSABLE = new Set(["BUTTON", "A", "SUMMARY"]);

/**
 * The action a press asks for, or null when the key is not ours.
 *
 * Shift is deliberately not in the list of modifiers that rule a press out:
 * `<` and `>` are shifted characters, and their `key` already says which one
 * arrived. Alt, Control and Meta are the browser's and the system's.
 *
 * @param {Press} press
 * @returns {SpeechAction | null}
 */
export function speechAction(press) {
  if (press.alt || press.ctrl || press.meta) return null;
  if (press.editable || TYPING.has(press.tag)) return null;

  switch (press.key) {
    case " ":
      return PRESSABLE.has(press.tag) ? null : "toggle";
    case "ArrowLeft":
      return "back";
    case "ArrowRight":
      return "forward";
    // Shift and the comma, shift and the full stop: the speed pair every video
    // player has, on the two keys that carry these characters here.
    case "<":
      return "slower";
    case ">":
      return "faster";
    default:
      return null;
  }
}
