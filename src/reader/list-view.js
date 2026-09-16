/**
 * What the reading list shows, without the DOM - the same split as
 * `vocab/list-view.js`, for the same reason: a filter, an order and pages are
 * rules, rules can be wrong quietly, and so they live under `node --test`.
 *
 * The order and the segment split are the store's own (`listedRows`); this
 * module adds what a list on screen needs on top of them - which rows match
 * the filter box, and which slice of those is the page in view.
 *
 * Books share the list with articles by wearing the same fields: the entry
 * mappers below are the one place that decides how a book answers the
 * questions the list asks - what is its title, what stands where the site
 * name stands, where does it sort. Everything downstream (segments, filter,
 * pages) then treats the two kinds identically, which is the point.
 */

import { overallPercent } from "../lib/reader/position.js";
import { isSearchableQuery } from "../lib/reader/search.js";
import { Segment, listedRows } from "../lib/store/saved-article.js";
import { matchesFilter } from "../options/models-view.js";

/** @typedef {import("../lib/store/saved-article.js").SavedMeta} SavedMeta */
/** @typedef {import("../lib/store/saved-article.js").SegmentValue} SegmentValue */
/** @typedef {import("../lib/store/book.js").BookMeta} BookMeta */
/** @typedef {import("../lib/reader/position.js").ReadingPosition} ReadingPosition */

/**
 * One row of the list, either kind. `url` is the row's key and the way to
 * open it - a book's id plays the part its address plays for an article.
 * `percentRead` is how much of the whole document has passed before the
 * eyes, 0-100 - or null for a row never opened (or whose position predates
 * the measure). The renderer says it only on unread rows: on a read one the
 * mark has already said more. `lastReadAt` is the position row's clock - when
 * the reader last stood in the document - or null for one never opened; it is
 * half of the order the list stands in (`listedRows`).
 *
 * @typedef {SavedMeta & {
 *   kind: "article" | "book",
 *   progress: { at: number, of: number } | null,
 *   percentRead: number | null,
 *   lastReadAt: number | null,
 * }} LibraryEntry
 */

/**
 * Fifty rows: an article row is a title over a line of detail, about twice a
 * phrase row, so half the vocabulary page's hundred keeps a page of articles
 * at roughly the same scroll.
 */
export const PAGE_SIZE = 50;

/**
 * @param {SavedMeta} meta
 * @param {ReadingPosition | null} position
 * @returns {LibraryEntry}
 */
export function articleEntry(meta, position) {
  return {
    ...meta,
    kind: "article",
    progress: null,
    percentRead: overallPercent(position, 1),
    lastReadAt: lastReadFrom(position),
  };
}

/**
 * When the reader last stood in the document, from its position row. Zero
 * (the mark `asPosition` puts on a row whose clock is torn) reads as never:
 * a time nobody can mean must not pin the row to the bottom of the list
 * below every honest date.
 *
 * @param {ReadingPosition | null} position
 * @returns {number | null}
 */
function lastReadFrom(position) {
  return position !== null && position.updatedAt > 0 ? position.updatedAt : null;
}

/**
 * A book as a row. The author stands where the hostname stands - it is what
 * the filter searches and the detail line opens with. `savedAt` is when the
 * book was added, so the one ordering rule serves both kinds. Progress reads
 * the stored position: a book never opened is honestly at its first part,
 * and a position pointing past the end (which the anchor rules would refuse
 * anyway) shows as the last.
 *
 * @param {BookMeta} book
 * @param {ReadingPosition | null} position
 * @returns {LibraryEntry}
 */
export function bookEntry(book, position) {
  const at = position === null ? 0 : Math.min(position.segmentIndex, book.segmentCount - 1);
  return {
    url: book.id,
    hostname: book.author ?? "",
    title: book.title,
    savedAt: book.addedAt,
    readAt: book.readAt,
    kind: "book",
    progress: { at: at + 1, of: book.segmentCount },
    percentRead: overallPercent(position, book.segmentCount),
    lastReadAt: lastReadFrom(position),
    // The pictures kept with the book (D183), said on its row as on an
    // article's - the one place the space a document costs is said before
    // it is opened.
    ...(book.pictures === undefined ? {} : { pictures: book.pictures }),
  };
}

/**
 * Everything a row can be found by: the title as it is shown, and the site
 * it came from - or, for a book, its author.
 *
 * @param {SavedMeta} meta
 * @returns {string}
 */
export function searchableArticle(meta) {
  return `${meta.title} ${meta.hostname}`.toLowerCase();
}

/**
 * The list as it should be rendered: which rows, which page that turned out
 * to be, out of how many. The page number asked for is clamped rather than
 * trusted, because the list moves under it - a delete takes the last row of
 * the last page, a filter narrows ten pages to one - and a blank page with a
 * pager pointing back at it is a dead end nobody should have to notice.
 *
 * `inSegment` counts the segment before the filter, so the renderer can tell
 * "this segment is empty" from "the filter matched nothing" - two different
 * sentences.
 *
 * `unread` and `read` count the whole of each segment, filter and pages
 * notwithstanding: they feed the tab labels, and a tab says how much it
 * holds, not how much of it happens to be on screen. The two are derived
 * from one `listedRows` call because the segments partition the list -
 * counting the other one twice would be a second copy of the rule.
 *
 * `selectable` is what a "Select all" covers (D152): the segment as the
 * filter left it, every page of it - the filter is how a reader says
 * "these", and a page is only how many fit on a screen. Articles and
 * books alike since D218: the selection's file carries both.
 *
 * @template {SavedMeta & { lastReadAt?: number | null, kind?: "article" | "book" }} T
 * @param {T[]} metas as the stores answer, in any order
 * @param {{ segment: SegmentValue, query: string, page: number }} shown
 * @returns {{
 *   rows: T[],
 *   page: number,
 *   pages: number,
 *   matching: number,
 *   inSegment: number,
 *   unread: number,
 *   read: number,
 *   selectable: string[],
 * }}
 */
export function libraryView(metas, { segment, query, page }) {
  const inSegment = listedRows(metas, segment);
  const matching = inSegment.filter((meta) => matchesFilter(searchableArticle(meta), query));
  const pages = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const current = Math.min(Math.max(1, page), pages);
  const elsewhere = metas.length - inSegment.length;
  return {
    rows: matching.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE),
    page: current,
    pages,
    matching: matching.length,
    inSegment: inSegment.length,
    unread: segment === Segment.UNREAD ? inSegment.length : elsewhere,
    read: segment === Segment.READ ? inSegment.length : elsewhere,
    selectable: matching.map((meta) => meta.url),
  };
}

/**
 * The state the "Select all" box shows over the rows it covers (D152):
 * every one of them picked, some of them, or none - ticked, half-ticked or
 * clear. Over no rows at all (an empty segment, a filter that matched
 * nothing) there is nothing to tick, which reads as none.
 *
 * @param {readonly string[]} selectable the urls a Select all covers
 * @param {ReadonlySet<string>} picked
 * @returns {"all" | "some" | "none"}
 */
export function pickedState(selectable, picked) {
  const count = selectable.filter((url) => picked.has(url)).length;
  if (count === 0) return "none";
  return count === selectable.length ? "all" : "some";
}

/**
 * The selection after a press on "Select all" (D152): ticked, every row it
 * covers joins what was picked; cleared, those rows leave it. Only those
 * rows - a tick made on the other segment, or under another filter, was
 * the reader's own and stays.
 *
 * @param {ReadonlySet<string>} picked
 * @param {readonly string[]} selectable
 * @param {boolean} on
 * @returns {Set<string>}
 */
export function withAllPicked(picked, selectable, on) {
  const next = new Set(picked);
  for (const url of selectable) {
    if (on) next.add(url);
    else next.delete(url);
  }
  return next;
}

/**
 * The selection held to the list as it stands (D152): a document deleted
 * since its tick - from another tab, or by the browser - leaves the
 * selection with it, so the count says what the export will take.
 *
 * @param {ReadonlySet<string>} picked
 * @param {readonly { url: string, kind?: "article" | "book" }[]} entries
 * @returns {Set<string>}
 */
export function keptPicks(picked, entries) {
  const present = new Set(entries.map((entry) => entry.url));
  return new Set([...picked].filter((url) => present.has(url)));
}

/**
 * The Search button's two states beside the field (D173): whether a press
 * would do anything, and whether the list on screen stands behind what the
 * field says. Nothing narrows the list until the button is pressed - the
 * field asks, the press answers - so "stale" is the button's cue to be
 * pressed: lit while the words in the field are not the words the list was
 * narrowed by. A press over the texts wants a phrase worth scanning for (the
 * document dialog's two-character rule); a press over titles takes any word.
 * Trailing air is not a new question.
 *
 * @param {{ query: string, applied: string, texts: boolean }} state `query`
 *   as typed, `applied` the words the list stands narrowed by, `texts`
 *   whether the box asks for the saved texts too
 * @returns {{ enabled: boolean, stale: boolean }}
 */
export function searchButtonState({ query, applied, texts }) {
  const typed = query.trim();
  const enabled = texts ? isSearchableQuery(typed) : typed.length > 0;
  return { enabled, stale: enabled && typed !== applied.trim() };
}
