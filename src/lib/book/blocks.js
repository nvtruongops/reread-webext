/**
 * Which rebuilt elements a book hands the packer - the walk that dissolves
 * packaging so the cutting rules in `segment.js` get prose to work with.
 *
 * EPUB files as the big presses export them wrap every chapter's markup in a
 * single `<div>`. The sanitizer keeps `div` (a page may use one as a
 * paragraph), so without this walk a whole chapter arrives at the packer as
 * one indivisible block: the budget never cuts inside it, and a part-divider
 * page - three headings in their own wrapper - stands as a segment of nothing
 * but titles. Dissolving the wrapper is what lets the packer see the
 * headings and paragraphs that were always inside.
 *
 * A `div` is packaging when nothing in it is its own: no text of its own,
 * at least one element carrying the content. A `div` holding its own words
 * is somebody's paragraph and passes through whole - this walk never moves
 * or drops text, it only unwraps what held no text to begin with.
 */

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * True for a division that only packages other elements - nothing but
 * whitespace of its own between them.
 *
 * @param {Element} element
 * @returns {boolean}
 */
function isWrapper(element) {
  let holdsElement = false;
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === ELEMENT_NODE) {
      holdsElement = true;
      continue;
    }
    if (child.nodeType === TEXT_NODE && (child.nodeValue ?? "").trim().length > 0) {
      return false;
    }
  }
  return holdsElement;
}

/**
 * The blocks of a rebuilt chapter, in reading order, with wrapper `div`s
 * dissolved - recursively, because the presses also nest them. Whitespace
 * between the children of a dissolved wrapper is indentation, not prose,
 * and goes with the wrapper.
 *
 * @param {Element} root the rebuilt chapter, as `buildArticle` returned it
 * @returns {Generator<Element>}
 */
export function* packableBlocks(root) {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType !== ELEMENT_NODE) continue;
    const element = /** @type {Element} */ (child);
    if (element.localName === "div" && isWrapper(element)) {
      yield* packableBlocks(element);
    } else {
      yield element;
    }
  }
}
