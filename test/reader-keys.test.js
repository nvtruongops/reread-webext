import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { speechAction } from "../src/lib/reader/keys.js";

/**
 * A press, with the defaults of the ordinary case: no modifier, nothing
 * focused but the page itself.
 *
 * @param {string} key
 * @param {Partial<import("../src/lib/reader/keys.js").Press>} [about]
 */
function press(key, about = {}) {
  return speechAction({
    key,
    alt: false,
    ctrl: false,
    meta: false,
    tag: "BODY",
    editable: false,
    ...about,
  });
}

describe("speechAction", () => {
  it("answers the five keys the bar has buttons for", () => {
    assert.equal(press(" "), "toggle");
    assert.equal(press("ArrowLeft"), "back");
    assert.equal(press("ArrowRight"), "forward");
    assert.equal(press("<"), "slower");
    assert.equal(press(">"), "faster");
  });

  it("keeps the arrows and the speed keys while a button holds focus", () => {
    // The bug this rule was rewritten for: reading is always started by
    // pressing a button, so a button is exactly what has focus when somebody
    // reaches for a key. Refusing every press aimed at one left the whole
    // keyboard dead.
    for (const tag of ["BUTTON", "A", "SUMMARY"]) {
      assert.equal(press("ArrowRight", { tag }), "forward");
      assert.equal(press("<", { tag }), "slower");
    }
  });

  it("leaves the space bar to a button that has focus", () => {
    // A button answers the space bar by pressing itself, and two answers to
    // one press would cancel out. Only a pointer leaves focus on a button
    // without meaning to, and the page takes that focus back (`reader.js`).
    assert.equal(press(" ", { tag: "BUTTON" }), null);
    assert.equal(press(" ", { tag: "A" }), null);
    assert.equal(press(" ", { tag: "SUMMARY" }), null);
  });

  it("takes nothing at all from something being typed into", () => {
    // Including the arrows: a caret moves with them, and stepping a sentence
    // instead would be reaching into somebody's typing.
    for (const key of [" ", "ArrowLeft", "ArrowRight", "<", ">"]) {
      assert.equal(press(key, { tag: "INPUT" }), null);
      assert.equal(press(key, { tag: "TEXTAREA" }), null);
      assert.equal(press(key, { tag: "SELECT" }), null);
      assert.equal(press(key, { editable: true }), null);
    }
  });

  it("leaves a modified press to the browser and the system", () => {
    assert.equal(press(" ", { alt: true }), null);
    assert.equal(press(" ", { ctrl: true }), null);
    assert.equal(press(" ", { meta: true }), null);
    assert.equal(press("ArrowRight", { ctrl: true }), null);
    assert.equal(press("<", { meta: true }), null);
  });

  it("reads the shifted character, not the key under it", () => {
    // Shift is not one of the modifiers that rule a press out, and it must not
    // be: `<` and `>` only exist with it held.
    assert.equal(press("<"), "slower");
    assert.equal(press(">"), "faster");
    assert.equal(press(","), null);
    assert.equal(press("."), null);
  });

  it("answers nothing for every other key", () => {
    for (const key of ["a", "Enter", "Escape", "ArrowUp", "ArrowDown", "PageDown", ",", "."]) {
      assert.equal(press(key), null);
    }
  });
});
