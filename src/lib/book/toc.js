/**
 * The table of contents of a document (D116), read off its blocks: the
 * h1-h3 blocks that `segment.js` already treats as chapter breaks are the
 * chapters. Two readers of the same rule, because the blocks come in two
 * shapes: `headingEntries` walks a book segment's *stored* strings (the
 * import pipeline and the backfill of books from before the TOC existed),
 * `renderedEntries` walks what a caller read off *rendered* blocks - an
 * article's map, built fresh from the screen with nothing stored (D117).
 * Pure either way, so the whole of it runs under `node --test`.
 *
 * The string reader's input is exclusively this extension's own rebuilt
 * markup: block strings written by `import-book.js`, each the `outerHTML`
 * of one allowed-list element. That closed format is what licenses parsing
 * by regular expression here. The serializer entity-escapes text (`&` `<`
 * `>` and U+00A0), so raw `<` only ever opens a real tag; the one `>` that
 * can stand anywhere but a tag's edge is inside a quoted attribute value,
 * which the strip pattern reads quotes to step over.
 */

import { isHeadingTag } from "./segment.js";

/**
 * One chapter row: the words to show, how deep the heading sits, and the
 * place to land - the same `(segment, block)` anchor reading positions and
 * highlighter marks stand on, stable because a book is segmented once and
 * never re-cut.
 *
 * @typedef {{
 *   title: string,
 *   level: 1 | 2 | 3,
 *   segmentIndex: number,
 *   blockIndex: number,
 * }} TocEntry
 */

/**
 * Entries a book may carry. The list rides the book's metadata row, which
 * the reading list loads without touching a single segment - a pathological
 * file of ten thousand headings must not turn that row into a payload. Five
 * hundred chapters are a table of contents; whatever stands past them is
 * not.
 */
export const TOC_ENTRY_CAP = 500;

/** Characters a title may keep - an abused heading is cut, never refused. */
export const TOC_TITLE_CAP = 120;

/** A block that opens a chapter: the tags the segmenter prefers to cut before. */
const HEADING_BLOCK = /^<h([123])[\s>]/;

/**
 * A whole tag, quotes and all: the plain run stops at any quote, and each
 * quoted attribute value is stepped over in one piece - so a `>` inside
 * `dir="a>b"` does not end the match early.
 */
const TAGS = /<[^>"']*(?:"[^"]*"[^>"']*|'[^']*'[^>"']*)*>/g;

/**
 * A heading's text made into a row's title, or nothing when there is none
 * to show: whitespace collapsed, the cap applied - an abused heading is
 * cut, never refused. The one rule both readers share.
 *
 * @param {string} text
 * @returns {string | null}
 */
export function tocTitle(text) {
  const shown = text.replace(/\s+/g, " ").trim();
  if (shown.length === 0) return null;
  if (shown.length <= TOC_TITLE_CAP) return shown;
  return `${shown.slice(0, TOC_TITLE_CAP - 1).trimEnd()}…`;
}

/**
 * The words of a stored heading block. Inline markup goes the way of the
 * outer tag; the four entities are the only ones the serializer ever writes
 * into text, and `&amp;` is decoded last so an author's literal "&lt;"
 * survives as itself.
 *
 * @param {string} block
 * @returns {string | null}
 */
function titleOf(block) {
  const text = block
    .replace(TAGS, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
  return tocTitle(text);
}

/**
 * The chapter rows one segment contributes, in reading order. Only the
 * segment's own top-level blocks are read - a heading buried inside some
 * wrapper the import kept whole is invisible here, exactly as it was to the
 * segmenter's cut.
 *
 * @param {string[]} blocks the segment's stored blocks
 * @param {number} segmentIndex the segment they belong to
 * @returns {TocEntry[]}
 */
export function headingEntries(blocks, segmentIndex) {
  /** @type {TocEntry[]} */
  const entries = [];
  for (const [blockIndex, block] of blocks.entries()) {
    const heading = HEADING_BLOCK.exec(block);
    if (heading === null) continue;
    const title = titleOf(block);
    if (title === null) continue;
    entries.push({
      title,
      level: /** @type {1 | 2 | 3} */ (Number(heading[1])),
      segmentIndex,
      blockIndex,
    });
  }
  return entries;
}

/**
 * The chapter rows of a rendered document (D117) - `headingEntries`' twin
 * for blocks already standing in a DOM, handed over as the two properties
 * the rule reads (so this stays testable without one). The caller walks the
 * rendered top-level blocks; the anchors are their indexes, the same ground
 * the stored reader names.
 *
 * @param {Array<{ localName: string, text: string }>} blocks
 * @param {number} segmentIndex the part they render - an article's zero
 * @returns {TocEntry[]}
 */
export function renderedEntries(blocks, segmentIndex) {
  /** @type {TocEntry[]} */
  const entries = [];
  for (const [blockIndex, block] of blocks.entries()) {
    if (!isHeadingTag(block.localName)) continue;
    const title = tocTitle(block.text);
    if (title === null) continue;
    entries.push({
      title,
      level: /** @type {1 | 2 | 3} */ (Number(block.localName.slice(1))),
      segmentIndex,
      blockIndex,
    });
  }
  return entries;
}

/**
 * A whole book's list, held to the cap. The first chapters stay - a reader
 * lost past the five hundredth heading is not lost for lack of a row here.
 *
 * @param {TocEntry[]} entries
 * @returns {TocEntry[]}
 */
export function cappedToc(entries) {
  return entries.length <= TOC_ENTRY_CAP ? entries : entries.slice(0, TOC_ENTRY_CAP);
}
