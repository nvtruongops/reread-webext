/**
 * The rules of a highlighter mark, with no DOM and no database in sight - the
 * same split as `position.js`, so that every decision here runs under
 * `node --test`.
 *
 * A mark is a structural anchor with a quote riding along. The anchor is a
 * pair of points, `{block, offset}` each: which top-level block of the rebuilt
 * article, and where in that block's joined prose text (`prosePieces`, the
 * read-aloud walk) the mark begins and ends. Structural for the reason the
 * reading position is: the same stored markup rebuilds into the same blocks
 * and the same prose every time, while anything measured in pixels breaks at
 * the first change of font or measure. Unlike the position, a mark cannot
 * afford to be *approximately* right - a wash over the wrong words is worse
 * than no wash - so the quote is the guard: at paint time the text under the
 * anchor has to read back exactly as it was written down, or the mark stays
 * unpainted (and untouched in the database, where an export can still carry
 * it). Losing paint costs highlighting again; painting the wrong words would
 * cost trust.
 *
 * Word alignment is deliberately not a rule here. The gesture that creates a
 * mark snaps to the matcher's tokens, so every mark is born on word edges -
 * but what is stored are plain character offsets, and painting one back needs
 * no tokenizer at all.
 */

/**
 * The colours a mark may wear, and the one it wears by default. Names rather
 * than values, because a colour has to answer differently per theme - the
 * stylesheet holds a wash for each name in each theme - and because a name is
 * what can be checked at the door: a stored colour is a registry name in the
 * making, never a string that reaches CSS.
 *
 * @typedef {"yellow" | "green" | "blue" | "pink"} MarkColor
 */

/** @type {readonly MarkColor[]} */
export const MARK_COLORS = Object.freeze(["yellow", "green", "blue", "pink"]);

/** @type {MarkColor} */
export const DEFAULT_MARK_COLOR = "yellow";

/**
 * The most a note may hold, in characters. Far above what a margin comment
 * honestly runs to - the cap exists for the same reason the article file caps
 * its marks: a hand-made backup must not plant megabytes into a field every
 * render reads. The editor wears the same number as its `maxlength`, so the
 * two doors agree.
 */
export const MAX_NOTE_LENGTH = 2000;

/**
 * The most a mark's quote may hold when it arrives from a file or the
 * database, in characters (D171). A mark is a quote, and the longest honest
 * one - a stretch of pages dragged over in one gesture - stays far under
 * this; what the cap keeps out is a hand-made backup planting a document
 * behind one row. A quote is never cut, because a cut quote would anchor
 * nowhere (D169 finds a mark by its quote): a mark past the cap is refused
 * whole. The gesture's own records never meet it - they come from the text
 * on screen.
 */
export const MAX_MARK_TEXT_LENGTH = 100_000;

/**
 * A note as a mark keeps it, or nothing: trimmed, cut to the cap, and absent
 * rather than empty - a mark without a note has no field, so "no note" is one
 * shape everywhere. One narrowing for the record builder and the healer both,
 * so a note entered by editor and one entered by file read by the same rule.
 *
 * @param {unknown} value
 * @returns {string | undefined}
 */
function asNote(value) {
  if (typeof value !== "string") return undefined;
  // The trim after the cut keeps the healing idempotent: a cut that lands on
  // a space must read the same on every later pass through this door.
  const kept = value.trim().slice(0, MAX_NOTE_LENGTH).trim();
  return kept.length === 0 ? undefined : kept;
}

/**
 * @param {unknown} value
 * @returns {value is MarkColor}
 */
export function isMarkColor(value) {
  return typeof value === "string" && MARK_COLORS.includes(/** @type {MarkColor} */ (value));
}

/**
 * One end of a mark: a top-level block of the rebuilt article, and a
 * character offset into that block's joined prose text. The end point's
 * offset is exclusive, the usual half-open reading.
 *
 * @typedef {{ block: number, offset: number }} MarkPoint
 */

/**
 * The optional `note` is the reader's own words about the quote (D118):
 * absent on a mark nobody annotated - old rows never carried the field, and
 * absence and emptiness must read the same - and plain text when present,
 * newlines and all.
 *
 * @typedef {{
 *   segmentIndex: number,
 *   start: MarkPoint,
 *   end: MarkPoint,
 *   color: string,
 *   createdAt: number,
 *   text: string,
 *   note?: string,
 * }} Mark
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
 * @returns {MarkPoint | null}
 */
function asPoint(value) {
  if (typeof value !== "object" || value === null) return null;
  const { block, offset } = /** @type {Record<string, unknown>} */ (value);
  if (!isIndex(block) || !isIndex(offset)) return null;
  return { block, offset };
}

/**
 * Which of two points comes first in the article: blocks in document order,
 * offsets within a block. Both ends of every comparison this module makes.
 *
 * @param {MarkPoint} a
 * @param {MarkPoint} b
 * @returns {number}
 */
export function comparePoints(a, b) {
  return a.block - b.block || a.offset - b.offset;
}

/**
 * The reading order of marks: segment by segment, then by where each begins.
 * The end breaks ties only so that sorting is total - two marks sharing a
 * start cannot survive `placeMark` anyway.
 *
 * @param {Mark} a
 * @param {Mark} b
 * @returns {number}
 */
export function compareMarks(a, b) {
  return (
    a.segmentIndex - b.segmentIndex ||
    comparePoints(a.start, b.start) ||
    comparePoints(a.end, b.end)
  );
}

/**
 * Builds the record a finished gesture writes, or nothing when the pieces do
 * not make a mark: a span that does not run forward, an unknown colour, a
 * quote that is not there to guard with. An end offset of zero is refused
 * with the rest - a mark "ending" at the very start of a block really ends in
 * the block before, and the gesture never produces one. The note alone
 * cannot refuse a record: whatever it holds narrows through `asNote`, and a
 * mark is a mark with or without one.
 *
 * @param {{
 *   segmentIndex: number,
 *   start: MarkPoint,
 *   end: MarkPoint,
 *   color: string,
 *   createdAt: number,
 *   text: string,
 *   note?: string,
 * }} input
 * @returns {Mark | null}
 */
export function markRecord({ segmentIndex, start, end, color, createdAt, text, note }) {
  if (!isIndex(segmentIndex)) return null;
  const from = asPoint(start);
  const to = asPoint(end);
  if (from === null || to === null) return null;
  if (comparePoints(from, to) >= 0 || to.offset === 0) return null;
  if (!isMarkColor(color)) return null;
  if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) return null;
  if (typeof text !== "string" || text.length === 0) return null;
  const kept = asNote(note);
  return {
    segmentIndex,
    start: from,
    end: to,
    color,
    createdAt,
    text,
    ...(kept === undefined ? {} : { note: kept }),
  };
}

/**
 * A mark as it came back from the database or a file, narrowed field by
 * field. The lean is the vocabulary's: these are somebody's marks in their
 * own reading, so a wound that can heal, heals - an unknown colour becomes
 * the default, a broken clock reads as zero - and only a mark without a
 * whole anchor or without its quote is dropped, because those two are what
 * painting it stands on.
 *
 * @param {unknown} value
 * @returns {Mark | null}
 */
export function asMark(value) {
  if (typeof value !== "object" || value === null) return null;
  const { segmentIndex, start, end, color, createdAt, text, note } =
    /** @type {Record<string, unknown>} */ (value);
  if (typeof text === "string" && text.length > MAX_MARK_TEXT_LENGTH) return null;
  return markRecord({
    segmentIndex: /** @type {number} */ (segmentIndex),
    start: /** @type {MarkPoint} */ (start),
    end: /** @type {MarkPoint} */ (end),
    color: isMarkColor(color) ? color : DEFAULT_MARK_COLOR,
    createdAt: typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : 0,
    text: /** @type {string} */ (text),
    note: typeof note === "string" ? note : undefined,
  });
}

/**
 * A bare span - what a gesture knows before it is a mark, and what merging
 * reasons about.
 *
 * @typedef {{ segmentIndex: number, start: MarkPoint, end: MarkPoint }} MarkSpan
 */

/**
 * Whether two spans of the same segment share ground or stand back to back.
 * Touching counts: two washes meeting end to start read as one to the eye,
 * and keeping them as two would be a seam nobody drew on purpose.
 *
 * @param {MarkSpan} a
 * @param {MarkSpan} b
 * @returns {boolean}
 */
function joined(a, b) {
  if (a.segmentIndex !== b.segmentIndex) return false;
  return comparePoints(a.start, b.end) <= 0 && comparePoints(b.start, a.end) <= 0;
}

/**
 * What painting a new span over the standing marks means: which marks it
 * absorbs, and the one span covering them all. Drawing over a mark is how a
 * mark grows - there are no handles to drag - so overlap is never two marks
 * stacked, always one mark that got bigger. The quote of the union is the
 * document's to give, not this module's: the caller reads it off the blocks
 * and finishes the record.
 *
 * @param {Mark[]} marks
 * @param {MarkSpan} span
 * @returns {{ absorbed: Mark[], span: MarkSpan }}
 */
export function mergePlan(marks, span) {
  const absorbed = marks.filter((mark) => joined(mark, span));
  let { start, end } = span;
  for (const mark of absorbed) {
    if (comparePoints(mark.start, start) < 0) start = mark.start;
    if (comparePoints(mark.end, end) > 0) end = mark.end;
  }
  return { absorbed, span: { segmentIndex: span.segmentIndex, start, end } };
}

/**
 * What reshaping one standing mark to a new span means - a handle dragged
 * (D181). The mark itself is replaced whatever the span covers, so it is
 * absorbed by construction and never unioned back in: a trim must not grow
 * to its old outline, which is exactly what `mergePlan` would make of it.
 * Every OTHER mark the span reaches is absorbed the way a stroke absorbs
 * it - the end dragged over a neighbour leaves one mark, as drawing over
 * it would.
 *
 * @param {Mark[]} marks
 * @param {Mark} mark the one being reshaped - an element of `marks`
 * @param {MarkSpan} span
 * @returns {{ absorbed: Mark[], span: MarkSpan }}
 */
export function reshapePlan(marks, mark, span) {
  const plan = mergePlan(withoutMark(marks, mark), span);
  return { absorbed: [mark, ...plan.absorbed], span: plan.span };
}

/**
 * The note the merged mark inherits: every absorbed note, in reading order,
 * a blank line between two - because absorbing a mark absorbs somebody's own
 * words, and a growth gesture silently eating a note would be the one loss
 * this feature cannot afford. Exact twins collapse to one: the same sentence
 * twice says nothing the once does not. Undefined when no absorbed mark had
 * a word to pass on, so the fresh record simply has no field.
 *
 * @param {Mark[]} absorbed
 * @returns {string | undefined}
 */
export function mergedNote(absorbed) {
  /** @type {string[]} */
  const notes = [];
  for (const mark of [...absorbed].sort(compareMarks)) {
    if (mark.note !== undefined && !notes.includes(mark.note)) notes.push(mark.note);
  }
  return notes.length === 0 ? undefined : notes.join("\n\n");
}

/**
 * The list as it stands once a merged mark lands: the absorbed rows out, the
 * new one in, reading order kept. Absorption is by identity - the absorbed
 * marks are elements of the very list being replaced.
 *
 * @param {Mark[]} marks
 * @param {Mark[]} absorbed
 * @param {Mark} mark
 * @returns {Mark[]}
 */
export function placeMark(marks, absorbed, mark) {
  const kept = marks.filter((one) => !absorbed.includes(one));
  return [...kept, mark].sort(compareMarks);
}

/**
 * The list without one mark - the delete button's whole arithmetic.
 *
 * @param {Mark[]} marks
 * @param {Mark} mark
 * @returns {Mark[]}
 */
export function withoutMark(marks, mark) {
  return marks.filter((one) => one !== mark);
}

/**
 * The marks of one segment, for painting: an article is all of segment zero,
 * a book paints one part at a time.
 *
 * @param {Mark[]} marks
 * @param {number} segmentIndex
 * @returns {Mark[]}
 */
export function marksInSegment(marks, segmentIndex) {
  return marks.filter((mark) => mark.segmentIndex === segmentIndex);
}

/**
 * The shape of a box as the pickers below need it - what a DOMRect already
 * is, said structurally so the rule can run under `node --test`.
 *
 * @typedef {{ top: number, bottom: number, left: number, right: number,
 *   width: number, height: number }} RectLike
 */

/**
 * Which of a painted range's boxes a mark visually begins in, and which it
 * ends in. Blink does not hand a range's client rects in document order -
 * boxes arrive grouped by node when the range crosses inline elements, with
 * zero-size boxes riding along for collapsed whitespace - so "the first
 * rect" and "the last rect" are not "the first line" and "the last line"
 * (the note badge stood mid-mark on exactly that; Michał's report from
 * Brave). Geometry decides instead: the head is the topmost box and the
 * tail the bottommost, ties broken toward the reading edge, and an empty
 * box is nobody's line. Null only when nothing has size.
 *
 * @param {Iterable<RectLike>} rects
 * @returns {RectLike | null}
 */
export function headRect(rects) {
  /** @type {RectLike | null} */
  let best = null;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (best === null || rect.top < best.top || (rect.top === best.top && rect.left < best.left)) {
      best = rect;
    }
  }
  return best;
}

/**
 * @param {Iterable<RectLike>} rects
 * @returns {RectLike | null}
 */
export function tailRect(rects) {
  /** @type {RectLike | null} */
  let best = null;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (
      best === null ||
      rect.bottom > best.bottom ||
      (rect.bottom === best.bottom && rect.right > best.right)
    ) {
      best = rect;
    }
  }
  return best;
}

/**
 * Which of an active mark's two pins a press lands on, if either (D181):
 * each pin takes the press from `reach` around its stem - a thumb's margin,
 * the note badge's own - which also covers the dot drawn beyond one end of
 * the stem. A mark of one word stands its pins a few pixels apart and a
 * press can land on both; the dots tell them apart - the start's above the
 * line, the end's below it - so the nearer dot answers.
 *
 * @param {number} x
 * @param {number} y
 * @param {RectLike} start the start pin's stem
 * @param {RectLike} end the end pin's stem
 * @param {number} reach
 * @returns {"start" | "end" | null}
 */
export function handleAt(x, y, start, end, reach) {
  const onStart = withinReach(start, x, y, reach);
  const onEnd = withinReach(end, x, y, reach);
  if (onStart && onEnd) {
    const toStart = Math.hypot(x - (start.left + start.right) / 2, y - start.top);
    const toEnd = Math.hypot(x - (end.left + end.right) / 2, y - end.bottom);
    return toStart <= toEnd ? "start" : "end";
  }
  if (onStart) return "start";
  return onEnd ? "end" : null;
}

/**
 * @param {RectLike} box
 * @param {number} x
 * @param {number} y
 * @param {number} reach
 * @returns {boolean}
 */
function withinReach(box, x, y, reach) {
  return x >= box.left - reach && x <= box.right + reach && y >= box.top - reach && y <= box.bottom + reach;
}

/**
 * The text a span covers, read off the blocks' prose - or null when the
 * offsets do not fit the prose they claim to measure, which is the quote
 * guard refusing. `prose` holds the joined text of every block the span
 * touches, first to last; a line break stands between blocks, the same one
 * `prosePieces` puts inside them, so a quote reads like the text it quotes.
 *
 * Used in both directions on purpose: writing a mark builds its quote here,
 * and painting one rebuilds the quote the same way and compares. One
 * function, so the two can never disagree about what a span says.
 *
 * @param {string[]} prose
 * @param {MarkPoint} start offset into `prose[0]`
 * @param {MarkPoint} end offset into `prose[prose.length - 1]`, exclusive
 * @returns {string | null}
 */
export function quoteOf(prose, start, end) {
  const first = prose[0];
  const last = prose[prose.length - 1];
  if (first === undefined || last === undefined) return null;
  if (prose.length !== end.block - start.block + 1) return null;
  if (start.offset >= first.length) return null;
  if (end.offset < 1 || end.offset > last.length) return null;

  if (prose.length === 1) return first.slice(start.offset, end.offset);
  return [first.slice(start.offset), ...prose.slice(1, -1), last.slice(0, end.offset)].join("\n");
}

/**
 * Where a quote stands in a segment's prose when it stands in exactly one
 * place - the healed anchor of a mark the guard refused (D169: a paragraph
 * added above, a sanitizer that tightened, a book cut again from its own
 * file). The prose is the blocks' texts as `quoteOf` joins them - a line
 * break at every boundary - so a quote written by `quoteOf` is looked for in
 * the very text it was read from, and read back through `quoteOf` before it
 * is believed. One hit and no other: a quote standing twice is nobody's to
 * choose between, and painting the wrong one would cost what the guard
 * protects. Null for none, for two or more, and for a quote whose ends fall
 * on a boundary no record can name.
 *
 * @param {string[]} prose every block of the segment, in order
 * @param {string} quote
 * @returns {{ start: MarkPoint, end: MarkPoint } | null}
 */
export function findQuote(prose, quote) {
  if (quote.length === 0 || prose.length === 0) return null;
  const joined = prose.join("\n");
  const at = joined.indexOf(quote);
  if (at === -1 || joined.indexOf(quote, at + 1) !== -1) return null;

  const start = pointAt(prose, at);
  const last = pointAt(prose, at + quote.length - 1);
  if (start === null || last === null) return null;
  const end = { block: last.block, offset: last.offset + 1 };
  const read = quoteOf(prose.slice(start.block, end.block + 1), start, end);
  return read === quote ? { start, end } : null;
}

/**
 * The block and offset a position in the joined prose falls in - or null on
 * a line break between blocks, a place no character of any block owns, and
 * past the end.
 *
 * @param {string[]} prose
 * @param {number} index into `prose.join("\n")`
 * @returns {MarkPoint | null}
 */
function pointAt(prose, index) {
  let from = 0;
  for (const [block, text] of prose.entries()) {
    if (index < from + text.length) return { block, offset: index - from };
    if (index === from + text.length) return null;
    from += text.length + 1;
  }
  return null;
}

/**
 * Whether a mark's anchor still reads its own quote off its segment's
 * prose - the quote guard as a value: the check `rangeOfMark` makes on the
 * document (`quoteOfSpan`), made on the prose alone. The blocks the span
 * covers, joined as `quoteOf` joins them, have to read back exactly what
 * the mark wrote down. False for an anchor past the prose.
 *
 * @param {string[]} prose every block of the mark's segment, in order
 * @param {Mark} mark
 * @returns {boolean}
 */
export function fitsProse(prose, mark) {
  if (mark.end.block >= prose.length) return false;
  return quoteOf(prose.slice(mark.start.block, mark.end.block + 1), mark.start, mark.end) === mark.text;
}

/**
 * The one segment a quote stands in when it stands in exactly one place in
 * the whole book, or -1: a second hit anywhere - in the same part or in
 * another - is the end of it. Over the parts' prose joined once, so a book
 * of fifty parts costs one search per part and no joining per mark.
 *
 * @param {string[]} joined every segment's prose as `findQuote` joins it
 * @param {string} quote
 * @returns {number}
 */
function segmentOfQuote(joined, quote) {
  let found = -1;
  for (const [segmentIndex, text] of joined.entries()) {
    const at = text.indexOf(quote);
    if (at === -1) continue;
    if (found !== -1 || text.indexOf(quote, at + 1) !== -1) return -1;
    found = segmentIndex;
  }
  return found;
}

/**
 * @param {string[][]} book every segment's prose, by segment index
 * @param {string[]} joined the same, each segment joined once
 * @param {string} quote
 * @returns {{ segmentIndex: number, start: MarkPoint, end: MarkPoint } | null}
 */
function locateIn(book, joined, quote) {
  const segmentIndex = segmentOfQuote(joined, quote);
  const span = segmentIndex === -1 ? null : findQuote(book[segmentIndex] ?? [], quote);
  return span === null ? null : { segmentIndex, ...span };
}

/**
 * Where a quote stands in a whole book when it stands in exactly one place
 * in all of it (D223): `findQuote` widened from one segment to every
 * segment, for a mark whose quote moved to another part. A book cut again
 * from its own file after the cut changed - a picture's weight (D183), the
 * budget (O21) - puts a quote one or several parts past where its anchor
 * says, and the shift grows with every picture before it, so the part next
 * door is not far enough to look. One hit in the whole book and no other: a
 * quote standing in two parts is nobody's to choose between. Null for none,
 * for more, and for a quote whose ends fall on a boundary.
 *
 * @param {string[][]} book every segment's prose, by segment index
 * @param {string} quote
 * @returns {{ segmentIndex: number, start: MarkPoint, end: MarkPoint } | null}
 */
export function locateQuote(book, quote) {
  if (quote.length === 0) return null;
  return locateIn(book, book.map((prose) => prose.join("\n")), quote);
}

/**
 * A document's marks laid against its book as the book stands now (D223):
 * a mark whose anchor still reads its quote is kept as it is; one whose
 * anchor does not is looked for by its quote in the whole book and, found
 * once, rewritten to stand there - colour, note and clock as they were;
 * one found nowhere, or twice, is kept as it was - in the list and in the
 * database, unpainted, the guard's bargain (D169) - and counted. The
 * import's road: a file's marks were written against another cut of the
 * same book, and the reader who imported the book again should find every
 * highlight where its words are, not where its numbers were.
 *
 * @param {string[][]} book every segment's prose, by segment index
 * @param {Mark[]} marks
 * @returns {{ marks: Mark[], healed: number, lost: number }} the marks in
 *   the same order, each as it was or as it stands now
 */
export function reanchorMarks(book, marks) {
  const joined = book.map((prose) => prose.join("\n"));
  let healed = 0;
  let lost = 0;
  const placed = marks.map((mark) => {
    const prose = book[mark.segmentIndex];
    if (prose !== undefined && fitsProse(prose, mark)) return mark;
    const found = locateIn(book, joined, mark.text);
    const record = found === null ? null : markRecord({ ...mark, ...found });
    if (record === null) {
      lost += 1;
      return mark;
    }
    healed += 1;
    return record;
  });
  return { marks: placed, healed, lost };
}
