import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { placement } from "../src/content/tooltip.js";

/**
 * The bubble is placed by an edge rather than by a rectangle (D44): the answer
 * is the line of the near edge (`top`) and which way the rest hangs off it
 * (`grow`) - never a `bottom` computed from the viewport's height, which
 * Android's dynamic toolbar drags around (D77). Which edge it is decides which
 * way the bubble grows once the row of actions unfolds. That is the part no
 * smoke test can measure: on the screen a bubble eight pixels out of place
 * looks like a bubble.
 *
 * The numbers below are viewport coordinates, as everything here is: `GAP` is
 * 8 pixels between the phrase and the bubble, `VIEWPORT_MARGIN` another 8 from
 * the edges of the window, and a touch selection swaps `GAP` for `SYSTEM_GAP`
 * of 64 on either side - the strip the system's own selection bar and drag
 * handles live in (D74).
 */

const VIEWPORT = { width: 1000, height: 800 };

/**
 * @param {object} phrase
 * @param {number} phrase.top
 * @param {number} [phrase.height]
 * @param {number} [phrase.left]
 */
function at({ top, height = 20, left = 100 }) {
  return { top, bottom: top + height, left };
}

describe("placement", () => {
  it("stands above the phrase, hanging up from the line of its near edge", () => {
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
    });

    // The line is 8 pixels above the phrase; the bubble hangs upward from it,
    // so growing taller moves the top edge and never this line.
    assert.deepEqual(spot, { left: 100, top: 392, grow: "up" });
  });

  it("goes below the phrase when there is no room above it", () => {
    const spot = placement({
      anchor: at({ top: 30 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
    });

    assert.deepEqual(spot, { left: 100, top: 58, grow: "down" });
  });

  it("counts the folded row when it asks whether the bubble fits above", () => {
    // 60 tall fits above a phrase at 90 (90 - 8 - 60 = 22, past the margin);
    // the same bubble with its row unfolded is 90 tall and does not.
    const anchor = at({ top: 90 });
    const size = { width: 300, height: 60 };

    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT }), { left: 100, top: 82, grow: "up" });
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, folded: 30 }), {
      left: 100,
      top: 118,
      grow: "down",
    });
  });

  it("keeps a bubble below the phrase off the bottom of the window, row and all", () => {
    const anchor = at({ top: 40 });
    const size = { width: 300, height: 700 };

    // Eight pixels below the phrase puts the foot of it at 768, still inside.
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT }), { left: 100, top: 68, grow: "down" });
    // With the row unfolded it would not, so it comes up to make the room -
    // 800 less the margin less 730.
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, folded: 30 }), {
      left: 100,
      top: 62,
      grow: "down",
    });
  });

  it("never leaves the window, whichever way it is pushed", () => {
    const size = { width: 300, height: 60 };

    // Taller than everything: pinned to the top margin rather than off-screen.
    assert.deepEqual(placement({ anchor: at({ top: 10 }), size: { width: 300, height: 900 }, viewport: VIEWPORT }), {
      left: 100,
      top: 8,
      grow: "down",
    });
    // A phrase against the left edge of the window, and one against the right.
    assert.equal(placement({ anchor: at({ top: 400, left: 2 }), size, viewport: VIEWPORT }).left, 8);
    assert.equal(placement({ anchor: at({ top: 400, left: 950 }), size, viewport: VIEWPORT }).left, 692);
  });

  it("answers in whole pixels", () => {
    const spot = placement({
      anchor: at({ top: 400.4, left: 100.6 }),
      size: { width: 300.3, height: 60.7 },
      viewport: VIEWPORT,
    });

    assert.deepEqual(spot, { left: 101, top: 392, grow: "up" });
  });

  it("stands a system strip above a touch selection", () => {
    // Same side as a mouse selection, eight times the distance: the strip
    // between bubble and phrase belongs to the system's own selection bar,
    // so the two never cover each other (D74).
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      touch: true,
    });

    assert.deepEqual(spot, { left: 100, top: 336, grow: "up" });
  });

  it("keeps the strip when a touch bubble falls below the phrase", () => {
    // No room above once the strip is counted; below, the same distance now
    // steps past the drag handles hanging under the last line.
    const spot = placement({
      anchor: at({ top: 80 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      touch: true,
    });

    assert.deepEqual(spot, { left: 100, top: 164, grow: "down" });
  });

  it("counts the folded row against the strip too", () => {
    // 60 tall clears the strip above a phrase at 140 (140 - 64 - 60 = 16);
    // with the row unfolded it does not, and the bubble goes below.
    const anchor = at({ top: 140 });
    const size = { width: 300, height: 60 };

    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, touch: true }), {
      left: 100,
      top: 76,
      grow: "up",
    });
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, folded: 10, touch: true }), {
      left: 100,
      top: 224,
      grow: "down",
    });
  });

  it("clamps a touch bubble that fits nowhere, like any other", () => {
    const spot = placement({
      anchor: at({ top: 380 }),
      size: { width: 300, height: 700 },
      viewport: VIEWPORT,
      touch: true,
    });

    // 800 less the margin less 700: as much of it on the screen as there is
    // screen, even over the phrase - the last resort ignores no strip.
    assert.deepEqual(spot, { left: 100, top: 92, grow: "down" });
  });
});

/**
 * The anchored mode's ending for a bubble that fits nowhere (D97): instead of
 * covering the phrase, it stands below it and says how far the page has to
 * scroll for the two to share the screen. Only the reader's own page ever
 * passes `assist` - everywhere else the bubble is pinned to the viewport and
 * the page under it is not ours to move.
 */
describe("placement under the phrase (D182)", () => {
  // The launcher on a touch selection: the system's bar hovers over the
  // phrase, so the bubble goes under it - a system strip past the handles.
  it("stands under the phrase while it fits there", () => {
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      touch: true,
      below: true,
    });
    assert.deepEqual(spot, { left: 100, top: 484, grow: "down" });
  });

  it("goes above the phrase only when the room below has run out", () => {
    // 720 + 20 + 64 + 60 = 864, past the window's 792: above it is.
    const spot = placement({
      anchor: at({ top: 720 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      touch: true,
      below: true,
    });
    assert.deepEqual(spot, { left: 100, top: 656, grow: "up" });
  });

  it("clamps like anybody when neither side has the room", () => {
    const spot = placement({
      anchor: at({ top: 380, height: 40 }),
      size: { width: 300, height: 700 },
      viewport: VIEWPORT,
      touch: true,
      below: true,
    });
    assert.deepEqual(spot, { left: 100, top: 92, grow: "down" });
  });

  it("changes nothing for a bubble that did not ask", () => {
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      touch: true,
    });
    assert.deepEqual(spot, { left: 100, top: 336, grow: "up" });
  });
});

describe("placement with the scroll assist", () => {
  it("changes nothing while the bubble has a side to stand on", () => {
    const size = { width: 300, height: 60 };

    assert.deepEqual(placement({ anchor: at({ top: 400 }), size, viewport: VIEWPORT, assist: true }), {
      left: 100,
      top: 392,
      grow: "up",
    });
    assert.deepEqual(placement({ anchor: at({ top: 30 }), size, viewport: VIEWPORT, assist: true }), {
      left: 100,
      top: 58,
      grow: "down",
    });
  });

  it("scrolls the page below a phrase instead of covering it", () => {
    const spot = placement({
      anchor: at({ top: 380 }),
      size: { width: 300, height: 700 },
      viewport: VIEWPORT,
      assist: true,
    });

    // Below the whole phrase - the window can hold both - and the page moves
    // by what the bubble's foot still hangs past the bottom margin: 408 + 700
    // less 792.
    assert.deepEqual(spot, { left: 100, top: 408, grow: "down", scroll: 316 });
  });

  it("keeps the first line of a phrase too long to keep whole", () => {
    const spot = placement({
      anchor: at({ top: 300, height: 300 }),
      size: { width: 300, height: 500 },
      viewport: VIEWPORT,
      line: 20,
      assist: true,
    });

    // Phrase and bubble together measure 808 against 784 of window, so the
    // bubble stands under the first line and over the rest of the phrase -
    // the line the bubble is about is the part that must survive.
    assert.deepEqual(spot, { left: 100, top: 328, grow: "down", scroll: 36 });
  });

  it("never scrolls the kept line out through the top", () => {
    const spot = placement({
      anchor: at({ top: 300, height: 300 }),
      // Taller than the window can hold even beside one line: the scroll is
      // capped where the phrase's top would leave, and the foot stays cut.
      size: { width: 300, height: 900 },
      viewport: VIEWPORT,
      line: 20,
      assist: true,
    });

    assert.deepEqual(spot, { left: 100, top: 328, grow: "down", scroll: 292 });
  });

  it("scrolls back up to a phrase that has left through the top", () => {
    const spot = placement({
      anchor: at({ top: -100 }),
      size: { width: 300, height: 700 },
      viewport: VIEWPORT,
      assist: true,
    });

    // A negative answer: the page moves up until the phrase's line is back at
    // the margin, and the bubble stays below the phrase rather than being
    // clamped away from it.
    assert.deepEqual(spot, { left: 100, top: -72, grow: "down", scroll: -108 });
  });
});

/**
 * The reader page's own bar, stuck over the top of the text (D93), and what
 * it does to every spot above (D138): `covered` says how far down it reaches,
 * and the room to place in - or to scroll the kept line to - starts under
 * it. Without this, the assist parked the very line it kept for the reader
 * at the window's top margin, which on the reader page is beneath the bar:
 * the phrase the bubble answers was on the screen and unseeable. Only the
 * reader ever passes it, like `assist` - a foreign page's bars are as
 * unknowable as its scroll is untouchable.
 */
describe("placement over a stuck bar", () => {
  it("refuses the spot above when the bar has eaten it", () => {
    const anchor = at({ top: 90 });
    const size = { width: 300, height: 60 };

    // 90 - 8 - 60 = 22: past the window's margin, but 40 of bar stand over
    // it - so the bubble goes below instead of under the bar.
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, assist: true }), {
      left: 100,
      top: 82,
      grow: "up",
    });
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, assist: true, covered: 40 }), {
      left: 100,
      top: 118,
      grow: "down",
    });
  });

  it("counts the bar when it asks whether the whole phrase can stay", () => {
    const anchor = at({ top: 300, height: 100 });
    const size = { width: 300, height: 640 };

    // Phrase and bubble together measure 748: the bare window holds them
    // (784), the window less the bar (744) does not - so the bubble stands
    // under the first line instead of under the whole phrase.
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, line: 20, assist: true }), {
      left: 100,
      top: 408,
      grow: "down",
      scroll: 256,
    });
    assert.deepEqual(placement({ anchor, size, viewport: VIEWPORT, line: 20, assist: true, covered: 40 }), {
      left: 100,
      top: 328,
      grow: "down",
      scroll: 176,
    });
  });

  it("stops the scroll where the bar ends, not where the window does", () => {
    const spot = placement({
      anchor: at({ top: 300, height: 300 }),
      size: { width: 300, height: 900 },
      viewport: VIEWPORT,
      line: 20,
      assist: true,
      covered: 40,
    });

    // The same bubble the bare window caps at 292: the kept line may ride up
    // only to 48 - the bar and the margin - so the scroll stops at 252 and
    // the line stays visible under the bar, not beneath it.
    assert.deepEqual(spot, { left: 100, top: 328, grow: "down", scroll: 252 });
  });

  it("scrolls a phrase back out from under the bar", () => {
    const spot = placement({
      anchor: at({ top: 10 }),
      size: { width: 300, height: 700 },
      viewport: VIEWPORT,
      assist: true,
      covered: 40,
    });

    // A phrase at 10 is beneath a bar of 40. Below it is not an honest spot
    // while it cannot be seen: the page scrolls up by the negative answer
    // and the phrase's top lands at 48, just under the bar.
    assert.deepEqual(spot, { left: 100, top: 38, grow: "down", scroll: -38 });
  });
});

describe("placement holding its side (D177)", () => {
  it("stays below the phrase when told to, even where the spot above has come free", () => {
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      prefer: "down",
    });

    assert.deepEqual(spot, { left: 100, top: 428, grow: "down" });
  });

  it("stays above the phrase when told to and it still fits", () => {
    const spot = placement({
      anchor: at({ top: 400 }),
      size: { width: 300, height: 60 },
      viewport: VIEWPORT,
      prefer: "up",
    });

    assert.deepEqual(spot, { left: 100, top: 392, grow: "up" });
  });

  it("lets go of the side above when the bubble no longer fits there", () => {
    // 400 tall above a phrase at 300 does not fit (300 - 8 - 400 < 8), and a
    // side that cannot hold the bubble is no side to hold.
    const spot = placement({
      anchor: at({ top: 300 }),
      size: { width: 300, height: 400 },
      viewport: VIEWPORT,
      prefer: "up",
    });

    assert.equal(spot.grow, "down");
  });

  it("holds the side below through the scroll assist as well", () => {
    // Above would fit; below needs the page to move, and moves it.
    const spot = placement({
      anchor: at({ top: 600 }),
      size: { width: 300, height: 400 },
      viewport: VIEWPORT,
      assist: true,
      prefer: "down",
    });

    assert.equal(spot.grow, "down");
    assert.ok((spot.scroll ?? 0) > 0);
  });
});
