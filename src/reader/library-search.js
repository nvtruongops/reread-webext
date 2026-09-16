/**
 * Search through the whole reading list (D119): the scan behind the list's
 * "search in the texts too" checkbox, and the results it renders in the
 * list's place.
 *
 * The scan is the document dialog's loop over more documents: the same fold,
 * the same per-block collection (`collectHits`), the same anchors - a hit
 * found here lands through the same `SearchTarget` road. What is new is the
 * portioning: documents are walked in the list's own order (to-read first,
 * freshest first - the shelves as their reader knows them) until a batch of
 * hits stands, and the walk always breaks at a document boundary; "Search
 * further" resumes at the cursor, so nothing is scanned twice. The order is
 * a snapshot taken when the search starts: a list edited from another tab
 * mid-search keeps this scan's ground stable, and a document deleted under
 * it simply reads as empty.
 *
 * Two groups answer one question two ways: rows whose own words (title,
 * site, author) carry the phrase show at once, before any content is read -
 * they cost nothing, the words are already in memory - and rows whose text
 * carries it follow batch by batch. A document may stand in both, which is
 * two true sentences, each under its own heading.
 *
 * Memory holds one document at a time and, of the results, only snippets
 * and anchors; the batch renders in one `replaceChildren` - the e-ink
 * bargain the dialog already keeps. Nothing here is stored: the search
 * lives and dies with the page.
 */

import { prosePieces } from "../content/scan.js";
import { plural, t } from "../lib/i18n.js";
import { buildArticle } from "../lib/reader/article.js";
import {
  DOC_HIT_LIMIT,
  LIBRARY_BATCH,
  foldQuery,
  metaMatches,
  snippetPlan,
} from "../lib/reader/search.js";
import { allPositions, getArticle, listArticles } from "../lib/store/articles.js";
import { getBookSegment, listBooks } from "../lib/store/books.js";
import { Segment, listedRows } from "../lib/store/saved-article.js";
import { collectHits, storedBlockText } from "./doc-search.js";
import { articleEntry, bookEntry, searchableArticle } from "./list-view.js";

/** @typedef {import("./doc-search.js").DocHit} DocHit */

/**
 * One document of the scan's snapshot: what the walk needs to read it and
 * what its result row shows. `searchable` is the row's own words, the
 * filter's field (`searchableArticle`); `segments` is 1 for an article.
 *
 * @typedef {{
 *   kind: "article" | "book",
 *   url: string,
 *   title: string,
 *   searchable: string,
 *   detail: string,
 *   segments: number,
 * }} SearchDoc
 */

/**
 * The place a pressed snippet asks the reader to land on - the same shape
 * `openSaved`/`openBook` take as their `SearchTarget`.
 *
 * @typedef {{ segmentIndex: number, block: number, from: number, to: number,
 *   folded: string }} HitTarget
 */

/**
 * What the reader page wires in: the two ways out of a result row. Both
 * push the history entry a list row's press writes - a result is a way of
 * opening a document, and Back must mean the same step back.
 *
 * @typedef {{
 *   onOpen: (kind: "article" | "book", url: string, target: HitTarget | undefined) => void,
 *   onOpenSearch: (kind: "article" | "book", url: string, query: string) => void,
 * }} LibrarySearchContext
 */

const statusLine = document.getElementById("library-search-status");
const rowsList = document.getElementById("library-search-rows");
const moreLine = document.getElementById("library-search-more-line");
const moreButton = document.getElementById("library-search-more");

/** @type {LibrarySearchContext | null} */
let context = null;

/**
 * The search on screen, or null when the list stands plain. `cursor` is the
 * next snapshot index to scan; `metaDocs` are the indices whose own words
 * matched, decided once at the start; `found` grows a row per document with
 * hits, in scan order.
 *
 * @type {{
 *   query: string,
 *   folded: string,
 *   docs: SearchDoc[],
 *   metaDocs: number[],
 *   cursor: number,
 *   found: { doc: SearchDoc, hits: DocHit[] }[],
 * } | null}
 */
let search = null;

/**
 * Counts the scans, the document dialog's own guard: an await checks the
 * count it started under and stops when the count moved on - a dismissed
 * search must not keep reading books to nobody.
 */
let scanEpoch = 0;

/** Batches mid-flight - while one runs, "Search further" stays away. */
let batchesRunning = 0;

/**
 * @param {LibrarySearchContext} wiring
 */
export function configureLibrarySearch(wiring) {
  context = wiring;
}

/** Whether search results are what the list area should be showing. */
export function librarySearchShown() {
  return search !== null;
}

/**
 * Forgets the search and empties its furniture. The caller decides what the
 * list shows instead - this module never touches the plain list's elements.
 */
export function dismissLibrarySearch() {
  scanEpoch += 1;
  search = null;
  rowsList?.replaceChildren();
  if (statusLine !== null) {
    statusLine.hidden = true;
    statusLine.textContent = "";
  }
  if (moreLine !== null) moreLine.hidden = true;
}

/**
 * Starts a fresh search: the snapshot is taken and the rows whose own words
 * match are rendered - that much is what the returned promise waits for, so
 * the caller can put the results on screen at once. The first batch of the
 * text scan runs on behind it: meta rows must not wait for a book to be
 * read.
 *
 * @param {string} query as typed
 */
export async function startLibrarySearch(query) {
  const folded = foldQuery(query);
  const turn = ++scanEpoch;
  const docs = await loadDocs();
  if (turn !== scanEpoch) return;
  /** @type {number[]} */
  const metaDocs = [];
  docs.forEach((doc, index) => {
    if (metaMatches(doc.searchable, folded)) metaDocs.push(index);
  });
  search = { query, folded, docs, metaDocs, cursor: 0, found: [] };
  void runBatch();
}

/**
 * The list as the scan will walk it: both halves in the list's own order,
 * to-read first - and dressed once with everything a result row will say,
 * so rendering later asks nothing of storage.
 *
 * @returns {Promise<SearchDoc[]>}
 */
async function loadDocs() {
  const [metas, books, positions] = await Promise.all([
    listArticles(),
    listBooks(),
    allPositions(),
  ]);
  const entries = [
    ...metas.map((meta) => articleEntry(meta, positions.get(meta.url) ?? null)),
    ...books.map((book) => bookEntry(book, positions.get(book.id) ?? null)),
  ];
  const ordered = [...listedRows(entries, Segment.UNREAD), ...listedRows(entries, Segment.READ)];
  return ordered.map((entry) => ({
    kind: entry.kind,
    url: entry.url,
    title: entry.title,
    searchable: searchableArticle(entry),
    detail: detailOf(entry),
    segments: entry.kind === "book" ? (entry.progress?.of ?? 1) : 1,
  }));
}

/**
 * The line under a result's title: where the document came from, what it
 * is, and which half of the list it stands in - the search spans both, so
 * the row has to say which (the plan's own promise).
 *
 * @param {import("./list-view.js").LibraryEntry} entry
 * @returns {string}
 */
function detailOf(entry) {
  const tab = entry.readAt === null ? t("reader_segment_unread") : t("reader_segment_read");
  const parts =
    entry.kind === "book"
      ? [entry.hostname, t("reader_book_label"), tab]
      : [entry.hostname, tab];
  return parts.filter((part) => part.length > 0).join(" - ");
}

/**
 * Scans documents from the cursor until a batch of hits stands, breaking at
 * a document boundary, and renders what the search now holds. Also the
 * "Search further" press.
 */
async function runBatch() {
  const state = search;
  if (state === null) return;
  const turn = ++scanEpoch;
  batchesRunning += 1;
  // Rendered before the walk too: the own-words rows and, over an empty
  // list, the no-hits sentence must not wait for the loop to notice there
  // is nothing to do.
  renderSearch();
  try {
    let collected = 0;
    while (state.cursor < state.docs.length && collected < LIBRARY_BATCH) {
      updateStatus();
      const doc = state.docs[state.cursor];
      const hits = doc === undefined ? [] : await scanDoc(doc, state.folded);
      if (turn !== scanEpoch) return;
      state.cursor += 1;
      if (doc !== undefined && hits.length > 0) {
        state.found.push({ doc, hits });
        collected += hits.length;
      }
    }
  } finally {
    batchesRunning -= 1;
  }
  renderSearch();
}

/**
 * One document's hits, within the per-document limit - a book segment by
 * segment through the dialog's own reader, an article through the very
 * rebuild the render performs (`buildArticle` is deterministic, so block
 * numbering here is block numbering on screen). A document that cannot be
 * read - deleted under the scan, torn - answers as empty, never as an
 * error: the scan is a walk over what is still there.
 *
 * @param {SearchDoc} doc
 * @param {string} folded
 * @returns {Promise<DocHit[]>}
 */
async function scanDoc(doc, folded) {
  /** @type {DocHit[]} */
  const hits = [];
  let room = true;
  if (doc.kind === "book") {
    for (let index = 0; index < doc.segments && room; index += 1) {
      const segment = await getBookSegment(doc.url, index);
      if (segment === null) continue;
      for (let block = 0; block < segment.blocks.length && room; block += 1) {
        const text = storedBlockText(segment.blocks[block] ?? "");
        room = collectHits(text, index, block, folded, hits, DOC_HIT_LIMIT);
      }
    }
    return hits;
  }
  const article = await getArticle(doc.url);
  if (article === null) return hits;
  const source = new DOMParser().parseFromString(article.content, "text/html").body;
  // With its pictures as elements (D145): the render keeps every `<img>`
  // whether or not a picture is shown, and a picture standing as a block of
  // its own would otherwise be a block the screen has and this count lacks.
  const root = buildArticle(source, document, { baseUrl: doc.url, pictures: true });
  for (let block = 0; block < root.children.length && room; block += 1) {
    const element = root.children[block];
    const text =
      element === undefined
        ? ""
        : prosePieces(element)
            .map((part) => part.text)
            .join("");
    room = collectHits(text, 0, block, folded, hits, DOC_HIT_LIMIT);
  }
  return hits;
}

/**
 * The status line as the search stands: the count and how far the walk got,
 * or the one no-hits sentence once the whole list is walked dry. Updated
 * alone between renders too - a moving number is the scan's heartbeat, and
 * repainting one short line is cheap even on ink.
 */
function updateStatus() {
  const state = search;
  if (statusLine === null || state === null) return;
  const total = state.found.reduce((sum, result) => sum + result.hits.length, 0);
  const done = state.cursor >= state.docs.length;
  const progress = t("reader_search_progress", [
    Math.min(state.cursor, state.docs.length).toLocaleString(),
    state.docs.length.toLocaleString(),
  ]);
  statusLine.hidden = false;
  if (done && total === 0 && state.metaDocs.length === 0) {
    statusLine.textContent = t("reader_search_none");
  } else if (total === 0) {
    statusLine.textContent = progress;
  } else {
    statusLine.textContent = `${plural(total, "reader_search_count")} ${progress}`;
  }
}

/**
 * @param {string} label
 * @returns {Element}
 */
function groupHeading(label) {
  const heading = document.createElement("p");
  heading.className = "search-part";
  heading.textContent = label;
  return heading;
}

/**
 * Everything the search holds, in one replaceChildren: the own-words group
 * first (it was known before any text was read), then the text group in
 * scan order. "Search further" shows only between batches with list left
 * to walk.
 */
function renderSearch() {
  const state = search;
  if (state === null || rowsList === null) return;
  /** @type {Element[]} */
  const built = [];
  if (state.metaDocs.length > 0) {
    built.push(groupHeading(t("reader_search_in_titles")));
    for (const index of state.metaDocs) {
      const doc = state.docs[index];
      if (doc !== undefined) built.push(docRow(doc, null, state.folded, state.query));
    }
  }
  if (state.found.length > 0) {
    built.push(groupHeading(t("reader_search_in_text")));
    for (const result of state.found) {
      built.push(docRow(result.doc, result.hits, state.folded, state.query));
    }
  }
  rowsList.replaceChildren(...built);
  updateStatus();
  if (moreLine !== null) {
    moreLine.hidden = batchesRunning > 0 || state.cursor >= state.docs.length;
  }
}

/**
 * The target one hit jumps to - the payload every press in a result row
 * hands `onOpen`, in the `SearchTarget` shape the reader lands by.
 *
 * @param {DocHit} hit
 * @param {string} folded
 * @returns {HitTarget}
 */
function targetOf(hit, folded) {
  return {
    segmentIndex: hit.segmentIndex,
    block: hit.block,
    from: hit.from,
    to: hit.to,
    folded,
  };
}

/**
 * One result row: the title as the way in, the detail under it - and, for
 * a text hit, up to a few snippets, each a jump to its place, with "and m
 * more" leading into the document's own search dialog, already filled in.
 *
 * The title of a text row jumps to the FIRST hit rather than opening
 * plain: the row exists because of the phrase, and the title is what looks
 * pressable - a reader who came for the phrase must not land on the
 * reading position wondering where the highlight went (Michał's first
 * smoke, 2026-08-18). An own-words row has no place in the text to jump
 * to, so its title opens plain; so does every row of the ordinary list.
 * Titles and snippets enter as text only.
 *
 * @param {SearchDoc} doc
 * @param {DocHit[] | null} hits null for an own-words row
 * @param {string} folded
 * @param {string} query
 * @returns {Element}
 */
function docRow(doc, hits, folded, query) {
  const item = document.createElement("li");
  item.className = "library-row";

  const text = document.createElement("div");
  text.className = "library-text";

  const open = document.createElement("button");
  open.type = "button";
  open.className = "library-open";
  open.textContent = doc.title;
  const first = hits === null ? undefined : hits[0];
  open.addEventListener("click", () =>
    context?.onOpen(doc.kind, doc.url, first === undefined ? undefined : targetOf(first, folded)),
  );

  const detail = document.createElement("span");
  detail.className = "library-item-detail";
  detail.textContent = doc.detail;

  text.append(open, detail);

  if (hits !== null) {
    const plan = snippetPlan(hits.length);
    const snippets = document.createElement("div");
    snippets.className = "search-snippets";
    for (const hit of hits.slice(0, plan.shown)) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "search-snippet";
      row.dir = "auto";
      const before = document.createElement("span");
      before.textContent = hit.before;
      const match = document.createElement("b");
      match.textContent = hit.match;
      const after = document.createElement("span");
      after.textContent = hit.after;
      row.append(before, match, after);
      row.addEventListener("click", () => context?.onOpen(doc.kind, doc.url, targetOf(hit, folded)));
      snippets.append(row);
    }
    if (plan.more > 0) {
      const more = document.createElement("button");
      more.type = "button";
      more.className = "search-snippet search-more-hits";
      more.textContent = plural(plan.more, "reader_search_more_hits");
      more.addEventListener("click", () => context?.onOpenSearch(doc.kind, doc.url, query));
      snippets.append(more);
    }
    text.append(snippets);
  }

  item.append(text);
  return item;
}

moreButton?.addEventListener("click", () => void runBatch());
