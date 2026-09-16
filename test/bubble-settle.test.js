import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { settleBack } from "../src/content/tooltip.js";

/**
 * The page put back when the bubble leaves (D138). The scroll assist and the
 * keyboard reveals (D97) move the reader's page to make room for the bubble,
 * and this is the rule that decides what closing it owes back: the whole of
 * the bubble's own scrolling when nothing else moved the page, nothing at
 * all when the reader scrolled meanwhile. The `scrollBy` that spends the
 * answer is the untestable half; the arithmetic is this one. All numbers
 * are document scroll offsets - `shown` where the page stood when the
 * bubble opened, `now` where it stands as it closes, `carried` the sum of
 * what the bubble itself scrolled, as actually performed.
 */
describe("settleBack", () => {
  it("undoes exactly what the bubble scrolled", () => {
    assert.equal(settleBack({ shown: 1000, now: 1316, carried: 316 }), -316);
  });

  it("undoes a ride that went up the same way", () => {
    // The assist that pulled a phrase back out from under the bar scrolled
    // the page up; closing scrolls it down again.
    assert.equal(settleBack({ shown: 1000, now: 962, carried: -38 }), 38);
  });

  it("owes nothing when the bubble never scrolled", () => {
    // The reader's own scrolling is not the bubble's to undo.
    assert.equal(settleBack({ shown: 1000, now: 1450, carried: 0 }), 0);
  });

  it("leaves a page the reader has scrolled where they put it", () => {
    // The assist moved 300 and the reader moved more - or back. A hand on
    // the page outranks the tidying, whichever way it went.
    assert.equal(settleBack({ shown: 1000, now: 1450, carried: 300 }), 0);
    assert.equal(settleBack({ shown: 1000, now: 1200, carried: 300 }), 0);
  });

  it("owes nothing when the reader has already gone back themselves", () => {
    // Undoing the assist by hand settles the debt too: there is no drift
    // left to heal, and scrolling now would move a page that is home.
    assert.equal(settleBack({ shown: 1000, now: 1000, carried: 300 }), 0);
  });

  it("aims at the shown spot, not by the carried sum", () => {
    // Engines land scrolls on device pixels: a stray pixel between the sum
    // and the drift is rounding, and the answer heals it by going to the
    // spot itself rather than stepping back by the sum.
    assert.equal(settleBack({ shown: 1000, now: 1301, carried: 300 }), -301);
  });
});
