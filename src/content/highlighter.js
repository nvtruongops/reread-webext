/**
 * Underlining saved phrases on a page, without touching the page.
 *
 * The CSS Custom Highlight API is the whole reason this can exist: ranges are
 * handed to the browser and painted, and the document keeps exactly the nodes
 * its author wrote. Wrapping matches in `<span>` - the usual way to do this -
 * breaks single-page applications, invalidates the page's own `Range` objects
 * and comes back as a bug nobody can reproduce.
 *
 * Clicking an underline is answered with geometry rather than
 * `caretPositionFromPoint`: the ranges are already known, so asking which of
 * their rectangles contains the pointer is exact, and one browser difference
 * less to carry into the Chromium port. A caret position answers "the nearest
 * place a cursor could go", which is not the question.
 *
 * Pages that change after they load are followed with a `MutationObserver`, and
 * only the block that changed is looked at again. The observer exists only
 * while there is something to underline: with an empty vocabulary this module
 * registers nothing, walks nothing and watches nothing.
 *
 * Where it paints is given rather than assumed. On a page being read that is
 * the whole body; in the reader it is the article, so that the reader's own
 * heading and links are not underlined - and nothing there changes on its own,
 * so the observer is not started at all.
 */

import { whenIdle } from "../lib/idle.js";
import { buildIndex } from "../lib/matcher/index.js";
import { DEFAULT_UNDERLINE, UNDERLINE_NAMES, underlineName } from "../lib/underline.js";
import { blockAround, scan } from "./scan.js";

/**
 * The registration the ranges are painted under right now - one of the names
 * `highlight.css` styles, chosen by the underline setting (D130). Held rather
 * than recomputed, because taking the paint back has to reach the name the
 * paint actually went on.
 */
let name = underlineName(DEFAULT_UNDERLINE);

/** The other name there: the mark under the phrase a recall bubble is about. */
const ACTIVE = "reread-active";

/** How long a page may go on changing before the underlines are caught up. */
const IDLE_TIMEOUT = 500;

/**
 * Past this many changed blocks in one batch, the page is being rebuilt rather
 * than edited, and walking it once is cheaper than reasoning about the pieces.
 */
const RESCAN_EVERYTHING = 40;

/** @typedef {import("./scan.js").Painted} Painted */

/** @type {Painted[]} */
let painted = [];
/** The registered highlight. It is live: adding a range to it repaints. */
/** @type {Highlight | null} */
let live = null;
/** @type {import("../lib/matcher/index.js").PhraseIndex} */
let index = new Map();
/** @type {MutationObserver | null} */
let observer = null;
/** What was painted, and what a mutation is rescanned against. */
/** @type {Element | null} */
let scope = null;
/** @type {Set<Element>} */
const pending = new Set();
let scheduled = false;

/**
 * The API, or nothing at all. Firefox has had it since 140 and the manifest
 * asks for 142, but a content script runs in whatever the reader is actually
 * running, and this is not worth an exception on somebody's page.
 *
 * @returns {HighlightRegistry | null}
 */
function registry() {
  if (typeof CSS === "undefined" || !("highlights" in CSS)) return null;
  if (typeof Highlight !== "function") return null;
  return CSS.highlights;
}

/** @returns {boolean} */
export function supported() {
  return registry() !== null;
}

/**
 * A registration taken back so that every engine repaints it. Deleting from
 * the registry drops the entry without repainting its ranges in WebKit up to
 * Safari 18 (`HighlightRegistry::remove`; trunk repaints): the paint stays on
 * the screen until something else happens to repaint that spot - on the iPad
 * that was the closing bubble's own patch and nothing beside it, the stale
 * navy wash of the spike's P2 (Michał's screenshots, 2026-08-26). Emptying
 * the set first goes through `clearFromSetLike`, which repaints every range
 * on every engine, and the delete after it has nothing left to forget. Every
 * take-back in this extension comes through here - `test/highlighter.test.js`
 * pins that no module deletes from the registry on its own.
 *
 * @param {string} name
 */
export function unregister(name) {
  const api = registry();
  if (api === null) return;
  api.get(name)?.clear();
  api.delete(name);
}

/**
 * Every registration re-anchored: each highlight's ranges taken out and put
 * back, the same objects under the same names. An engine paints a range
 * between candidate caret positions, and WebKit up to Safari 18 refuses
 * those in inert text - so for as long as a modal dialog stands, every range
 * outside it anchors to nothing and paints nowhere, and the frame that takes
 * the dialog down does not always bring the paint back: the mark and the
 * underlines under a closed note dialog stayed gone until a scroll (Michał's
 * iPad, 2026-08-26). Putting the ranges back is the one move every engine
 * answers with a fresh anchoring and a repaint - `add` repaints a range
 * wherever it now stands. The registry is walked rather than the modules
 * asked, because it is the paint that needs settling, whoever made it.
 */
export function refresh() {
  const api = registry();
  if (api === null) return;
  for (const [, highlight] of api) {
    const ranges = [...highlight];
    highlight.clear();
    for (const range of ranges) highlight.add(range);
  }
}

/**
 * The mark under the phrase an open recall bubble is about (D89). One range,
 * marked at showing and taken away with the bubble: the bubble deliberately
 * does not repeat its phrase, a tap on an underline makes no selection, and
 * with two underlined neighbours nothing on the page said which one the
 * bubble answers.
 *
 * A registration of its own rather than a range added to the underline's,
 * because the
 * two live different lives: `paint` rebuilds the underlines on every
 * vocabulary change - choosing a dictionary line repaints with the bubble
 * still open - and the mark may not blink with them.
 *
 * @param {Range} range
 */
export function mark(range) {
  const api = registry();
  if (api === null) return;
  // Cloned, so the mark keeps meaning this phrase whatever the caller or the
  // live selection do with the range afterwards.
  api.set(ACTIVE, new Highlight(range.cloneRange()));
}

/** The mark taken back - every way a bubble closes ends here. */
export function unmark() {
  unregister(ACTIVE);
}

/**
 * Everything this module holds for the *vocabulary*, taken back: the
 * registration, the ranges, and the observer that would otherwise keep waking
 * up for a vocabulary that is empty. The recall mark is deliberately not in
 * this list - `paint` starts by calling this, and a repaint under an open
 * bubble may not blink the mark away; the mark answers to the bubble's own
 * lifecycle (`mark`/`unmark`).
 */
export function clear() {
  observer?.disconnect();
  observer = null;
  pending.clear();
  painted = [];
  live = null;
  scope = null;
  index = new Map();
  // Every weight, not just the one in hand: the setting can have moved since
  // the last paint, and a registration left behind goes on underlining.
  for (const one of UNDERLINE_NAMES) unregister(one);
}

/**
 * Paints every saved phrase that occurs on the page, and starts following the
 * page if it changes.
 *
 * @param {Iterable<string>} keys normalized phrases
 * @param {{ root?: Element | null, observe?: boolean, weight?: import("../lib/underline.js").UnderlineWeight }} [where]
 *   where to paint, whether the page can change under it, and how heavy the
 *   line is drawn (D130 - the caller reads the setting, this module only
 *   picks the registration it names)
 * @returns {number} how many occurrences were painted
 */
export function paint(keys, where = {}) {
  const api = registry();
  const root = where.root ?? document.body;
  if (api === null || root === null) return 0;

  clear();
  name = underlineName(where.weight ?? DEFAULT_UNDERLINE);
  index = buildIndex(keys);
  if (index.size === 0) return 0;

  scope = root;
  painted = scan(root, index);
  live = new Highlight();
  for (const { range } of painted) live.add(range);
  api.set(name, live);

  // Not in the reader: that document is built here and changes only when this
  // module is asked to paint again, so an observer would be a listener waiting
  // for something that cannot happen.
  if (where.observe !== false) {
    observer = new MutationObserver(onMutations);
    observer.observe(root, { subtree: true, childList: true, characterData: true });
  }

  return painted.length;
}

/**
 * @param {MutationRecord[]} records
 */
function onMutations(records) {
  for (const record of records) {
    // Always the target's block, whether text was edited in place or children
    // came and went: the block is what now reads differently, and rescanning it
    // covers everything that happened inside it.
    const block = blockAround(record.target);
    if (block !== null) pending.add(block);
  }
  if (pending.size === 0 || scheduled) return;

  scheduled = true;
  // Idle rather than immediate: a page loading its own content fires hundreds
  // of these, and none of them is more urgent than the article being readable.
  whenIdle(catchUp, IDLE_TIMEOUT);
}

/**
 * The blocks that are not inside another block in the same batch - rescanning a
 * parent already covers its children, and doing both would paint them twice.
 *
 * @param {Element[]} blocks
 * @returns {Element[]}
 */
function outermost(blocks) {
  return blocks.filter((block) => !blocks.some((other) => other !== block && other.contains(block)));
}

function catchUp() {
  scheduled = false;
  const api = registry();
  if (api === null || live === null || scope === null) return;

  const changed = [...pending].filter((block) => block.isConnected);
  pending.clear();
  const areas = changed.length > RESCAN_EVERYTHING ? [scope] : outermost(changed);
  if (areas.length === 0) return;

  /** @type {Painted[]} */
  const kept = [];
  for (const entry of painted) {
    const container = entry.range.startContainer;
    const stale = !container.isConnected || areas.some((area) => area.contains(container));
    if (stale) live.delete(entry.range);
    else kept.push(entry);
  }
  painted = kept;

  for (const area of areas) {
    for (const entry of scan(area, index)) {
      live.add(entry.range);
      painted.push(entry);
    }
  }
}

/**
 * Which saved phrase, if any, is under a point in the viewport.
 *
 * The range rides along for one reader: the sentence around the phrase is read
 * off it when the bubble's More goes to translate it. It is the live painted
 * range, so the caller looks and does not keep it.
 *
 * @param {number} x
 * @param {number} y
 * @returns {{ normalized: string, text: string, rect: DOMRect, range: Range } | null}
 */
export function phraseAt(x, y) {
  for (const { range, normalized } of painted) {
    for (const rect of range.getClientRects()) {
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      // The rectangle of the line that was clicked, not of the whole match: a
      // phrase wrapped across two lines would otherwise anchor its bubble to a
      // box spanning both.
      return { normalized, text: range.toString(), rect, range };
    }
  }
  return null;
}

/**
 * The text every painted range matched, one entry per occurrence, in
 * document order - what the reader page tallies when a text is finished
 * (D209, `lib/counting.js`). Under D208 an entry may be a form rather than
 * the saved word; the caller knows the aliases, this module only paints.
 *
 * @returns {string[]}
 */
export function occurrences() {
  return painted.map((one) => one.normalized);
}
