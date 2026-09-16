import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  Rating,
  createInitialCardState,
  scheduleCard,
} from "../src/lib/fsrs.js";

describe("FSRS Spaced Repetition Scheduler (Phase 3)", () => {
  it("initializes card state properly", () => {
    const card = createInitialCardState(1000000);
    assert.equal(card.stability, 1.0);
    assert.equal(card.difficulty, 5.0);
    assert.equal(card.reps, 0);
    assert.equal(card.lapses, 0);
    assert.equal(card.nextDue, 1000000);
  });

  it("handles AGAIN rating by incrementing lapses and resetting reps", () => {
    const card = createInitialCardState(1000000);
    card.reps = 3;
    const next = scheduleCard(card, Rating.AGAIN, 1000000);
    assert.equal(next.lapses, 1);
    assert.equal(next.reps, 0);
    assert.equal(next.difficulty, 6.0); // difficulty increased
    assert.equal(next.nextDue, 1000000 + 10 * 60 * 1000); // due in 10 minutes
  });

  it("extends interval on GOOD rating", () => {
    const card = createInitialCardState(1000000);
    const step1 = scheduleCard(card, Rating.GOOD, 1000000);
    assert.equal(step1.reps, 1);
    assert.ok(step1.stability > card.stability);
    assert.ok(step1.nextDue > 1000000);

    const step2 = scheduleCard(step1, Rating.GOOD, step1.nextDue);
    assert.equal(step2.reps, 2);
    assert.ok(step2.stability > step1.stability);
  });

  it("rewards EASY rating with lower difficulty and higher stability jump", () => {
    const card = createInitialCardState(1000000);
    const easy = scheduleCard(card, Rating.EASY, 1000000);
    assert.equal(easy.difficulty, 4.5);
    assert.equal(easy.stability, 3.5);
  });
});
