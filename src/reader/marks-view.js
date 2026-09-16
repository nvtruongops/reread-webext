/**
 * The highlighter's marks on the rendered article: anchors turned into DOM
 * ranges and back, and the painting of the dried strokes (D106).
 *
 * This is the DOM half of `lib/reader/marks.js`, split the way `position.js`
 * splits from `reader.js`: the rules run under `node --test`, and what is
 * left here is the part that has to ask the document - which text node an
 * offset lands in, which boxes a range paints, what the prose of a block
 * reads. The prose is `prosePieces`' - the read-aloud walk, block boundaries
 * as line breaks - joined and located with the matcher's own arithmetic, so
 * an anchor written today reads back through the same walk tomorrow.
 *
 * Painting goes through the highlight registry like every mark this
 * extension makes: one registered highlight per colour worn, priority below
 * everything - the selection, the recall wash, the read-aloud washes all
 * carry newer news than a mark that has been standing since yesterday. The
 * underlines cross freely either way: they are a text decoration, a mark is
 * a background, and the two do not compete for a pixel.
 *
 * The quote guard lives at the door of every paint: a mark whose anchored
 * offsets no longer read back its own quote - a sanitizer tightened since it
 * was written, mostly - is left unpainted and untouched, exactly the
 * position's bargain (losing paint costs highlighting again; painting the
 * wrong words would cost trust).
 */

import { supported, unregister } from "../content/highlighter.js";
import { prosePieces } from "../content/scan.js";
import { joinPieces, locate } from "../lib/matcher/spans.js";
import {
  MARK_COLORS,
  findQuote,
  headRect,
  markRecord,
  marksInSegment,
  quoteOf,
  tailRect,
} from "../lib/reader/marks.js";

/** @typedef {import("../lib/reader/marks.js").Mark} Mark */
/** @typedef {import("../lib/reader/marks.js").MarkSpan} MarkSpan */

/**
 * The registry names, one per colour: `reread-marker-yellow` and its
 * siblings. The prefix must be what `reader.css` styles - `marks.test.js`
 * holds the two files to the same names.
 */
const NAME_PREFIX = "reread-marker-";

/** What is painted right now, for the tap's hit-test. */
/** @type {{ mark: Mark, range: Range }[]} */
let painted = [];

/**
 * One block's prose and the arithmetic to move around it - the same shape
 * the selection's geometry carries, without the tokens: a stored mark needs
 * no tokenizer, its ends were snapped to words the day it was drawn.
 *
 * @param {Element} block
 * @returns {{ parts: import("../content/scan.js").BlockPart[], text: string, spans: import("../lib/matcher/spans.js").Span[] }}
 */
function blockProse(block) {
  const parts = prosePieces(block);
  const { text, spans } = joinPieces(parts.map((part) => part.text));
  return { parts, text, spans };
}

/**
 * Which top-level block of the content root a node lives under, as an index
 * into the root's children - the block half of an anchor, the same counting
 * the reading position does. Null for a node outside the root, and for the
 * rare stray text standing directly under it: text in no block has no place
 * in the block order for a mark to be written at.
 *
 * @param {Node} node
 * @param {Element} root
 * @returns {number | null}
 */
function topIndexOf(node, root) {
  let element = node instanceof Element ? node : node.parentElement;
  for (; element !== null; element = element.parentElement) {
    if (element.parentElement === root) {
      return Array.prototype.indexOf.call(root.children, element);
    }
  }
  return null;
}

/**
 * Where a range endpoint sits in its block's prose. Null when the endpoint
 * is not a text node of that prose - which every caller reads as "this
 * cannot be anchored", never as an error.
 *
 * @param {ReturnType<typeof blockProse>} prose
 * @param {Node} node
 * @param {number} offset
 * @returns {number | null}
 */
function proseOffset(prose, node, offset) {
  const index = prose.parts.findIndex((part) => part.node === node);
  const span = prose.spans[index];
  if (index === -1 || span === undefined) return null;
  return span.start + offset;
}

/**
 * A finished stroke as an anchor: the two endpoints read against the block
 * order and the blocks' prose. Null whenever any part of that reading fails,
 * and the stroke simply does not become a mark.
 *
 * @param {Range} range
 * @param {Element} root the rebuilt content root, whose children are the blocks
 * @param {number} segmentIndex
 * @returns {MarkSpan | null}
 */
export function anchorOf(range, root, segmentIndex) {
  const startBlock = topIndexOf(range.startContainer, root);
  const endBlock = topIndexOf(range.endContainer, root);
  if (startBlock === null || endBlock === null) return null;
  const first = root.children[startBlock];
  const last = root.children[endBlock];
  if (first === undefined || last === undefined) return null;

  const start = proseOffset(blockProse(first), range.startContainer, range.startOffset);
  const end = proseOffset(blockProse(last), range.endContainer, range.endOffset);
  if (start === null || end === null) return null;

  return {
    segmentIndex,
    start: { block: startBlock, offset: start },
    end: { block: endBlock, offset: end },
  };
}

/**
 * The text a span covers, read off the document - the quote a new mark is
 * written with, and the reading the guard compares a stored one against.
 * One assembly (`quoteOf`) serves both, so they cannot drift.
 *
 * @param {MarkSpan} span
 * @param {Element} root
 * @returns {string | null}
 */
export function quoteOfSpan(span, root) {
  /** @type {string[]} */
  const texts = [];
  for (let at = span.start.block; at <= span.end.block; at += 1) {
    const block = root.children[at];
    if (block === undefined) return null;
    texts.push(blockProse(block).text);
  }
  return quoteOf(texts, span.start, span.end);
}

/**
 * @param {ReturnType<typeof blockProse>} prose
 * @param {number} offset
 * @returns {{ node: Text, offset: number } | null}
 */
function placeIn(prose, offset) {
  const place = locate(prose.spans, offset);
  const node = place === null ? null : (prose.parts[place.piece]?.node ?? null);
  if (place === null || node === null) return null;
  return { node, offset: place.offset };
}

/**
 * A stored mark back on the document, or null when the document no longer
 * reads the way the mark remembers - the quote guard. The end is located at
 * its last character rather than the position after it, the underline
 * painter's own trick: an end on a piece boundary stays in the piece the
 * text is in.
 *
 * @param {Mark} mark
 * @param {Element} root
 * @returns {Range | null}
 */
function rangeOfMark(mark, root) {
  if (quoteOfSpan(mark, root) !== mark.text) return null;
  const first = root.children[mark.start.block];
  const last = root.children[mark.end.block];
  if (first === undefined || last === undefined) return null;

  const start = placeIn(blockProse(first), mark.start.offset);
  const end = placeIn(blockProse(last), mark.end.offset - 1);
  if (start === null || end === null) return null;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/**
 * A range over one span of one block's prose - the search jump's landing
 * (D119), built from the same walk and the same locate arithmetic as a
 * mark's paint, so an offset measured against the prose reads back onto the
 * same letters. The end is located at its last character, `rangeOfMark`'s
 * own trick: an end on a piece boundary stays in the piece the text is in.
 * Null when the block or either endpoint is not there to stand on.
 *
 * @param {Element} root the rebuilt content root, whose children are the blocks
 * @param {number} blockIndex
 * @param {number} from
 * @param {number} to exclusive
 * @returns {Range | null}
 */
export function rangeWithin(root, blockIndex, from, to) {
  const block = root.children[blockIndex];
  if (block === undefined || to <= from) return null;
  const prose = blockProse(block);
  const start = placeIn(prose, from);
  const end = placeIn(prose, to - 1);
  if (start === null || end === null) return null;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

/**
 * Every mark of the segment on screen, painted - and nothing else: the call
 * replaces whatever was painted before, so it is also how a deleted mark
 * disappears.
 *
 * A mark the guard refuses is looked for by its quote before it is given up
 * on (D169): the segment's prose is searched, and a quote standing in
 * exactly one place is where the mark now is - painted there, read back
 * through the same guard first, and handed to the caller as a healed record
 * to put in the document's list and write. What the search cannot find, or
 * finds twice, stays in the caller's list and in the database unpainted,
 * the guard's bargain as it always was.
 *
 * @param {Mark[]} marks the document's marks, every segment
 * @param {Element | null} root
 * @param {number} segmentIndex
 * @returns {{ from: Mark, to: Mark }[]} the marks healed by this paint, the
 *   record each stood as and the record it stands as now
 */
export function paintMarks(marks, root, segmentIndex) {
  clearMarkPaint();
  /** @type {{ from: Mark, to: Mark }[]} */
  const healed = [];
  if (!supported() || root === null) return healed;

  // The segment's prose, read once - and only once a mark needs it: the
  // ordinary paint of marks that all still fit costs no extra walk.
  /** @type {string[] | null} */
  let prose = null;
  /** @type {Map<string, Highlight>} */
  const groups = new Map();
  for (const stored of marksInSegment(marks, segmentIndex)) {
    let mark = stored;
    let range = rangeOfMark(mark, root);
    if (range === null) {
      prose ??= Array.from(root.children, (block) => blockProse(block).text);
      const span = findQuote(prose, mark.text);
      const found = span === null ? null : markRecord({ ...mark, ...span });
      range = found === null ? null : rangeOfMark(found, root);
      if (found === null || range === null) continue;
      healed.push({ from: stored, to: found });
      mark = found;
    }
    let group = groups.get(mark.color);
    if (group === undefined) {
      group = new Highlight();
      // Below everything: every other paint on this page is newer news than
      // a mark that may have been standing since yesterday.
      group.priority = -1;
      groups.set(mark.color, group);
    }
    group.add(range);
    painted.push({ mark, range });
  }
  for (const [color, group] of groups) CSS.highlights.set(NAME_PREFIX + color, group);
  return healed;
}

/** Every dried stroke off the registry - a view change, or a repaint's first step. */
export function clearMarkPaint() {
  painted = [];
  for (const color of MARK_COLORS) unregister(NAME_PREFIX + color);
}

/**
 * Which mark, if any, is under a point in the viewport - the mark toolbar's
 * question, answered the way underline hit-testing answers it: the painted
 * ranges are known, so their own boxes decide. The painted range rides along
 * for one reader - the wash that says which mark the toolbar is about is
 * painted over it - and the caller looks, never keeps.
 *
 * @param {number} x
 * @param {number} y
 * @returns {{ mark: Mark, range: Range, rect: DOMRect } | null}
 */
export function markAt(x, y) {
  for (const { mark, range } of painted) {
    for (const rect of range.getClientRects()) {
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      return { mark, range, rect };
    }
  }
  return null;
}

/**
 * The painted range of one mark, by identity - how a mark that was just
 * committed becomes the active one (D107): the pins need its boxes, and the
 * paint already built them.
 *
 * @param {Mark} mark
 * @returns {Range | null}
 */
export function paintedRangeOf(mark) {
  for (const entry of painted) {
    if (entry.mark === mark) return entry.range;
  }
  return null;
}

/**
 * A replaced record adopted by the paint, the range standing as it is - for
 * an edit that moves no endpoint, which today means a note. The records are
 * immutable (a failed write rolls back to the untouched list), so an edit
 * puts a new object in the document's list - but this registry answers by
 * identity, and left holding the old object it goes quietly stale: the note
 * badge finds no painted range to stand on until the next full paint, and a
 * tap's hit-test hands back a record without the note just written. Adopting
 * the new object is the whole correction; repainting instead would redraw
 * every mark - a real flash on e-ink - for an edit no pixel of paint cares
 * about. A colour change replaces the paint itself, so it repaints and never
 * needs this.
 *
 * @param {Mark} previous
 * @param {Mark} next
 */
export function adoptPaintedMark(previous, next) {
  for (const entry of painted) {
    if (entry.mark === previous) entry.mark = next;
  }
}

/**
 * One character of a text node as a box - or null when the character has no
 * size to offer, or the offsets do not fit the node. A range held inside a
 * single text node is the one shape every engine measures true; this is the
 * primitive the mark's edges stand on.
 *
 * @param {Node} node
 * @param {number} from
 * @param {number} to
 * @returns {DOMRect | null}
 */
function charBox(node, from, to) {
  const tip = document.createRange();
  try {
    tip.setStart(node, from);
    tip.setEnd(node, to);
  } catch {
    return null;
  }
  const box = tip.getBoundingClientRect();
  return box.width > 0 && box.height > 0 ? box : null;
}

/**
 * The boxes a painted mark visually begins and ends in - what the pins and
 * the note badge stand on. Measured off the range's own endpoints, one
 * character each, NOT off the range's full rect list: Chromium hands that
 * list grouped by node for a range crossing blocks, and Brave's diverges
 * further still - the badge and the end pin stood mid-mark on it while
 * Chrome measured the same build true. The wash painted from this very
 * range proves its endpoints right, so the endpoints are what is measured;
 * `rangeOfMark` anchors both in text nodes with the edge character on the
 * inside, which is what the one-character reach leans on. The geometric
 * pick over the full list stays as the fallback for a tip with no size.
 *
 * @param {Range} range
 * @returns {{ head: import("../lib/reader/marks.js").RectLike | null,
 *   tail: import("../lib/reader/marks.js").RectLike | null }}
 */
export function markEdges(range) {
  const head =
    charBox(range.startContainer, range.startOffset, range.startOffset + 1) ??
    headRect(range.getClientRects());
  const tail =
    charBox(range.endContainer, Math.max(0, range.endOffset - 1), range.endOffset) ??
    tailRect(range.getClientRects());
  return { head, tail };
}

/**
 * One top-level block's prose, for questions the anchors alone cannot
 * answer - today: whether the gap between an active mark's edge and a
 * tapped word holds any word at all (the neighbour test, D107).
 *
 * @param {Element} root
 * @param {number} index
 * @returns {string | null}
 */
export function proseTextOf(root, index) {
  const block = root.children[index];
  return block === undefined ? null : blockProse(block).text;
}
