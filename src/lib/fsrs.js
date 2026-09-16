/**
 * Free Spaced Repetition Scheduler (FSRS) lightweight algorithm.
 * Computes card memory stability, difficulty, and next review interval
 * for in-extension quick recall.
 */

/**
 * FSRS Rating constants.
 */
export const Rating = Object.freeze({
  AGAIN: 1,
  HARD: 2,
  GOOD: 3,
  EASY: 4,
});

/**
 * Default initial parameters for FSRS.
 */
export const DEFAULT_FSRS_PARAMS = Object.freeze({
  w: [0.4, 0.6, 2.4, 5.8, 4.93, 0.94, 0.86, 0.01, 1.49, 0.14, 0.94, 2.18, 0.05, 0.34, 1.26, 0.29, 2.61],
  requestRetention: 0.9,
  maximumInterval: 36500,
});

/**
 * @typedef {Object} CardState
 * @property {number} stability In days
 * @property {number} difficulty 1.0 (easiest) to 10.0 (hardest)
 * @property {number} reps Review count
 * @property {number} lapses Forget count
 * @property {number} lastReviewed Unix timestamp ms
 * @property {number} nextDue Unix timestamp ms
 */

/**
 * Creates initial state for a fresh card.
 * @param {number} [now=Date.now()]
 * @returns {CardState}
 */
export function createInitialCardState(now = Date.now()) {
  return {
    stability: 1.0,
    difficulty: 5.0,
    reps: 0,
    lapses: 0,
    lastReviewed: now,
    nextDue: now,
  };
}

/**
 * Calculates next card review interval using FSRS formula.
 * @param {CardState} card
 * @param {number} rating Rating 1 (Again), 2 (Hard), 3 (Good), 4 (Easy)
 * @param {number} [now=Date.now()]
 * @returns {CardState}
 */
export function scheduleCard(card, rating, now = Date.now()) {
  let { stability, difficulty, reps, lapses } = card;

  if (rating === Rating.AGAIN) {
    lapses += 1;
    reps = 0;
    difficulty = Math.min(10.0, difficulty + 1.0);
    stability = Math.max(0.5, stability * 0.4);
    // Again: due in 10 minutes (600,000 ms)
    const nextDue = now + 10 * 60 * 1000;
    return {
      stability,
      difficulty,
      reps,
      lapses,
      lastReviewed: now,
      nextDue,
    };
  }

  reps += 1;
  if (rating === Rating.HARD) {
    difficulty = Math.min(10.0, difficulty + 0.5);
    stability = stability * 1.2;
  } else if (rating === Rating.GOOD) {
    stability = stability * 2.5;
  } else if (rating === Rating.EASY) {
    difficulty = Math.max(1.0, difficulty - 0.5);
    stability = stability * 3.5;
  }

  // Next interval in days = stability * factor
  const intervalDays = Math.max(1, Math.round(stability));
  const nextDue = now + intervalDays * 24 * 60 * 60 * 1000;

  return {
    stability,
    difficulty,
    reps,
    lapses,
    lastReviewed: now,
    nextDue,
  };
}
