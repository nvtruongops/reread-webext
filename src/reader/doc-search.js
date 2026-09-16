/**
 * Search inside the open document (D119): the dialog, the scan, the rows.
 *
 * This is the DOM half of `lib/reader/search.js`, the split every reader
 * module makes: the fold, the matching and the snippets run under
 * `node --test`, and what is left here is the part that has to ask the
 * document and the database - what a block's prose reads, what a stored
 * segment holds.
 *
 * The scan never touches the page's own render until the jump: an article
 * is read off its rendered blocks (the same `prosePieces` walk the marks
 * anchor into), a book segment by segment from the database - the part on
 * screen included, one uniform loop instead of two code paths. Between
 * segments the loop yields (the fetch is an await), so a long book scans
 * with the page still breathing, and a scan whose dialog closed or whose
 * query was retyped stops at the next check rather than reporting into a
 * view that moved on.
 *
 * Results land in one `replaceChildren` per scan - one repaint per press,
 * which is the difference between a list and a flipbook on an e-ink panel.
 * Snippets enter as `textContent` only: the text is somebody's book.
 */

import { prosePieces } from "../content/scan.js";
import { plural, t } from "../lib/i18n.js";
import {
  DOC_HIT_CAP,
  chapterOf,
  foldQuery,
  hitsInText,
  isSearchableQuery,
  snippetAround,
} from "../lib/reader/search.js";
import { getBookSegment } from "../lib/store/books.js";
import { proseTextOf } from "./marks-view.js";

/** @typedef {import("../lib/book/toc.js").TocEntry} TocEntry */

/**
 * One hit as the dialog holds it: the anchor the jump needs - the block in
 * the reading position's numbering, the span in its prose - and the snippet
 * the row shows. Offsets measured here are re-proven at the landing
 * (`scrollToSearchHit`), so a hit is a claim, never a promise.
 *
 * @typedef {{
 *   segmentIndex: number,
 *   block: number,
 *   from: number,
 *   to: number,
 *   before: string,
 *   match: string,
 *   after: string,
 * }} DocHit
 */

/**
 * What the reader page wires in: which document stands on screen, its
 * rendered root and table of contents, and what a pressed row does. Held as
 * callbacks because every one of them changes under this module's feet.
 *
 * @typedef {{
 *   doc: () => ({ origin: "live" | "saved", url: string }
 *     | { origin: "book", url: string, segmentIndex: number, segmentCount: number }
 *     | null),
 *   root: () => Element | null,
 *   toc: () => TocEntry[],
 *   onJump: (hit: DocHit, folded: string) => void,
 * }} DocSearchContext
 */

const dialog = /** @type {HTMLDialogElement | null} */ (
  document.getElementById("search-dialog")
);
const form = document.getElementById("search-form");
const input = /** @type {HTMLInputElement | null} */ (document.getElementById("search-input"));
const statusLine = document.getElementById("search-status");
const rows = document.getElementById("search-rows");
const closeButton = document.getElementById("search-close");

/** @type {DocSearchContext | null} */
let context = null;

/**
 * The search the document on screen last ran, results and all - what a
 * reopened dialog shows without scanning again. Keyed by the document's
 * url; a different document's search means nothing here and is dropped by
 * `resetDocSearch` before it could be shown.
 *
 * @type {{ url: string, query: string, folded: string, hits: DocHit[], capped: boolean } | null}
 */
let held = null;

/**
 * Counts the scans. An await inside one takes the current count and stops
 * itself when the count has moved on - a closed dialog or a retyped query
 * must not keep a book's segments coming.
 */
let scanEpoch = 0;

/**
 * @param {DocSearchContext} wiring
 */
export function configureDocSearch(wiring) {
  context = wiring;
}

/**
 * Opens the dialog over the current document, with the last search of this
 * very document still standing in it - stepping out to check a hit and
 * coming back must not cost the scan again. A prefilled phrase (the list's
 * "and m more" press, D119) starts its scan at once - unless it is the very
 * search already held, which is simply shown.
 *
 * @param {string} [prefill] a phrase to search for on opening
 */
export function openDocSearch(prefill) {
  const doc = context?.doc() ?? null;
  if (dialog === null || input === null || doc === null) return;
  const remembered = held !== null && held.url === doc.url ? held : null;
  const rerun = prefill !== undefined && (remembered === null || remembered.query !== prefill);
  if (remembered !== null && !rerun) {
    input.value = remembered.query;
    renderResults();
  } else {
    held = null;
    input.value = prefill ?? "";
    clearResults();
  }
  dialog.showModal();
  input.focus();
  input.select();
  if (rerun && prefill !== undefined) void runSearch(prefill);
}

/** Puts the dialog away, wherever the closing came from. The close event
 *  below is what stops a running scan - Esc and the engine's own ways out
 *  arrive there too, and one door is one rule. */
export function closeDocSearch() {
  if (dialog !== null && dialog.open) dialog.close();
}

/**
 * Forgets the held search - the document it was about has left the screen.
 * A book turning its own parts keeps it: the hits are the whole book's.
 */
export function resetDocSearch() {
  scanEpoch += 1;
  held = null;
  if (input !== null) input.value = "";
  clearResults();
}

function clearResults() {
  rows?.replaceChildren();
  if (statusLine !== null) {
    statusLine.hidden = true;
    statusLine.textContent = "";
  }
}

/**
 * @param {string} text
 */
function sayStatus(text) {
  if (statusLine === null) return;
  statusLine.hidden = false;
  statusLine.textContent = text;
}

/**
 * One stored block's prose, read the way the rendered block would read it:
 * the markup parsed inert (a stored block is our own rebuilt markup, and
 * still not trusted back) and walked by the same `prosePieces` the marks
 * and the scan of a rendered article use - one arithmetic, so an offset
 * measured here lands on the letters the render will show. The list's scan
 * (`library-search.js`) reads book segments through this too.
 *
 * @param {string} html
 * @returns {string}
 */
export function storedBlockText(html) {
  const block = new DOMParser().parseFromString(html, "text/html").body.firstElementChild;
  if (block === null) return "";
  return prosePieces(block)
    .map((part) => part.text)
    .join("");
}

/**
 * Every hit of one block's prose, appended until the cap - false when the
 * cap cut the collecting short, which is the scan's cue to stop whole.
 * Shared with the list's scan, which brings its own, tighter cap.
 *
 * @param {string} text
 * @param {number} segmentIndex
 * @param {number} block
 * @param {string} folded
 * @param {DocHit[]} into
 * @param {number} cap
 * @returns {boolean} whether there is room to keep collecting
 */
export function collectHits(text, segmentIndex, block, folded, into, cap) {
  for (const span of hitsInText(text, folded)) {
    if (into.length >= cap) return false;
    into.push({
      segmentIndex,
      block,
      from: span.start,
      to: span.end,
      ...snippetAround(text, span),
    });
  }
  return into.length < cap;
}

/**
 * Runs one search over the document on screen and renders what it found.
 * A book is scanned segment by segment from the database - the one on
 * screen included, one loop for every part; an article (saved or live) is
 * read off its rendered blocks, which are the only copy a live page has.
 *
 * @param {string} query as typed
 */
async function runSearch(query) {
  const doc = context?.doc() ?? null;
  if (doc === null) return;
  if (!isSearchableQuery(query)) {
    held = null;
    rows?.replaceChildren();
    sayStatus(t("reader_search_short"));
    return;
  }

  const folded = foldQuery(query);
  const turn = ++scanEpoch;
  rows?.replaceChildren();

  /** @type {DocHit[]} */
  const hits = [];
  let capped = false;

  if (doc.origin === "book") {
    for (let index = 0; index < doc.segmentCount; index += 1) {
      sayStatus(
        t("reader_book_part_of", [(index + 1).toLocaleString(), doc.segmentCount.toLocaleString()]),
      );
      const segment = await getBookSegment(doc.url, index);
      if (turn !== scanEpoch) return;
      if (segment === null) continue;
      let room = true;
      for (let block = 0; block < segment.blocks.length && room; block += 1) {
        const text = storedBlockText(segment.blocks[block] ?? "");
        room = collectHits(text, index, block, folded, hits, DOC_HIT_CAP);
      }
      if (!room) {
        capped = true;
        break;
      }
    }
  } else {
    const root = context?.root() ?? null;
    const count = root === null ? 0 : root.children.length;
    let room = true;
    for (let block = 0; block < count && room; block += 1) {
      const text = root === null ? null : proseTextOf(root, block);
      room = collectHits(text ?? "", 0, block, folded, hits, DOC_HIT_CAP);
    }
    capped = !room;
  }

  if (turn !== scanEpoch) return;
  held = { url: doc.url, query, folded, hits, capped };
  renderResults();
}

/**
 * The held search on screen, in one replaceChildren: the count (or the
 * no-hits sentence) in the status line, then the rows - with a quiet part
 * heading wherever a book's hits cross into another part or chapter.
 * Article hits carry no headings: an article's TOC indexes the dissolved
 * walk, not the block order the hits speak, and the list is one text's
 * hits in reading order anyway.
 */
function renderResults() {
  if (rows === null || held === null) return;
  const doc = context?.doc() ?? null;
  const book = doc !== null && doc.origin === "book" ? doc : null;
  const toc = book === null ? [] : (context?.toc() ?? []);

  if (held.hits.length === 0) {
    rows.replaceChildren();
    sayStatus(t("reader_search_none"));
    return;
  }
  const count = plural(held.hits.length, "reader_search_count");
  sayStatus(
    held.capped ? `${count} ${t("reader_search_capped", [DOC_HIT_CAP.toLocaleString()])}` : count,
  );

  /** @type {Element[]} */
  const built = [];
  let lastLabel = "";
  held.hits.forEach((hit, index) => {
    if (book !== null) {
      const chapter = chapterOf(toc, hit.segmentIndex, hit.block);
      const part = t("reader_book_part_of", [
        (hit.segmentIndex + 1).toLocaleString(),
        book.segmentCount.toLocaleString(),
      ]);
      const label = chapter === null ? part : `${part} - ${chapter.title}`;
      if (label !== lastLabel) {
        const heading = document.createElement("p");
        heading.className = "search-part";
        heading.textContent = label;
        built.push(heading);
        lastLabel = label;
      }
    }
    const row = document.createElement("button");
    row.type = "button";
    row.dataset["index"] = String(index);
    // The snippet is somebody's text and may run the other way.
    row.dir = "auto";
    const before = document.createElement("span");
    before.textContent = hit.before;
    const match = document.createElement("b");
    match.textContent = hit.match;
    const after = document.createElement("span");
    after.textContent = hit.after;
    row.append(before, match, after);
    built.push(row);
  });
  rows.replaceChildren(...built);
}

form?.addEventListener("submit", (event) => {
  // The engine's own submit would navigate the page; the press means "scan".
  event.preventDefault();
  void runSearch(input?.value ?? "");
});

closeButton?.addEventListener("click", () => closeDocSearch());

// However the dialog went away - the X, Esc, the backdrop, a pressed row -
// a scan still running is reporting to nobody and stops at its next check.
dialog?.addEventListener("close", () => {
  scanEpoch += 1;
});

// To a click the backdrop is the dialog element itself - everything inside
// is covered by the header, the form and the rows, which carry the padding.
dialog?.addEventListener("click", (event) => {
  if (event.target === dialog) closeDocSearch();
});

rows?.addEventListener("click", (event) => {
  const row = event.target instanceof Element ? event.target.closest("button") : null;
  if (!(row instanceof HTMLButtonElement) || row.dataset["index"] === undefined) return;
  const remembered = held;
  const hit = remembered === null ? undefined : remembered.hits[Number(row.dataset["index"])];
  if (remembered === null || hit === undefined) return;
  closeDocSearch();
  context?.onJump(hit, remembered.folded);
});
