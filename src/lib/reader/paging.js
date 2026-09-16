/**
 * Turning the page with the keyboard, and how far one turn goes.
 *
 * The reader's chrome is stuck over the article while one is on screen (D93):
 * no hiding on scroll, because a bar that moved would flash on an e-ink panel.
 * The browser knows nothing about it, so its own paging - a screenful minus a
 * small overlap - lands the top of the new screen *behind* the bar, and a few
 * lines of every page have to be scrolled back to (reported from a Boox Page,
 * whose hardware page keys send exactly these presses). `scroll-padding-top`
 * is no answer: it is honoured for scrolling something into view, and what a
 * keyboard's paging does with it is not something every engine agrees on.
 *
 * So the reader owns the keys, and the arithmetic and the rule live here,
 * without a DOM, for the reason `keys.js` gives about its own: a shortcut on
 * a page full of text has to say no far more often than yes, and every "no"
 * is somebody else's key.
 */

/** @typedef {"down" | "up"} PageTurn */

/**
 * What a press was aimed at, and what the page it was aimed at was doing.
 *
 * @typedef {object} Press
 * @property {string} key `KeyboardEvent.key`
 * @property {boolean} shift
 * @property {boolean} alt
 * @property {boolean} ctrl
 * @property {boolean} meta
 * @property {boolean} mac whether this is an Apple platform, where Option
 *   with an arrow is the system's own paging pair
 * @property {string} tag the tag name of what had focus, upper case, or `""`
 * @property {boolean} editable whether what had focus is being typed into
 * @property {boolean} reading whether the voice is reading right now
 * @property {boolean} dialog whether a dialog stands over the article
 */

/**
 * Text being typed into: every key in there is the box's, paging included -
 * a caret pages through the value, and moving the article underneath instead
 * would be this feature reaching into somebody's typing.
 */
const TYPING = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * What the space bar is aimed at when it is aimed at nothing in particular.
 * Anything else with focus - a button, a link, the host of a shadow root the
 * bubble lives in - keeps the key: the space bar is a press there, and only
 * the page's own body means "scroll me". The page keys need no such list;
 * they page whatever else has focus, because they mean nothing to a button.
 */
const PAGE_ITSELF = new Set(["", "BODY", "HTML"]);

/**
 * Which way this press turns the page, or null when the key is not ours.
 *
 * Shift is not in the list of modifiers that rule a press out: shift and the
 * space bar is how a page goes back, which is the pair every browser already
 * has. Alt, Control and Meta are the browser's and the system's - with one
 * exception: on the Mac, Option with an arrow is the platform's own way of
 * paging, so there the chord is exactly this feature's business.
 *
 * @param {Press} press
 * @returns {PageTurn | null}
 */
export function pageTurn(press) {
  // A dialog over the article - the contents, the search - pages its own
  // list. The article behind it is not what the press is about.
  if (press.dialog) return null;
  if (press.editable || TYPING.has(press.tag)) return null;

  // The Mac's own paging pair, for the keyboards that have no page keys
  // (reported from a K380, D170): Option with an arrow is how the platform
  // itself pages - Blink maps Alt-Up/Down to PageUp/Down on the Mac and
  // nowhere else (elsewhere an Alt-chord is a system key and is suppressed),
  // Gecko does the same through Cocoa's standard key bindings. Left to the
  // browser, the chord paged by the window and cut a line at the fold - the
  // very scroll D127 took the page keys back from. Bare Alt only: with
  // Shift the chord extends a selection, and off the Mac the modifier rule
  // below goes on holding.
  if (press.mac && press.alt && !press.shift && !press.ctrl && !press.meta) {
    if (press.key === "ArrowDown") return "down";
    if (press.key === "ArrowUp") return "up";
  }

  if (press.alt || press.ctrl || press.meta) return null;

  switch (press.key) {
    case "PageDown":
      return "down";
    case "PageUp":
      return "up";
    case " ":
      // While the voice reads, the space bar is the lector's (D87), and the
      // page scrolls itself anyway. The page keys stay ours either way: the
      // voice has no use for them.
      if (press.reading || !PAGE_ITSELF.has(press.tag)) return null;
      return press.shift ? "up" : "down";
    default:
      return null;
  }
}

/**
 * How far one turn moves the page: the readable strip of the window, less one
 * line kept on screen so that nothing falls between two pages.
 *
 * The floor is that one line. A panel left open makes the strip short enough
 * for the subtraction to reach zero, and a press that did nothing at all
 * would read as a dead key.
 *
 * @param {{ top: number, bottom: number }} band the window's readable strip,
 *   in viewport coordinates: under the stuck chrome, above whichever bar
 *   stands at the foot of the window
 * @param {number} overlap one line of the text being read
 * @returns {number} the distance in CSS pixels, always positive
 */
export function pageStep(band, overlap) {
  const height = Math.max(0, band.bottom - band.top);
  return Math.max(overlap, height - overlap);
}

/**
 * The nudge that squares a turn with the text. The step is the right length,
 * but blind to where the lines fall: whichever line then straddles the fold -
 * the lower edge of the stuck chrome - stands on screen cut in half by it.
 * Turning down, the nudge gives that line back, so a page never opens on half
 * a sentence; turning up, it tucks the line behind the bar, so the overlap
 * only ever grows. Either way the new page begins with a whole first line,
 * which is what a page of paper would do.
 *
 * Null stands for no line to square with - the fold in a picture, in the gap
 * between paragraphs, in nothing at all - and leaves the turn where the step
 * put it. So does a line taller than `limit` (a picture set in the text's own
 * flow can be taller than the step): a nudge that big would read as the page
 * jumping back, not as the turn settling.
 *
 * @param {PageTurn} turn
 * @param {number} fold the lower edge of the stuck chrome, in viewport
 *   coordinates
 * @param {{ top: number, bottom: number } | null} line the line box straddling
 *   the fold after the step, or null when no text stands there
 * @param {number} limit how far the nudge may reach, in CSS pixels
 * @returns {number} the signed distance still to scroll by; zero for a turn
 *   already square
 */
export function foldSnap(turn, fold, line, limit) {
  if (line === null) return 0;
  // Within a pixel is square: rects come back fractional, and chasing the
  // fraction would nudge every turn for nothing anyone could see.
  if (line.top >= fold - 1 || line.bottom <= fold + 1) return 0;
  const nudge = turn === "down" ? line.top - fold : line.bottom - fold;
  return Math.abs(nudge) > limit ? 0 : nudge;
}
