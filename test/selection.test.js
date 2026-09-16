import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { copyCombo, keeping, madeSelection, touchPointer } from "../src/lib/selection.js";

/**
 * The two rules of the reading side that do not need a page to be true: what a
 * mouse gesture meant, and what may be done with the phrase it produced.
 *
 * Everything around them is DOM and goes to `SMOKE-TESTS.md`. These two do not,
 * because both arrived as bug reports that looked like something else - a
 * bubble closing and opening itself again, and an underline that never came.
 */

const AT = { x: 100, y: 200 };

/**
 * @param {{ from?: { x: number, y: number } | null, to?: { x: number, y: number }, clicks?: number }} gesture
 */
function gesture({ from = AT, to = AT, clicks = 1 }) {
  return { from, to, clicks };
}

describe("madeSelection", () => {
  it("takes a press that travelled for a drag", () => {
    assert.equal(madeSelection(gesture({ to: { x: 400, y: 200 } })), true);
    assert.equal(madeSelection(gesture({ to: { x: 100, y: 260 } })), true);
  });

  it("takes a press that stayed put for a click", () => {
    // The bug: with several paragraphs selected, a click meant to dismiss the
    // bubble lands inside the selection - and Firefox still has that selection
    // when the release is caught. Reading it translated a phrase nobody
    // selected, over a page where the highlight was about to disappear.
    assert.equal(madeSelection(gesture({})), false);
  });

  it("forgives the shake of a hand resting on the mouse", () => {
    assert.equal(madeSelection(gesture({ to: { x: 103, y: 197 } })), false);
    assert.equal(madeSelection(gesture({ to: { x: 105, y: 200 } })), true);
  });

  it("takes a double or triple click for a selection, though nothing moved", () => {
    assert.equal(madeSelection(gesture({ clicks: 2 })), true);
    assert.equal(madeSelection(gesture({ clicks: 3 })), true);
  });

  it("reads the selection when no press of ours came first", () => {
    assert.equal(madeSelection(gesture({ from: null })), true);
  });
});

describe("keeping", () => {
  /**
   * @param {{ normalized?: string, gloss?: string, findable?: boolean, deliberate?: boolean }} phrase
   */
  const answer = ({ normalized = "ocean", gloss = "ocean", findable = true, deliberate = true }) =>
    keeping({ normalized, gloss, findable, deliberate });

  it("keeps a phrase of four words or fewer without being asked", () => {
    assert.equal(answer({ normalized: "ocean" }), "automatic");
    assert.equal(answer({ normalized: "the four great oceans" }), "automatic");
  });

  it("waits for Save on a longer one", () => {
    assert.equal(answer({ normalized: "all the four great oceans" }), "ask");
  });

  it("counts tokens rather than words, which an apostrophe splits", () => {
    // `world's` is two tokens, so this is five and waits for Save. The same
    // rule underlines it, so the count that decides is the matcher's own.
    assert.equal(answer({ normalized: "the world's four oceans" }), "ask");
  });

  it("keeps nothing that no page would ever show underlined", () => {
    // A selection running across two paragraphs, two list items or two cells of
    // a table. It translates like any other - it just cannot be kept, because
    // nothing would ever find it again.
    assert.equal(answer({ normalized: "intact getting your notes out", findable: false }), "none");
    // And a short one, which is the case that used to keep itself in silence.
    assert.equal(answer({ normalized: "milk bread", findable: false }), "none");
  });

  it("keeps nothing when there is no key or no translation", () => {
    assert.equal(answer({ normalized: "" }), "none");
    assert.equal(answer({ gloss: "" }), "none");
  });

  it("on a settled selection, never keeps by itself - not even one word", () => {
    // The settle timer cannot tell a finished gesture from a pause in the
    // middle of one (D73), and a device round of 0.2.5 showed what that costs:
    // dragging a phrase starts on a word, so the first word kept itself every
    // single time before the drag got going. The channel now only ever shows,
    // and keeping there is one press of Save (D80 revision of D73).
    assert.equal(answer({ normalized: "ocean", deliberate: false }), "ask");
    assert.equal(answer({ normalized: "milk bread", deliberate: false }), "ask");
    assert.equal(answer({ normalized: "the four great oceans", deliberate: false }), "ask");
  });

  it("keeps the other refusals over a settled selection too", () => {
    assert.equal(answer({ normalized: "milk bread", findable: false, deliberate: false }), "none");
    assert.equal(answer({ gloss: "", deliberate: false }), "none");
    assert.equal(answer({ normalized: "all the four great oceans", deliberate: false }), "ask");
  });
});

describe("copyCombo", () => {
  /**
   * @param {{ key?: string, ctrl?: boolean, meta?: boolean, alt?: boolean, shift?: boolean }} press
   */
  const combo = ({ key = "c", ctrl = false, meta = false, alt = false, shift = false }) =>
    copyCombo({ key, ctrl, meta, alt, shift });

  it("takes the platform's copy chord, whichever modifier the platform uses", () => {
    assert.equal(combo({ ctrl: true }), true);
    assert.equal(combo({ meta: true }), true);
  });

  it("lets Caps Lock through - the hand asked for the same chord", () => {
    assert.equal(combo({ key: "C", ctrl: true }), true);
  });

  it("refuses Shift, whose chord opens the browser's developer tools", () => {
    assert.equal(combo({ key: "C", ctrl: true, shift: true }), false);
  });

  it("refuses Alt, which types a different character on some layouts", () => {
    assert.equal(combo({ ctrl: true, alt: true }), false);
  });

  it("refuses both modifiers at once, and neither", () => {
    assert.equal(combo({ ctrl: true, meta: true }), false);
    assert.equal(combo({}), false);
  });

  it("answers only to the copy key", () => {
    assert.equal(combo({ key: "x", ctrl: true }), false);
    assert.equal(combo({ key: "Control", ctrl: true }), false);
  });
});

describe("touchPointer", () => {
  it("takes a finger and a pen for the world of system selection chrome", () => {
    // A pen is a finger here (D80): the system wraps its selection in the
    // same bar and handles, and neither ends in a gesture a page can hear.
    assert.equal(touchPointer("touch"), true);
    assert.equal(touchPointer("pen"), true);
  });

  it("keeps the mouse - and the unknown - in the world of gestures", () => {
    assert.equal(touchPointer("mouse"), false);
    // An empty type is a pointer this never saw press: claiming it is a
    // finger would put the system-strip gap under a bubble with no system
    // chrome to step around.
    assert.equal(touchPointer(""), false);
  });
});
