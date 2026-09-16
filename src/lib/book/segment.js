/**
 * Cutting a book into segments - the shape it is stored in and read in. Pure
 * arithmetic over block sizes: what a block *is* (our rebuilt markup) never
 * enters the rules, so they run whole under `node --test`.
 *
 * Segmentation happens once, at import, and never again (the brief's D1):
 * the segment boundaries are what reading positions anchor to, so re-cutting
 * an imported book would move the ground under every anchor. Which is also
 * why the budget is a constant and not a setting - changing it may only ever
 * affect the next import.
 *
 * The packer is a stream: blocks go in as the spine is walked, finished
 * segments come out to be written at once. It holds in memory only the
 * segment being filled and one finished segment behind it - kept back so
 * that the end of the book, if it turns out short, can be folded into its
 * neighbour instead of standing as a stub.
 */

/**
 * Characters of text per segment - roughly ten to fifteen minutes of
 * reading, the scale of a long article, which is the scale the matcher,
 * read-aloud and the reading view are already proven at. To be tuned on
 * real hardware before the first release with books (O21); the tuning can
 * never invalidate an existing book, because nothing is ever re-cut.
 */
export const SEGMENT_CHAR_BUDGET = 20000;

/**
 * The version of the cut (D218), written on every book's row at import
 * (`BookMeta.cut`) and carried in the backup with the book. Everything a
 * highlight's or a position's anchor stands on is a function of the cut:
 * the budget and the two thresholds here, the weight a picture adds
 * (`packedChars`), and what the block builder lets through (`buildArticle`,
 * `packableBlocks`, the pictures kept or dropped) - so a change to any of
 * them is a new version, bumped here by hand. The test in
 * `test/segment.test.js` pins the cut of one fixture to this number: a
 * change that moves a boundary turns it red until the number moves too.
 * A row without the field is a book cut before the field existed - the
 * cut of 1, from before D183 gave pictures a weight.
 */
export const BOOK_CUT_VERSION = 2;

/**
 * A heading arriving this far into the budget starts the next segment - a
 * chapter break close to the natural cut is a better cut than a fuller
 * segment. Below this line the heading just joins the flow.
 */
const HEADING_CUT_FROM = 0.75;

/**
 * The line below which a segment is a stub nobody should be handed: a final
 * segment shorter than this fraction folds into its neighbour, and an open
 * segment still under it will not close just because an oversized block
 * arrives.
 */
const TAIL_MERGE_BELOW = 0.25;

/** The headings a cut prefers to land before. */
export function isHeadingTag(/** @type {string} */ name) {
  return name === "h1" || name === "h2" || name === "h3";
}

/**
 * @template T
 * @typedef {{ chars: number, heading: boolean, payload: T }} PackedBlock
 */

/**
 * @template T
 * @typedef {{ blocks: T[], charCount: number }} Segment
 */

/**
 * @template T
 * @param {number} [budget]
 * @returns {{
 *   push: (block: PackedBlock<T>) => Array<Segment<T>>,
 *   finish: () => Array<Segment<T>>,
 * }}
 */
export function segmenter(budget = SEGMENT_CHAR_BUDGET) {
  /** @type {Array<PackedBlock<T>>} the segment being filled */
  let open = [];
  let openChars = 0;
  /** @type {Segment<T> | null} the last finished segment, held back one step */
  let held = null;

  /** @param {Array<PackedBlock<T>>} blocks */
  const asSegment = (blocks) => ({
    blocks: blocks.map((block) => block.payload),
    charCount: blocks.reduce((sum, block) => sum + block.chars, 0),
  });

  /**
   * Closes the open segment if there is one to close. A segment never ends
   * on a heading - a title with nothing under it - so trailing headings
   * stay behind, opening the next segment instead. An open list that is
   * *all* headings therefore cannot close at all, and keeps collecting.
   *
   * @param {Array<Segment<T>>} emitted where the previously held segment goes
   */
  const tryClose = (emitted) => {
    let end = open.length;
    while (end > 0 && open[end - 1]?.heading === true) end -= 1;
    if (end === 0) return;

    const closing = open.slice(0, end);
    const carried = open.slice(end);
    if (held !== null) emitted.push(held);
    held = asSegment(closing);
    open = carried;
    openChars = carried.reduce((sum, block) => sum + block.chars, 0);
  };

  return {
    /**
     * @param {PackedBlock<T>} block
     * @returns {Array<Segment<T>>} segments finished by this block, oldest first
     */
    push(block) {
      /** @type {Array<Segment<T>>} */
      const emitted = [];
      if (block.heading && openChars >= budget * HEADING_CUT_FROM) {
        tryClose(emitted);
      } else if (openChars >= budget * TAIL_MERGE_BELOW && openChars + block.chars > budget) {
        // The lower bound keeps a barely-started segment from being stranded
        // by an oversized incoming block: a part-divider page followed by a
        // chapter-sized block would otherwise stand alone as a segment of
        // almost nothing. Under the bound the stub rides along with the big
        // block instead - over budget, the same trade the tail merge makes.
        tryClose(emitted);
      }
      open.push(block);
      openChars += block.chars;
      // A block bigger than the whole budget stands as its own segment (with
      // the heading it may have carried in) - cutting inside a paragraph is
      // the one cut this module never makes.
      if (block.chars > budget) tryClose(emitted);
      return emitted;
    },

    /**
     * The end of the spine: closes what is open and lets the tail go. Here,
     * and only here, a segment may end on a heading - there is nothing after
     * the end of a book for the heading to belong to.
     *
     * @returns {Array<Segment<T>>} the remaining segments, oldest first
     */
    finish() {
      /** @type {Array<Segment<T>>} */
      const emitted = [];
      const tail = open.length > 0 ? asSegment(open) : null;
      open = [];
      openChars = 0;

      if (tail === null) {
        if (held !== null) emitted.push(held);
      } else if (held !== null && tail.charCount < budget * TAIL_MERGE_BELOW) {
        emitted.push({
          blocks: [...held.blocks, ...tail.blocks],
          charCount: held.charCount + tail.charCount,
        });
      } else {
        if (held !== null) emitted.push(held);
        emitted.push(tail);
      }
      held = null;
      return emitted;
    },
  };
}
