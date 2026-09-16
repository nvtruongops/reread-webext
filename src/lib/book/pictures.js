/**
 * The rules of a book's pictures (D183), with no DOM, no archive and no
 * database in sight - the same split as `notes.js` and `toc.js`, so that
 * every decision here runs under `node --test`. What of a book's markup is
 * a picture, and how much of a segment's budget one takes; the reading of
 * the archive, the decoding and the writing live on the reader page
 * (`src/reader/book-pictures.js`) and only follow these answers.
 *
 * A book's pictures are the one kind this extension never fetches: they
 * sit in the file the book was imported from, beside its chapters, and
 * leave it only into the database - no address, no server, no request.
 * What a picture may be once it is out of the archive is decided by the
 * same rules an article's pictures follow (`lib/reader/pictures.js`): the
 * same sizes, the same kinds, the same one hard limit.
 */

/**
 * What a picture weighs in the packer's budget, in characters of text
 * (`segment.js`). A picture is a screen the reader looks at, about what a
 * long paragraph or two takes to read; counted as nothing, a book of plates
 * would pack every plate into one segment, and a segment is what stands in
 * the DOM at once.
 */
export const PICTURE_CHARS = 2000;

/**
 * The weight a block hands the packer: its text, and its pictures at
 * `PICTURE_CHARS` each. What is stored as the segment's `charCount` is this
 * sum too - the count was never read by anything but the packer, and now
 * it says what the segment costs to read rather than what it costs to
 * type.
 *
 * @param {number} textLength
 * @param {number} pictureCount
 * @returns {number}
 */
export function packedChars(textLength, pictureCount) {
  return textLength + pictureCount * PICTURE_CHARS;
}

/**
 * The least an element has to be to be walked here - the four properties
 * `opf.js` reads, which a DOM `Element` has as-is.
 *
 * @typedef {import("./opf.js").XmlEl} XmlEl
 */

/**
 * What an SVG may hold besides the one picture and still be a frame:
 * words about the picture, and the group the presses sometimes wrap it in.
 */
const FRAME_CHROME = new Set(["title", "desc", "metadata", "g"]);

/**
 * The address of the one raster picture an SVG is a frame around, or
 * nothing. The cover page of nearly every book from the big presses is
 * `<svg viewBox><image href="cover.jpg"/></svg>` - a picture wearing an
 * SVG so it scales to the screen - and the sanitizer drops `svg` whole,
 * for good reason (a script can live in one). A frame holding exactly one
 * `image` and nothing that draws is that picture and nothing else, so the
 * import turns it into an `<img>` before the rebuild sees it; any other
 * SVG stays dropped, as it always was.
 *
 * @param {XmlEl} svg
 * @returns {string | null}
 */
export function framedPictureHref(svg) {
  /** @type {XmlEl[]} */
  const images = [];
  /** @type {XmlEl[]} */
  const queue = [...svg.children];
  while (queue.length > 0) {
    const el = /** @type {XmlEl} */ (queue.shift());
    if (el.localName === "image") {
      images.push(el);
      continue;
    }
    if (!FRAME_CHROME.has(el.localName)) return null;
    queue.push(...el.children);
  }
  const image = images.length === 1 ? images[0] : undefined;
  if (image === undefined) return null;
  // EPUB 3 writes `href`; EPUB 2, and most of EPUB 3 in practice, the XLink
  // form - both spellings stand for the same address.
  const href = image.getAttribute("href") ?? image.getAttribute("xlink:href");
  return typeof href === "string" && href.trim().length > 0 ? href.trim() : null;
}
