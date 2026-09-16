import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { revealShift } from "../src/content/tooltip.js";

/**
 * The editing bubble against the software keyboard (D97). The keyboard takes
 * the bottom of the screen without telling the layout anything; what says so
 * is the visual viewport shrinking, and this is the rule that answers it: how
 * far the bubble has to move for the box being typed in to sit inside what is
 * still visible. The listeners that ask it - and whether the answer is spent
 * on the page's scroll (the reader's anchored bubble) or on the bubble itself
 * (everywhere else) - are the untestable half; the arithmetic is this one.
 *
 * All numbers are viewport coordinates; `VIEWPORT_MARGIN` of 8 keeps the box
 * off the very edge, as everywhere in the bubble's placement.
 */

describe("revealShift", () => {
  it("moves nothing that is already visible", () => {
    assert.equal(revealShift({ must: { top: 100, bottom: 200 }, view: { top: 0, bottom: 600 } }), 0);
  });

  it("lifts a box the keyboard has covered up to the keyboard's edge", () => {
    // The view ends at 360 where the keyboard begins; the box's foot at 700
    // comes up to 352, the margin above that edge.
    assert.equal(revealShift({ must: { top: 400, bottom: 700 }, view: { top: 0, bottom: 360 } }), -348);
  });

  it("brings a box back down through the top margin", () => {
    assert.equal(revealShift({ must: { top: -50, bottom: 30 }, view: { top: 0, bottom: 600 } }), 58);
  });

  it("keeps the top of a box taller than the view", () => {
    // Both ends cannot be in; the top wins, because the box being typed in
    // starts there - the tail is what scrolling inside the box is for.
    assert.equal(revealShift({ must: { top: 100, bottom: 900 }, view: { top: 0, bottom: 600 } }), -92);
  });

  it("counts a pinch-zoomed view from its own offset, not from zero", () => {
    // The visual viewport can start below the layout's top; visibility is
    // measured against where it is, not where the window is.
    assert.equal(revealShift({ must: { top: 100, bottom: 200 }, view: { top: 300, bottom: 700 } }), 208);
  });

  it("answers in whole pixels", () => {
    assert.equal(revealShift({ must: { top: 400.4, bottom: 700.2 }, view: { top: 0, bottom: 360.5 } }), -348);
  });
});
