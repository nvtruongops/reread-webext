/**
 * The rules of the reading position, with no DOM and no database in sight -
 * the same split as `saved-article.js` next to `articles.js`, so that every
 * decision here runs under `node --test`.
 *
 * A position is a structural anchor, `{segmentIndex, blockIndex}`: which
 * top-level block of which segment was at the top of the screen. Structural
 * rather than a scroll offset because the offset breaks at the first change
 * of font size or measure, while the block order is rebuilt identically from
 * the same stored markup every time. Articles are one segment (`segmentIndex`
 * 0); books, when they come, will use the same record with a real index.
 *
 * Losing a position must never cost more than starting a document from the
 * top, which is why everything here answers `null` rather than throwing: a
 * torn row, a stale index, a document that shrank - all of them mean "the
 * top", never an error anybody has to read.
 */

/**
 * How long after the last scroll the position is written, in milliseconds.
 * Long enough that a page being scrolled through is not written about at
 * every step, short enough that closing a tab a breath after stopping still
 * finds the position saved.
 */
export const POSITION_SAVE_DELAY = 1500;

/**
 * `percent` is how far down the segment the view had reached when the save
 * was taken, 0-100 - the bottom edge of the window over the whole scroll
 * height. It is garnish on the anchor, not part of it: the list turns it
 * into "n% read", and the restore uses it to find a place inside a block
 * taller than the window, where the anchor alone can only mean the top.
 * A row without it is still a whole position - rows written before the
 * field existed keep working, they just have nothing to garnish.
 *
 * @typedef {{
 *   docId: string,
 *   segmentIndex: number,
 *   blockIndex: number,
 *   updatedAt: number,
 *   percent?: number,
 * }} ReadingPosition
 */

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isIndex(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isPercent(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

/**
 * Builds the record a save writes, or nothing when there is nothing worth
 * writing - no document to belong to, or an index that is not a place.
 * A percent that is not one is left off rather than refused whole: the
 * anchor is the record's reason to exist, the percent only rides along.
 *
 * @param {string} docId
 * @param {number} segmentIndex
 * @param {number} blockIndex
 * @param {number} now
 * @param {number | null} [percent]
 * @returns {ReadingPosition | null}
 */
export function positionRecord(docId, segmentIndex, blockIndex, now, percent) {
  if (typeof docId !== "string" || docId.length === 0) return null;
  if (!isIndex(segmentIndex) || !isIndex(blockIndex)) return null;
  if (typeof now !== "number" || !Number.isFinite(now)) return null;
  const record = { docId, segmentIndex, blockIndex, updatedAt: now };
  return isPercent(percent) ? { ...record, percent } : record;
}

/**
 * A row as it came back from the database, narrowed field by field. Anything
 * short of a whole position reads as no position at all - half an anchor
 * points nowhere. A broken percent drops alone, because the anchor it rode
 * on is still a place.
 *
 * @param {unknown} value
 * @returns {ReadingPosition | null}
 */
export function asPosition(value) {
  if (typeof value !== "object" || value === null) return null;
  const { docId, segmentIndex, blockIndex, updatedAt, percent } =
    /** @type {Record<string, unknown>} */ (value);
  if (typeof docId !== "string" || docId.length === 0) return null;
  if (!isIndex(segmentIndex) || !isIndex(blockIndex)) return null;
  const row = {
    docId,
    segmentIndex,
    blockIndex,
    updatedAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0,
  };
  return isPercent(percent) ? { ...row, percent } : row;
}

/**
 * How far the reading has reached, as the save measures it: the bottom edge
 * of the window over the whole height of the document, in whole percent.
 * The bottom edge rather than the top, because "read" is what has passed
 * before the eyes - a window standing at the very end has read everything,
 * and one that never moved has still read its first screenful.
 *
 * @param {number} scrollY
 * @param {number} viewportHeight
 * @param {number} scrollHeight
 * @returns {number | null} 0-100, or null when there is nothing to measure
 */
export function measuredPercent(scrollY, viewportHeight, scrollHeight) {
  if (!Number.isFinite(scrollY) || !Number.isFinite(viewportHeight) || !Number.isFinite(scrollHeight))
    return null;
  if (scrollHeight <= 0 || viewportHeight <= 0) return null;
  const edge = (scrollY + viewportHeight) / scrollHeight;
  return Math.min(100, Math.max(0, Math.round(edge * 100)));
}

/**
 * What the list says about a whole document, from a row about one segment:
 * an article is its own whole, a book counts the parts before the remembered
 * one as read through. Approximate on purpose - parts are cut by size, not
 * born equal - and honest enough for a line of detail. A row from before the
 * percent existed still places a book at its remembered part.
 *
 * @param {ReadingPosition | null} position
 * @param {number} segmentCount
 * @returns {number | null} 0-100, or null when nothing was ever read
 */
export function overallPercent(position, segmentCount) {
  if (position === null) return null;
  if (!Number.isInteger(segmentCount) || segmentCount <= 1) return position.percent ?? null;
  const within = (position.percent ?? 0) / 100;
  const whole = (position.segmentIndex + within) / segmentCount;
  return Math.min(100, Math.max(0, Math.round(whole * 100)));
}

/**
 * The place inside a block too tall for the anchor to mean anything but its
 * top - the one shape of text (a single endless paragraph) where "which
 * block" answers nothing. The stored percent is turned back into the scroll
 * offset it was measured from, then held inside the block's own span so a
 * stale number can never carry the view out of the anchored block. Blocks
 * that fit the window answer null: the anchor already said everything.
 *
 * @param {number} blockTop the block's top, in document coordinates
 * @param {number} blockHeight
 * @param {number} viewportHeight
 * @param {number | undefined} percent the stored percent, if the row had one
 * @param {number} scrollHeight
 * @returns {number | null} the scroll offset to take instead, or null
 */
export function fineScrollTop(blockTop, blockHeight, viewportHeight, percent, scrollHeight) {
  if (!isPercent(percent)) return null;
  if (!Number.isFinite(blockTop) || !Number.isFinite(blockHeight)) return null;
  if (!Number.isFinite(viewportHeight) || viewportHeight <= 0) return null;
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return null;
  if (blockHeight <= viewportHeight) return null;
  const fromPercent = (percent / 100) * scrollHeight - viewportHeight;
  const lowest = blockTop + blockHeight - viewportHeight;
  return Math.round(Math.min(lowest, Math.max(blockTop, fromPercent)));
}

/**
 * The block to scroll to when a document opens, or `null` for the top. `null`
 * covers every way a stored position can fail to be a place in the document
 * on screen: no record, a record about another segment, an index past the end
 * of a document that has since been overwritten by a shorter one.
 *
 * @param {ReadingPosition | null} position
 * @param {number} segmentIndex the segment being rendered
 * @param {number} blockCount how many top-level blocks it has
 * @returns {number | null}
 */
export function restoredIndex(position, segmentIndex, blockCount) {
  if (position === null) return null;
  if (position.segmentIndex !== segmentIndex) return null;
  if (position.blockIndex >= blockCount) return null;
  return position.blockIndex;
}

/**
 * Which block a horizontal line through the page falls on: the first whose
 * bottom edge is still below the line - the block being read when the line is
 * the top of the visible text. This is the fallback of the save measurement,
 * for when `elementFromPoint` lands on something that is not a block: the
 * margin between two paragraphs, or the bubble standing over the point.
 *
 * Scrolled past everything, the last block is the answer - there is no
 * further place to mean. An empty document has no place at all.
 *
 * @param {Array<{ bottom: number }>} rects the blocks' rects, in block order
 * @param {number} y the line, in the same coordinates
 * @returns {number | null}
 */
export function blockAtLine(rects, y) {
  if (rects.length === 0) return null;
  const at = rects.findIndex((rect) => rect.bottom > y);
  return at === -1 ? rects.length - 1 : at;
}
