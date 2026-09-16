import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lookupRowStands, popupRows, siteRowStands } from "../src/popup/rows.js";

/** @param {Partial<Parameters<typeof popupRows>[0]>} [state] */
const rows = (state = {}) =>
  popupRows({ translationOff: false, fresh: false, bubbleOff: false, pair: true, ...state });

describe("the site switch's own rule (D194)", () => {
  it("stands unless the bubble is switched off under the trim, and agrees with the rows", () => {
    for (const translationOff of [false, true]) {
      for (const bubbleOff of [false, true]) {
        const stands = siteRowStands({ translationOff, bubbleOff });
        assert.equal(stands, !(translationOff && bubbleOff));
        // The popup decides this row before it knows the rest (the models,
        // the pair): the two answers must never disagree.
        assert.equal(rows({ translationOff, bubbleOff, fresh: true, pair: false }).site, stands);
      }
    }
  });
});

describe("the look-up field's own rule (D197)", () => {
  it("stands wherever a pair is chosen, models or not, and agrees with the rows", () => {
    // The field asks the dictionaries in the pair's language and files the
    // phrase under the pair; the engine has no say, so neither does the
    // trim or a device with no model. Without a pair there is nowhere to
    // file - the signpost stands in the pair's place instead.
    for (const translationOff of [false, true]) {
      for (const bubbleOff of [false, true]) {
        for (const fresh of [false, true]) {
          for (const pair of [false, true]) {
            assert.equal(lookupRowStands({ pair }), pair);
            // Decided before the popup knows the rest (D194): the two
            // answers must never disagree.
            assert.equal(popupRows({ translationOff, bubbleOff, fresh, pair }).lookup, pair);
          }
        }
      }
    }
  });
});

describe("the popup's rows", () => {
  it("shows the pair on a device that has a model", () => {
    const shown = rows();
    assert.equal(shown.pair, true);
    assert.equal(shown.setup, false);
  });

  it("puts the signpost in the pair's place while nothing is installed", () => {
    const shown = rows({ fresh: true, pair: false });
    assert.equal(shown.pair, false);
    assert.equal(shown.setup, true);
  });

  it("takes the translating half away under the trim without a pair", () => {
    const shown = rows({ translationOff: true, pair: false });
    assert.equal(shown.pair, false);
    assert.equal(shown.setup, false);
    assert.equal(shown.vocabulary, false);
    assert.equal(shown.readerOnly, false);
  });

  it("has no folded-bubble switch any more (D197)", () => {
    // Set once and left: the settings page keeps it, and the popup keeps
    // what is flipped often (Michał's call, 2026-09-11).
    assert.equal("quiet" in rows(), false);
  });

  it("keeps the pair select under the trim with a pair, models or not (D165)", () => {
    // The pair still decides where saved phrases go and which language the
    // dictionaries answer in where a page declares none; a select that hid
    // while deciding both made the trim read as pairless (Michał's report).
    assert.equal(rows({ translationOff: true, pair: true }).pair, true);
    assert.equal(rows({ translationOff: true, pair: true, fresh: true }).pair, true);
    // The signpost is about a missing model, which the trim does not miss.
    assert.equal(rows({ translationOff: true, pair: true, fresh: true }).setup, false);
  });

  it("keeps the quiet vocabulary's rows under the trim with a pair (D162)", () => {
    // The switch turns off the model, not the bubble: with a pair the saved
    // phrases live and the ordinary pages read again, so their door and the
    // reader-only switch stand.
    const shown = rows({ translationOff: true });
    assert.equal(shown.vocabulary, true);
    assert.equal(shown.readerOnly, true);
    // The no-bubble sub-option leaves every ordinary page alone, and a
    // reader-only switch over pages already left alone chooses nothing.
    assert.equal(rows({ translationOff: true, bubbleOff: true }).readerOnly, false);
    assert.equal(rows({ translationOff: true, bubbleOff: true }).vocabulary, true);
  });

  it("lets the switch alone say the model is off - no note in the pair's place (D202)", () => {
    // The note that repeated the switch is gone: the ticked switch nine rows
    // down is the state, and the rule has no row for a sentence about it.
    assert.equal("translationNote" in rows({ translationOff: true }), false);
    // Nor the signpost: with the model off, a missing model is not what the
    // popup has to say.
    assert.equal(rows({ translationOff: true, fresh: true, pair: false }).setup, false);
  });

  it("keeps the switch that got there, whatever it did to the rest", () => {
    // The one row exempt from the hiding above: it is the way back, and a
    // mode that hides its own switch is a trap.
    for (const translationOff of [true, false]) {
      for (const fresh of [true, false]) {
        for (const bubbleOff of [true, false]) {
          for (const pair of [true, false]) {
            assert.equal(popupRows({ translationOff, fresh, bubbleOff, pair }).translation, true);
          }
        }
      }
    }
  });

  it("takes the site switch away only where it could change nothing (D149)", () => {
    // With the bubble switched off under the trim every ordinary page is
    // left alone already; a switch with no other side is not a choice.
    assert.equal(rows({ translationOff: true, bubbleOff: true }).site, false);
    assert.equal(rows({ translationOff: true }).site, true);
    // Under a hidden row the stored value never acts - the popup's rule too.
    assert.equal(rows({ bubbleOff: true }).site, true);
    assert.equal(rows({ fresh: true, pair: false }).site, true);
  });
});
