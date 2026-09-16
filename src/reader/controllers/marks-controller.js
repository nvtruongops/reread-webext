/**
 * Reader Marks Controller.
 * Manages highlights, bookmarks, pin dragging, color palettes,
 * and quote healing across article and book revisions.
 */

import {
  compareMarks,
  comparePoints,
  fitsProse,
  handleAt,
  isMarkColor,
  markRecord,
  mergePlan,
  placeMark,
  reanchorMarks,
  reshapePlan,
  withoutMark,
} from "../../lib/reader/marks.js";

/** @typedef {import("../../lib/reader/marks.js").Mark} Mark */
/** @typedef {import("../../lib/reader/marks.js").MarkPoint} MarkPoint */

export class MarksController {
  /**
   * @param {Object} [options]
   * @param {Mark[]} [options.initialMarks]
   * @param {Function|null} [options.onMarksChange]
   */
  constructor({ initialMarks = [], onMarksChange = null } = {}) {
    /** @type {Mark[]} */
    this.marks = Array.isArray(initialMarks) ? [...initialMarks] : [];
    /** @type {Function|null} */
    this.onMarksChange = onMarksChange;
    this.currentColor = "yellow";
  }

  /**
   * Returns current active marks list sorted by document position.
   * @returns {Mark[]}
   */
  getMarks() {
    return [...this.marks].sort(compareMarks);
  }

  /**
   * Selects active highlighter color.
   * @param {string} color
   */
  setColor(color) {
    if (isMarkColor(color)) {
      this.currentColor = color;
    }
  }

  /**
   * Adds or replaces a mark in the document.
   * @param {Record<string, any>} mark
   * @returns {Mark|null}
   */
  saveMark(mark) {
    const validMark = markRecord(/** @type {any} */ (mark));
    if (!validMark) return null;

    this.marks = placeMark(this.marks, [], validMark);
    if (typeof this.onMarksChange === "function") {
      this.onMarksChange(this.getMarks());
    }
    return validMark;
  }

  /**
   * Removes a mark.
   * @param {Mark} mark
   */
  deleteMark(mark) {
    this.marks = withoutMark(this.marks, mark);
    if (typeof this.onMarksChange === "function") {
      this.onMarksChange(this.getMarks());
    }
  }

  /**
   * Attempts to heal/reanchor marks against modified or new prose blocks.
   * @param {string[][]} partsProse
   * @returns {{ marks: Mark[], healed: number, lost: number }}
   */
  reanchor(partsProse) {
    const result = reanchorMarks(partsProse, this.marks);
    this.marks = result.marks;
    if (typeof this.onMarksChange === "function") {
      this.onMarksChange(this.getMarks());
    }
    return result;
  }
}
