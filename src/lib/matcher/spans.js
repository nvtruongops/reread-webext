/**
 * Reading a run of text that is stored in pieces.
 *
 * A phrase on a page is regularly cut in half by markup - `<em>hottest</em>
 * ever`, a link in the middle of a sentence, a `<b>` around one word. The
 * reader sees one sentence, the DOM has three text nodes, and matching each
 * node on its own would find nothing at all.
 *
 * So the pieces of one block are joined and matched as one string, and this
 * module is the arithmetic that gets back out of it: which piece a given
 * character came from, and how far into that piece it is. Kept apart from the
 * DOM so it can be tested without one - the pieces here are strings, and it is
 * the caller's business that they happen to be text nodes.
 */

/**
 * @typedef {{ start: number, end: number }} Span where a piece sits in the joined text
 * @typedef {{ piece: number, offset: number }} Place
 */

/**
 * A text node's data with the line breaks its file was wrapped with read as
 * the spaces the reader sees.
 *
 * A file wrapped at seventy columns - every Project Gutenberg book, most
 * pretty-printed HTML - has a line break in the middle of every other
 * sentence, and under `white-space: normal` the browser paints each of them
 * as a space. Text read out of such a node has to say the same, or a break
 * nobody can see ends a sentence for `sentenceAround` and stops the reading
 * voice for breath: the only breaks that mean one are the ones the scanner
 * puts in itself, for a `<br>` or a block boundary.
 *
 * One character for one, never collapsing: every index into the result is
 * still an index into the node the data came from, which is what `locate`
 * relies on to get a match back onto the page.
 *
 * @param {string} data of one text node
 * @returns {string}
 */
export function unwrapLines(data) {
  return data.replace(/\n/gu, " ");
}

/**
 * Joined without a separator: the pieces of a block are what the browser paints
 * next to each other, so `<b>hot</b>test` really is the word `hottest` on the
 * screen, and pretending otherwise would be inventing a gap the reader cannot
 * see.
 *
 * @param {string[]} pieces
 * @returns {{ text: string, spans: Span[] }}
 */
export function joinPieces(pieces) {
  /** @type {Span[]} */
  const spans = [];
  let at = 0;
  for (const piece of pieces) {
    spans.push({ start: at, end: at + piece.length });
    at += piece.length;
  }
  return { text: pieces.join(""), spans };
}

/**
 * Which piece a character of the joined text belongs to.
 *
 * Binary search rather than a scan: a paragraph of heavily marked-up text can
 * be a hundred pieces, and this runs once per character position of every
 * match on the page.
 *
 * @param {Span[]} spans
 * @param {number} index into the joined text
 * @returns {Place | null} null when the index is outside the text, or lands in nothing
 */
export function locate(spans, index) {
  let low = 0;
  let high = spans.length - 1;

  while (low <= high) {
    const middle = (low + high) >> 1;
    const span = spans[middle];
    if (span === undefined) return null;

    if (index < span.start) high = middle - 1;
    else if (index >= span.end) low = middle + 1;
    // An empty piece has start === end and can never contain anything, so the
    // comparisons above walk past it on their own.
    else return { piece: middle, offset: index - span.start };
  }

  return null;
}
