/**
 * The rules of an article's pictures (D145), with no DOM, no network and no
 * database in sight - the same split as `marks.js` and `position.js`, so that
 * every decision here runs under `node --test`. Which addresses are asked
 * for, what a download may be, what of it is worth keeping, and in what
 * form; the fetching, decoding and drawing live on the reader page
 * (`src/reader/pictures.js`) and only follow these answers.
 *
 * Pictures are the one thing this extension fetches from an address it did
 * not ship with: the article's own servers, once, without cookies or
 * referrer, and only on the press of "Save pictures". Everything that
 * bounds what that press can cost is a number in this file.
 */

/**
 * The most one download may be. A response above it is not an illustration
 * of an article, and it would have to sit whole in memory before it could
 * be decoded - the one hard limit pictures have (B6): the count and the
 * total are the reader's to decide, and the reader is told both.
 */
export const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Below this on either side a picture is an icon, a spacer or a tracking
 * pixel, not an illustration - and not worth a row, or a request answered.
 */
export const MIN_PICTURE_SIDE = 50;

/**
 * The longest side a stored picture keeps. An e-ink screen is 1200 pixels
 * across at most, a tablet not much more; a photo wider than this is a
 * photo scaled down at display anyway, at several times the space.
 */
export const MAX_STORED_SIDE = 1600;

/**
 * An original that already fits `MAX_STORED_SIDE` is kept as it is up to
 * this size - no second encoding, no loss, and an animated GIF keeps its
 * animation. Above it the picture is drawn again at its own size.
 */
export const MAX_ORIGINAL_BYTES = 1024 * 1024;

/** Where a picture is drawn again as a JPEG, how much of it survives. */
export const JPEG_QUALITY = 0.82;

/**
 * The attribute the rebuilt article keeps a picture's address in. Not `src`:
 * the reader page's policy forbids every remote picture (`img-src`), so a
 * `src` naming the article's server would be a request the browser refuses
 * and a broken picture in the text. The address waits here, and `src` is
 * set only to a picture the database holds (`article.js`).
 */
export const SOURCE_ATTRIBUTE = "data-src";

/**
 * The picture types the database ever holds, by the bytes that open them.
 * What is stored has been through the reader page's own decoder and either
 * kept as it was (one of the first four) or drawn again as PNG or JPEG. An
 * SVG is decoded and drawn, never stored: a picture is pixels here.
 *
 * @typedef {"image/jpeg" | "image/png" | "image/gif" | "image/webp" | "image/svg+xml"} PictureType
 */

/**
 * A picture as the database holds it: the article it belongs to, its place
 * among that article's pictures, the address it came from (what the rebuilt
 * article matches it by), what it is, how large it is, and its bytes.
 *
 * @typedef {{
 *   url: string,
 *   index: number,
 *   src: string,
 *   mime: string,
 *   width: number,
 *   height: number,
 *   data: ArrayBuffer,
 * }} PictureRow
 */

/**
 * What the light row says about an article's pictures, so that the list and
 * the menu never read a byte of them.
 *
 * @typedef {{ count: number, bytes: number }} PicturesSummary
 */

/** The stored kinds, as `sniffPictureType` names them. */
const STORED_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

/**
 * Whether a type is one the database ever holds - what a file's entry has
 * to turn out to be, by its bytes, before it becomes a row (D218: a
 * book's pictures back from the backup ask this the way an article's do).
 *
 * @param {string | null} type as `sniffPictureType` names it
 * @returns {type is "image/jpeg" | "image/png" | "image/gif" | "image/webp"}
 */
export function isStoredPictureType(type) {
  return type !== null && STORED_TYPES.has(type);
}

const ELEMENT_NODE = 1;

/**
 * The addresses the rebuilt article asks pictures for, in reading order and
 * each once - the same address twice on a page is one picture, shown twice.
 * Read off the rebuilt tree, so only what survived the allowed list is ever
 * asked for: a tracking pixel in a dropped `<noscript>` is not.
 *
 * @param {Element} root
 * @returns {string[]}
 */
export function pictureSources(root) {
  /** @type {string[]} */
  const sources = [];
  const seen = new Set();
  /** @param {Node} node */
  const walk = (node) => {
    if (node.nodeType !== ELEMENT_NODE) return;
    const element = /** @type {Element} */ (node);
    if (element.tagName.toLowerCase() === "img") {
      const src = element.getAttribute(SOURCE_ATTRIBUTE);
      if (typeof src === "string" && src.length > 0 && !seen.has(src)) {
        seen.add(src);
        sources.push(src);
      }
      return;
    }
    for (const child of Array.from(element.childNodes)) walk(child);
  };
  walk(root);
  return sources;
}

/**
 * What a download is, by its first bytes - never by the header it came
 * with, which is the server's word. Nothing else is decoded at all.
 *
 * @param {Uint8Array} bytes the opening of the file, a dozen bytes is plenty
 * @returns {PictureType | null}
 */
export function sniffPictureType(bytes) {
  const at = (/** @type {number} */ index) => bytes[index];
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 6 && at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x38) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 &&
    at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50
  ) {
    return "image/webp";
  }
  // An SVG is text; what opens it is a tag, possibly after a prolog or a
  // byte-order mark (U+FEFF, written as a code so it can be seen), and the
  // tag is what says so.
  const head = new TextDecoder()
    .decode(bytes.subarray(0, 512))
    .replace(new RegExp("^\\uFEFF"), "")
    .trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i.test(head)) {
    return "image/svg+xml";
  }
  return null;
}

/**
 * Whether a decoded picture is an illustration rather than an icon, a
 * spacer or a pixel somebody counts with.
 *
 * @param {number} width
 * @param {number} height
 * @returns {boolean}
 */
export function isIllustration(width, height) {
  return width >= MIN_PICTURE_SIDE && height >= MIN_PICTURE_SIDE;
}

/**
 * The size a picture is stored at: its own where the longest side fits
 * the limit, otherwise scaled to it with the proportions kept - never a
 * pixel up.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} [limit]
 * @returns {{ width: number, height: number }}
 */
export function fitWithin(width, height, limit = MAX_STORED_SIDE) {
  const longest = Math.max(width, height);
  if (longest <= limit) return { width, height };
  const scale = limit / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Whether a download is stored as it came (B5): one of the kinds the
 * database keeps, no larger than the original limit, and no wider than a
 * stored picture may be. Everything else - a photo too large, an SVG - is
 * drawn again.
 *
 * @param {{ type: PictureType, byteLength: number, width: number, height: number }} original
 * @returns {boolean}
 */
export function keepsOriginal({ type, byteLength, width, height }) {
  return (
    STORED_TYPES.has(type) &&
    byteLength <= MAX_ORIGINAL_BYTES &&
    Math.max(width, height) <= MAX_STORED_SIDE
  );
}

/**
 * What a picture drawn again is written as: PNG where the source could
 * carry transparency or was line art (PNG, GIF, SVG), JPEG for the rest -
 * a photograph as a PNG would be larger than the original it replaces.
 *
 * @param {PictureType} type the source's kind
 * @returns {"image/png" | "image/jpeg"}
 */
export function encodedType(type) {
  return type === "image/png" || type === "image/gif" || type === "image/svg+xml"
    ? "image/png"
    : "image/jpeg";
}

/**
 * The light row's account of an article's pictures, from their rows.
 *
 * @param {Pick<PictureRow, "data">[]} rows
 * @returns {PicturesSummary}
 */
export function picturesSummary(rows) {
  return { count: rows.length, bytes: rows.reduce((sum, row) => sum + row.data.byteLength, 0) };
}

/**
 * A picture row as it came back from the database, narrowed field by
 * field, or nothing: a row that will not read is a picture that is not
 * there, never an error the reader has to see.
 *
 * @param {unknown} value
 * @returns {PictureRow | null}
 */
export function asPictureRow(value) {
  if (typeof value !== "object" || value === null) return null;
  const { url, index, src, mime, width, height, data } = /** @type {Record<string, unknown>} */ (value);
  if (typeof url !== "string" || url.length === 0) return null;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0) return null;
  if (typeof src !== "string" || src.length === 0) return null;
  if (typeof mime !== "string" || !STORED_TYPES.has(mime)) return null;
  if (!isSide(width) || !isSide(height)) return null;
  if (!(data instanceof ArrayBuffer) || data.byteLength === 0) return null;
  return { url, index, src, mime, width, height, data };
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isSide(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/**
 * The summary as a light row may carry it, or nothing - a row from before
 * pictures has no field, and a field that will not read is no pictures.
 *
 * @param {unknown} value
 * @returns {PicturesSummary | null}
 */
export function asPicturesSummary(value) {
  if (typeof value !== "object" || value === null) return null;
  const { count, bytes } = /** @type {Record<string, unknown>} */ (value);
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) return null;
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return null;
  return { count, bytes };
}
