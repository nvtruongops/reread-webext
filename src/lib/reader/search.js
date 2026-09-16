/**
 * The rules of in-text search (D119), with no DOM and no database in sight -
 * the same split as `position.js` and `marks.js`, so that every decision here
 * runs under `node --test`.
 *
 * A query matches as one exact phrase, case-insensitively, against the prose
 * text of one top-level block - the `prosePieces` text the highlighter's
 * marks anchor into, so a hit names a place in the same `{block, offset}`
 * language the rest of the reader speaks. Matching never crosses a top-level
 * block: paragraphs are separate texts, and a phrase stitched over their gap
 * would be a sentence that is on neither of them.
 *
 * Both sides are matched through a *fold*: combining runs NFC-composed,
 * layout artifacts (soft hyphens, zero-width spaces - the two `normalize.js`
 * strips) dropped, everything lowercased, whitespace runs pressed to one
 * space. The fold carries a map back to the original offsets, because the
 * original text is what a DOM range can be built from - and the map is
 * written per folded unit, never assumed one-to-one: lowercasing is not
 * length-preserving ("İ" folds to two units), and a collapsed whitespace
 * run is one unit standing for many.
 *
 * Diacritics are deliberately not folded: "łaska" is not "laska", and
 * `normalize.js` holds the same line for phrase keys.
 */

/**
 * The least a query may fold to. One character finds everything and means
 * nothing; two is where a search starts being a question.
 */
export const MIN_QUERY = 2;

/**
 * The most hits the in-document search collects before stopping. Far above
 * what anybody walks through by hand; the cap exists so a one-letter word
 * of a phrase cannot turn a book's scan into a list of thousands.
 */
export const DOC_HIT_CAP = 200;

/** How much of the block stands on each side of a snippet's match. */
export const SNIPPET_CONTEXT = 30;

/**
 * How many hits one press on the reading list's search collects before it
 * stops and offers to go on - the batch that keeps a scan of the whole
 * library a portion, not a commitment.
 */
export const LIBRARY_BATCH = 20;

/**
 * The most hits the list's scan collects from one document. Together with
 * the batch it bounds a portion at a document boundary: a book stuffed with
 * a common word contributes a row and a count, not a wall.
 */
export const DOC_HIT_LIMIT = 50;

/** How many snippets a list result shows before "and m more" stands in. */
export const SHOWN_SNIPPETS = 3;

/** The two invisibles `normalize.js` also strips - layout, not language. */
const ARTIFACT = new RegExp("^[\\u00AD\\u200B]+$");
const COMBINING = new RegExp("^\\p{M}$", "u");
const WHITESPACE = /^\s+$/u;

/**
 * A span of text, `end` exclusive - in folded units out of `findHits`, in
 * original units out of `hitsInText`.
 *
 * @typedef {{ start: number, end: number }} TextSpan
 */

/**
 * The folded text and, per folded UTF-16 unit, where its source cluster
 * begins and ends in the original string.
 *
 * @typedef {{ folded: string, starts: number[], ends: number[] }} SearchFold
 */

/**
 * @param {string} text
 * @param {number} at
 * @returns {number} the UTF-16 length of the code point starting here
 */
function charLength(text, at) {
  const code = text.codePointAt(at) ?? 0;
  return code > 0xffff ? 2 : 1;
}

/**
 * Folds one string for matching and maps every folded unit back to the
 * cluster it came from. The walk goes cluster by cluster - one base code
 * point with the combining marks riding it - because NFC can only compose
 * inside that window: folding window by window keeps the map honest where
 * a whole-string `normalize()` would silently move every offset after the
 * first composition.
 *
 * @param {string} text
 * @returns {SearchFold}
 */
export function foldForSearch(text) {
  let folded = "";
  /** @type {number[]} */
  const starts = [];
  /** @type {number[]} */
  const ends = [];
  let at = 0;
  while (at < text.length) {
    let length = charLength(text, at);
    while (at + length < text.length) {
      const mark = text.slice(at + length, at + length + charLength(text, at + length));
      if (!COMBINING.test(mark)) break;
      length += mark.length;
    }
    const end = at + length;
    const piece = text.slice(at, end).normalize("NFC").toLowerCase();

    if (ARTIFACT.test(piece)) {
      // A soft hyphen drops out of the fold but stays inside any span that
      // crosses it - the map's start/end arithmetic covers it on its own.
      at = end;
      continue;
    }
    if (WHITESPACE.test(piece)) {
      if (folded.length === 0) {
        // Leading air: nothing emitted, nothing to widen.
      } else if (folded.endsWith(" ")) {
        // The run this space stands for grows; a span ending on it keeps
        // covering the whole run.
        ends[ends.length - 1] = end;
      } else {
        folded += " ";
        starts.push(at);
        ends.push(end);
      }
      at = end;
      continue;
    }
    for (let unit = 0; unit < piece.length; unit += 1) {
      starts.push(at);
      ends.push(end);
    }
    folded += piece;
    at = end;
  }
  return { folded, starts, ends };
}

/**
 * A query as it is matched: folded like the text and trimmed - the box's
 * stray spaces ask nothing.
 *
 * @param {string} query as typed
 * @returns {string}
 */
export function foldQuery(query) {
  return foldForSearch(query).folded.trim();
}

/**
 * Whether the box holds a question worth scanning for.
 *
 * @param {string} query as typed
 * @returns {boolean}
 */
export function isSearchableQuery(query) {
  return foldQuery(query).length >= MIN_QUERY;
}

/**
 * Every occurrence of the folded query in a folded text, in order and
 * without overlap - the next search starts where the last hit ended, so
 * "aa" in "aaaa" is two hits, not three.
 *
 * @param {string} folded
 * @param {string} foldedQuery
 * @returns {TextSpan[]} spans in folded units
 */
export function findHits(folded, foldedQuery) {
  if (foldedQuery.length === 0) return [];
  /** @type {TextSpan[]} */
  const hits = [];
  let from = 0;
  for (;;) {
    const at = folded.indexOf(foldedQuery, from);
    if (at === -1) return hits;
    hits.push({ start: at, end: at + foldedQuery.length });
    from = at + foldedQuery.length;
  }
}

/**
 * The whole pipeline over one block's prose: fold, find, and map every hit
 * back to original offsets - the offsets a DOM range and a snippet can be
 * built from.
 *
 * @param {string} text one block's prose, as `prosePieces` joins it
 * @param {string} foldedQuery as `foldQuery` built it
 * @returns {TextSpan[]} spans in original units
 */
export function hitsInText(text, foldedQuery) {
  const fold = foldForSearch(text);
  /** @type {TextSpan[]} */
  const spans = [];
  for (const hit of findHits(fold.folded, foldedQuery)) {
    const start = fold.starts[hit.start];
    const end = fold.ends[hit.end - 1];
    if (start === undefined || end === undefined) continue;
    spans.push({ start, end });
  }
  return spans;
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

/**
 * @param {number} code
 * @returns {boolean}
 */
function isLowSurrogate(code) {
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * What a snippet shows of a piece: the prose's own line breaks (block
 * boundaries inside the block) pressed to spaces - a list row is one line.
 *
 * @param {string} piece
 * @returns {string}
 */
function onOneLine(piece) {
  return piece.replace(/\s+/gu, " ");
}

/**
 * One hit dressed for a list row: the phrase as the text carries it, with a
 * measured breath of context either side and an ellipsis wherever the block
 * goes on. A budget cut can land between the halves of a surrogate pair;
 * the stranded half is dropped rather than shown as garbage.
 *
 * @param {string} text the block's prose
 * @param {TextSpan} span the hit, in original units
 * @param {number} [budget]
 * @returns {{ before: string, match: string, after: string }}
 */
export function snippetAround(text, span, budget = SNIPPET_CONTEXT) {
  const from = Math.max(0, span.start - budget);
  const to = Math.min(text.length, span.end + budget);
  let before = text.slice(from, span.start);
  let after = text.slice(span.end, to);
  if (before.length > 0 && isLowSurrogate(before.charCodeAt(0))) before = before.slice(1);
  if (after.length > 0 && isHighSurrogate(after.charCodeAt(after.length - 1))) {
    after = after.slice(0, -1);
  }
  return {
    before: (from > 0 ? "…" : "") + onOneLine(before),
    match: onOneLine(text.slice(span.start, span.end)),
    after: onOneLine(after) + (to < text.length ? "…" : ""),
  };
}

/**
 * Whether a row's own words - its title, its site or author - carry the
 * phrase. The same fold as the text scan, so the two groups of the list's
 * results answer one question two ways, never two questions.
 *
 * @param {string} searchable the row's words, joined however the caller keeps them
 * @param {string} foldedQuery as `foldQuery` built it
 * @returns {boolean}
 */
export function metaMatches(searchable, foldedQuery) {
  return foldedQuery.length > 0 && foldForSearch(searchable).folded.includes(foldedQuery);
}

/**
 * How a list result wears its hits: the first few as snippets, the rest as
 * one counted line - a document stuffed with a common word is a row, not a
 * wall.
 *
 * @param {number} total how many hits the document gave, within its limit
 * @returns {{ shown: number, more: number }}
 */
export function snippetPlan(total) {
  const shown = Math.min(Math.max(0, total), SHOWN_SNIPPETS);
  return { shown, more: Math.max(0, total) - shown };
}

/**
 * Which chapter a place falls under: the last entry at or before the part
 * and block - `currentTocRow`'s own rule, kept here so a result list and
 * the dialog's "you are here" can never disagree. Null before the first
 * heading, and for every book without a table at all.
 *
 * @param {import("../book/toc.js").TocEntry[]} toc
 * @param {number} segmentIndex
 * @param {number} block
 * @returns {import("../book/toc.js").TocEntry | null}
 */
export function chapterOf(toc, segmentIndex, block) {
  let found = null;
  for (const entry of toc) {
    if (
      entry.segmentIndex < segmentIndex ||
      (entry.segmentIndex === segmentIndex && entry.blockIndex <= block)
    ) {
      found = entry;
    }
  }
  return found;
}
