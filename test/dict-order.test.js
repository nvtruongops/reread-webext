import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { afterMove, answerOrder, inChosenOrder, nextRank } from "../src/lib/dict/order.js";

/**
 * The order the installed dictionaries answer in: the rule the settings page
 * arranges with and the lookup reads back. The database half (`rank` written
 * by `reorderDictionaries`, the upgrade that gives every stored dictionary its
 * first one) lives on IndexedDB and stays with the smoke tests.
 *
 * @param {string} id
 * @param {{ rank?: number, addedAt?: number }} [state]
 */
function dictionary(id, { rank, addedAt = 1 } = {}) {
  return rank === undefined ? { id, addedAt } : { id, addedAt, rank };
}

describe("answerOrder", () => {
  it("answers in the arranged order, whatever order the database hands over", () => {
    const stored = [
      dictionary("pl-en", { rank: 2 }),
      dictionary("en-en", { rank: 0 }),
      dictionary("en-pl", { rank: 1 }),
    ];
    assert.deepEqual(
      answerOrder(stored).map((one) => one.id),
      ["en-en", "en-pl", "pl-en"],
    );
  });

  it("leaves the given list alone", () => {
    const stored = [dictionary("b", { rank: 1 }), dictionary("a", { rank: 0 })];
    answerOrder(stored);
    assert.deepEqual(
      stored.map((one) => one.id),
      ["b", "a"],
    );
  });

  it("keeps import order where nothing has been arranged - the order before this existed", () => {
    const stored = [
      dictionary("second", { addedAt: 200 }),
      dictionary("third", { addedAt: 300 }),
      dictionary("first", { addedAt: 100 }),
    ];
    assert.deepEqual(
      answerOrder(stored).map((one) => one.id),
      ["first", "second", "third"],
    );
  });

  it("puts a dictionary nobody has placed after every one that has", () => {
    // What a half-written store looks like: an upgrade that only got through
    // some of its rows must not silently promote the ones it missed.
    const stored = [dictionary("unplaced", { addedAt: 1 }), dictionary("placed", { rank: 7, addedAt: 500 })];
    assert.deepEqual(
      answerOrder(stored).map((one) => one.id),
      ["placed", "unplaced"],
    );
  });

  it("settles two dictionaries stored in the same millisecond by id", () => {
    const stored = [dictionary("b", { addedAt: 1 }), dictionary("a", { addedAt: 1 })];
    assert.deepEqual(
      answerOrder(stored).map((one) => one.id),
      ["a", "b"],
    );
  });
});

describe("afterMove", () => {
  const ids = ["first", "second", "third"];

  it("swaps with the neighbour above", () => {
    assert.deepEqual(afterMove(ids, "third", -1), ["first", "third", "second"]);
  });

  it("swaps with the neighbour below", () => {
    assert.deepEqual(afterMove(ids, "first", 1), ["second", "first", "third"]);
  });

  it("moves nothing at the end the arrow points towards", () => {
    assert.equal(afterMove(ids, "first", -1), null);
    assert.equal(afterMove(ids, "third", 1), null);
  });

  it("moves nothing for a dictionary that is no longer there", () => {
    // A second settings page deleted it between the render and the press.
    assert.equal(afterMove(ids, "deleted", -1), null);
  });

  it("leaves the given list alone", () => {
    afterMove(ids, "first", 1);
    assert.deepEqual(ids, ["first", "second", "third"]);
  });
});

describe("inChosenOrder", () => {
  it("follows the list the page decided on", () => {
    const stored = [
      dictionary("a", { rank: 0 }),
      dictionary("b", { rank: 1 }),
      dictionary("c", { rank: 2 }),
    ];
    assert.deepEqual(
      inChosenOrder(stored, ["c", "a", "b"]).map((one) => one.id),
      ["c", "a", "b"],
    );
  });

  it("keeps what the list never named, after it and in its own order", () => {
    // The dictionary a second page imported while this one was being arranged:
    // it belongs at the end, not wherever a missing rank would drop it.
    const stored = [
      dictionary("a", { rank: 0 }),
      dictionary("b", { rank: 1 }),
      dictionary("fresh", { addedAt: 900 }),
    ];
    assert.deepEqual(
      inChosenOrder(stored, ["b", "a"]).map((one) => one.id),
      ["b", "a", "fresh"],
    );
  });

  it("ignores an id whose dictionary is gone", () => {
    const stored = [dictionary("a", { rank: 0 }), dictionary("b", { rank: 1 })];
    assert.deepEqual(
      inChosenOrder(stored, ["b", "deleted", "a"]).map((one) => one.id),
      ["b", "a"],
    );
  });
});

describe("nextRank", () => {
  it("puts an import behind everything already stored", () => {
    assert.equal(nextRank([dictionary("a", { rank: 0 }), dictionary("b", { rank: 4 })]), 5);
  });

  it("starts at zero on an empty store", () => {
    assert.equal(nextRank([]), 0);
  });

  it("starts at zero where nothing carries a rank yet", () => {
    // Only reachable if the upgrade never ran; the import must still get a
    // number rather than NaN.
    assert.equal(nextRank([dictionary("a"), dictionary("b")]), 0);
  });
});
