import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { foldSnap, pageStep, pageTurn } from "../src/lib/reader/paging.js";

/**
 * A press, with the defaults of the ordinary case: no modifier, nothing
 * focused but the page itself, the voice off and no dialog up.
 *
 * @param {string} key
 * @param {Partial<import("../src/lib/reader/paging.js").Press>} [about]
 */
function press(key, about = {}) {
  return pageTurn({
    key,
    shift: false,
    alt: false,
    ctrl: false,
    meta: false,
    mac: false,
    tag: "BODY",
    editable: false,
    reading: false,
    dialog: false,
    ...about,
  });
}

describe("pageTurn", () => {
  it("answers the keys a page is turned with", () => {
    assert.equal(press("PageDown"), "down");
    assert.equal(press("PageUp"), "up");
    assert.equal(press(" "), "down");
    assert.equal(press(" ", { shift: true }), "up");
  });

  it("leaves every other key alone", () => {
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Enter", "a", "Escape"]) {
      assert.equal(press(key), null, key);
    }
  });

  it("gives the page keys away to a box being typed in", () => {
    for (const tag of ["INPUT", "TEXTAREA", "SELECT"]) {
      assert.equal(press("PageDown", { tag }), null, tag);
      assert.equal(press(" ", { tag }), null, tag);
    }
    assert.equal(press("PageUp", { editable: true }), null);
  });

  it("leaves a dialog to page its own list", () => {
    // The contents and the search stand over the article in a dialog of their
    // own, and their lists are what the press is about there.
    assert.equal(press("PageDown", { dialog: true }), null);
    assert.equal(press(" ", { dialog: true }), null);
  });

  it("keeps the page keys while something else holds focus", () => {
    // A button answers the space bar with a press of its own, but nothing
    // about a button answers PageDown - so the reading goes on being paged
    // by a hand that has just used the bar.
    for (const tag of ["BUTTON", "A", "SUMMARY", "DIV"]) {
      assert.equal(press("PageDown", { tag }), "down", tag);
      assert.equal(press(" ", { tag }), null, tag);
    }
  });

  it("hands the space bar to the voice, and keeps the page keys", () => {
    assert.equal(press(" ", { reading: true }), null);
    assert.equal(press(" ", { shift: true, reading: true }), null);
    assert.equal(press("PageDown", { reading: true }), "down");
    assert.equal(press("PageUp", { reading: true }), "up");
  });

  it("leaves the browser's and the system's own shortcuts alone", () => {
    for (const modifier of ["alt", "ctrl", "meta"]) {
      assert.equal(press("PageDown", { [modifier]: true }), null, modifier);
      assert.equal(press(" ", { [modifier]: true }), null, modifier);
    }
  });

  it("pages with no focus at all", () => {
    // What `event.target` says on a page nobody has clicked into yet.
    assert.equal(press(" ", { tag: "" }), "down");
  });

  it("pages with the Mac's own Option+Arrow pair", () => {
    // The report behind D170: a keyboard with no page keys, and the chord
    // the platform pages with going to the browser's window-blind scroll.
    assert.equal(press("ArrowDown", { mac: true, alt: true }), "down");
    assert.equal(press("ArrowUp", { mac: true, alt: true }), "up");
    // Like the page keys, the chord stays ours while the voice reads.
    assert.equal(press("ArrowDown", { mac: true, alt: true, reading: true }), "down");
  });

  it("leaves Option+Arrow alone off the Mac", () => {
    // Off the Mac an Alt-chord is a system key (Blink suppresses it there),
    // so the modifier rule keeps standing.
    assert.equal(press("ArrowDown", { alt: true }), null);
    assert.equal(press("ArrowUp", { alt: true }), null);
  });

  it("keeps the chord bare and the plain arrows free", () => {
    // With Shift the chord extends a selection; plain arrows scroll by
    // line, which the browser already does right (D127).
    assert.equal(press("ArrowDown", { mac: true, alt: true, shift: true }), null);
    assert.equal(press("ArrowDown", { mac: true, alt: true, ctrl: true }), null);
    assert.equal(press("ArrowDown", { mac: true, alt: true, meta: true }), null);
    assert.equal(press("ArrowDown", { mac: true }), null);
    assert.equal(press("ArrowUp", { mac: true }), null);
  });

  it("gives the chord away the way it gives every page key", () => {
    assert.equal(press("ArrowDown", { mac: true, alt: true, tag: "INPUT" }), null);
    assert.equal(press("ArrowDown", { mac: true, alt: true, editable: true }), null);
    assert.equal(press("ArrowDown", { mac: true, alt: true, dialog: true }), null);
  });
});

describe("pageStep", () => {
  it("moves a screenful of readable text, less one line", () => {
    assert.equal(pageStep({ top: 0, bottom: 800 }, 30), 770);
  });

  it("counts the stuck chrome out of the screenful", () => {
    // The whole bug: without the fold the step would be 770 and the first
    // 60 pixels of the new page would land behind the bar.
    assert.equal(pageStep({ top: 60, bottom: 800 }, 30), 710);
  });

  it("counts a bar standing at the foot of the window out too", () => {
    assert.equal(pageStep({ top: 60, bottom: 730 }, 30), 640);
  });

  it("still moves a line when the strip has been squeezed to nothing", () => {
    assert.equal(pageStep({ top: 400, bottom: 400 }, 30), 30);
    assert.equal(pageStep({ top: 500, bottom: 400 }, 30), 30);
  });
});

describe("foldSnap", () => {
  // A 30px line cut by a fold at 60: fifteen pixels stand behind the bar,
  // fifteen below it - the shape of the reported screen.
  const line = { top: 45, bottom: 75 };

  it("gives the cut line back when the page turns down", () => {
    assert.equal(foldSnap("down", 60, line, 385), -15);
  });

  it("tucks the cut line behind the bar when the page turns up", () => {
    assert.equal(foldSnap("up", 60, line, 385), 15);
  });

  it("leaves a turn that is already square", () => {
    // Nothing measurable under the fold: a picture, a gap, no text at all.
    assert.equal(foldSnap("down", 60, null, 385), 0);
    // The line starts at the fold, or stands wholly below it.
    assert.equal(foldSnap("down", 45, line, 385), 0);
    assert.equal(foldSnap("down", 40, line, 385), 0);
    // The line ends at the fold: behind the bar entirely, nothing cut.
    assert.equal(foldSnap("up", 75, line, 385), 0);
  });

  it("calls within a pixel square", () => {
    assert.equal(foldSnap("down", 45.5, line, 385), 0);
    assert.equal(foldSnap("up", 74.5, line, 385), 0);
  });

  it("never nudges further than the limit", () => {
    // A picture set in the text's own flow can stand taller than the step;
    // squaring with it would read as the page jumping, not settling.
    assert.equal(foldSnap("down", 860, { top: 60, bottom: 900 }, 385), 0);
    assert.equal(foldSnap("up", 100, { top: 60, bottom: 900 }, 385), 0);
  });
});
