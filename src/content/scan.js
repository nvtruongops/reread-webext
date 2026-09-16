/**
 * Walking a page for saved phrases, without changing a thing about it.
 *
 * The unit of matching is a block, not a text node. A page writes one sentence
 * as several nodes whenever there is a link or an `<em>` in it, so the text
 * nodes of a block are joined, matched as one string, and the matches are
 * mapped back onto the nodes they came from. A range may therefore start in one
 * node and end in another, which is exactly what the reader sees anyway.
 *
 * The walk stops at block boundaries so that two paragraphs never join into a
 * word that is on neither of them, and it never enters script, style, form
 * fields or anything being edited.
 *
 * That rule has a second reader: `findable` asks the same walk whether a phrase
 * somebody just selected could be found at all, which is what decides whether
 * it may be saved.
 */

import { buildIndex, findMatches } from "../lib/matcher/index.js";
import { joinPieces, locate, unwrapLines } from "../lib/matcher/spans.js";

/** Text that is never prose: not rendered, or being typed into. */
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "SVG"]);

/**
 * Where one run of text ends and the next begins. A tag list rather than
 * `getComputedStyle`, which would be a layout question asked once per element
 * on the page - and the answer would be the same for all but a handful.
 */
const BLOCK = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BODY", "BR", "CAPTION", "DD", "DETAILS",
  "DIALOG", "DIV", "DL", "DT", "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM",
  "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P",
  "PRE", "SECTION", "SUMMARY", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
]);

/** @typedef {{ range: Range, normalized: string }} Painted */

/**
 * The nearest thing that counts as a block above a node - the granularity at
 * which a page is rescanned after it changes.
 *
 * @param {Node} node
 * @returns {Element | null}
 */
export function blockAround(node) {
  const start = node.nodeType === Node.ELEMENT_NODE ? /** @type {Element} */ (node) : node.parentElement;
  for (let element = start; element !== null; element = element.parentElement) {
    if (BLOCK.has(element.tagName)) return element;
  }
  return document.body;
}

/**
 * The prose of one block, in the pieces it is stored in, with a line break
 * standing in for every nested block and `<br>`.
 *
 * The break matters: `<p>one<br>two</p>` is two lines to the reader, and joining
 * them would invent a sentence that is on neither of them. `sentenceAround`
 * treats a line as an ending, so putting one here is all it takes.
 *
 * Which is why the breaks a text node already holds must not stay: a file
 * wrapped at seventy columns has one in the middle of every other sentence,
 * and the reader sees a space there (`unwrapLines`). Inside `<pre>` they are
 * lines, and stay. A tag rather than the block's computed `white-space`, in
 * keeping with `blockAround`: a paragraph that keeps its line breaks by
 * stylesheet alone is read as if it did not, at the cost of a sentence that
 * runs across a break the reader can see.
 *
 * @param {Element} block
 * @returns {{ node: Text | null, text: string }[]}
 */
function partsOf(block) {
  /** @type {{ node: Text | null, text: string }[]} */
  const parts = [];
  const preformatted = block.tagName === "PRE";

  /**
   * @param {Node} node
   */
  const walk = (node) => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = /** @type {Text} */ (child);
        parts.push({ node: text, text: preformatted ? text.data : unwrapLines(text.data) });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const element = /** @type {Element} */ (child);
      if (SKIP.has(element.tagName)) continue;
      if (element instanceof HTMLElement && element.isContentEditable) continue;

      // A nested block cannot be holding the selection - `blockAround` returns
      // the nearest block above it - so what is inside belongs to another
      // sentence, and the break is the whole of what we need from it.
      if (BLOCK.has(element.tagName)) {
        parts.push({ node: null, text: "\n" });
        continue;
      }
      walk(element);
    }
  };

  walk(block);
  return parts;
}

/**
 * The prose under one root, in the pieces it is stored in, with a line break
 * standing in for every block boundary crossed on the way.
 *
 * `partsOf` above stops at nested blocks because a block is as far as a phrase
 * may reach; this walks straight through them, because reading an article
 * aloud (D87) is exactly the thing that has to cross them - the article is one
 * text, read from its title to its last paragraph. The breaks are what keeps
 * two paragraphs from being joined into a sentence that is on neither of them:
 * `endsSentence` counts a line break as an ending, so every block ends an
 * utterance whether it is punctuated or not.
 *
 * The pieces come out in document order and are the same `BlockPart` shape the
 * matcher joins, so `joinPieces` and `locate` do the offset arithmetic here
 * too - one way of getting from a character back to the text node it is in.
 * The line breaks a text node holds from its file are read as spaces here as
 * well (`unwrapLines`, see `partsOf`), so the voice does not stop for breath
 * at the end of every line of a wrapped file; inside `<pre>` they stay lines.
 *
 * @param {Element} root
 * @returns {BlockPart[]}
 */
export function prosePieces(root) {
  /** @type {BlockPart[]} */
  const parts = [];

  /**
   * @param {Node} node
   * @param {boolean} preformatted inside a `<pre>`, where a line break is a line
   */
  const walk = (node, preformatted) => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = /** @type {Text} */ (child);
        parts.push({ node: text, text: preformatted ? text.data : unwrapLines(text.data) });
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const element = /** @type {Element} */ (child);
      if (SKIP.has(element.tagName)) continue;
      if (element instanceof HTMLElement && element.isContentEditable) continue;

      const boundary = BLOCK.has(element.tagName);
      if (boundary) parts.push({ node: null, text: "\n" });
      walk(element, preformatted || element.tagName === "PRE");
      if (boundary) parts.push({ node: null, text: "\n" });
    }
  };

  walk(root, root.tagName === "PRE");
  return parts;
}

/**
 * One block's text machinery, handed out whole: the block a node lives in, its
 * prose in pieces, the pieces joined, and where each piece sits in the joined
 * text. `blockTextAround` reads it to place a selection; the reader's touch
 * selection (D80) reads it to turn a tapped point into a word and a span of
 * words back into a `Range` - the same arithmetic, so the two can never
 * disagree about where a word begins.
 *
 * @typedef {{ node: Text | null, text: string }} BlockPart
 * @param {Node} node
 * @returns {{ block: Element, parts: BlockPart[], text: string, spans: import("../lib/matcher/spans.js").Span[] } | null}
 */
export function blockPieces(node) {
  const block = blockAround(node);
  if (block === null) return null;
  const parts = partsOf(block);
  const { text, spans } = joinPieces(parts.map((part) => part.text));
  return { block, parts, text, spans };
}

/**
 * Where a selection sits inside the text of its block: the text the reader sees
 * as one run, and the two offsets into it.
 *
 * Returns null whenever the answer would be a guess - a selection anchored on an
 * element rather than in text, or one that starts in one block and ends in
 * another. The caller loses the sentence, not the translation.
 *
 * @param {Range} range
 * @returns {{ text: string, start: number, end: number } | null}
 */
export function blockTextAround(range) {
  const pieces = blockPieces(range.startContainer);
  if (pieces === null) return null;
  const { parts, text, spans } = pieces;

  /**
   * @param {Node} container
   * @param {number} offset
   * @returns {number | null}
   */
  const offsetOf = (container, offset) => {
    const index = parts.findIndex((part) => part.node === container);
    const span = spans[index];
    if (index === -1 || span === undefined) return null;
    return span.start + offset;
  };

  const start = offsetOf(range.startContainer, range.startOffset);
  const end = offsetOf(range.endContainer, range.endOffset);
  if (start === null || end === null) return null;

  return { text, start, end };
}

/**
 * @param {Text[]} pieces text nodes the reader sees as one run
 * @param {import("../lib/matcher/index.js").PhraseIndex} index
 * @param {Painted[]} into
 */
function matchRun(pieces, index, into) {
  if (pieces.length === 0) return;

  const { text, spans } = joinPieces(pieces.map((piece) => piece.data));
  for (const match of findMatches(text, index)) {
    // The last character rather than the position after it: an end that lands
    // exactly on a boundary would otherwise point at the piece after the match.
    const from = locate(spans, match.start);
    const to = locate(spans, match.end - 1);
    const first = from === null ? undefined : pieces[from.piece];
    const last = to === null ? undefined : pieces[to.piece];
    if (from === null || to === null || first === undefined || last === undefined) continue;

    const range = document.createRange();
    range.setStart(first, from.offset);
    range.setEnd(last, to.offset + 1);
    into.push({ range, normalized: match.normalized });
  }
}

/**
 * @param {Node} root
 * @param {import("../lib/matcher/index.js").PhraseIndex} index
 * @returns {Painted[]}
 */
export function scan(root, index) {
  /** @type {Painted[]} */
  const found = [];
  /** @type {Text[]} */
  let run = [];

  const flush = () => {
    matchRun(run, index, found);
    run = [];
  };

  /**
   * @param {Node} node
   */
  const walk = (node) => {
    for (let child = node.firstChild; child !== null; child = child.nextSibling) {
      if (child.nodeType === Node.TEXT_NODE) {
        run.push(/** @type {Text} */ (child));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;

      const element = /** @type {Element} */ (child);
      if (SKIP.has(element.tagName)) continue;
      if (element instanceof HTMLElement && element.isContentEditable) continue;

      const boundary = BLOCK.has(element.tagName);
      if (boundary) flush();
      walk(element);
      if (boundary) flush();
    }
  };

  if (root.nodeType === Node.TEXT_NODE) run.push(/** @type {Text} */ (root));
  else walk(root);
  flush();

  return found;
}

/**
 * Whether a phrase selected here is one a page could ever show underlined.
 *
 * The vocabulary is only worth what can be met again. A selection running from
 * one paragraph into the next - or across a `<br>`, two list items, two cells
 * of a table - is a phrase that is on none of them: the walk above stops at
 * every block, so no scan will ever match it. Neither will half a word, because
 * matching is by whole tokens. Kept, such a phrase is a row in the database, a
 * line in the export and a card for something the reader will never meet marked
 * on a page.
 *
 * Answered by running the real walk over the block the selection starts in,
 * rather than by reasoning about where the range begins and ends: this is the
 * code that decides what gets painted, so it is also the honest answer to
 * whether anything would be. A whole paragraph taken by a triple click is found
 * in its block; the same text plus the first word of the next paragraph is not.
 *
 * @param {Range} range
 * @param {string} normalized the key the phrase would be stored under
 * @returns {boolean}
 */
export function findable(range, normalized) {
  if (normalized.length === 0) return false;
  const block = blockAround(range.startContainer);
  if (block === null) return false;
  return scan(block, buildIndex([normalized])).length > 0;
}
