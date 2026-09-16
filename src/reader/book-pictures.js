/**
 * A book's pictures out of its archive and into the database, on the
 * reader page, as the import walks the chapters (D183). The rules are
 * `lib/book/pictures.js`'s (what is a picture, what it weighs) and
 * `lib/reader/pictures.js`'s (what of a file is worth keeping, in what
 * form); this file is the part that needs the archive, a decoder and the
 * database, and it makes no decision of its own.
 *
 * The shape of the work is the import's: one picture at a time, written
 * the moment it is ready, never all of a book's in memory. Each entry of
 * the archive is inflated once, however many chapters show it - a
 * publisher's ornament repeated at every scene break is one row, shown as
 * often as the text asks. What could not be kept (an entry the archive
 * does not hold, an icon, a file that will not decode) leaves the block
 * it stood in, so the stored text asks only for pictures the book has.
 */

import { MAX_DOWNLOAD_BYTES, SOURCE_ATTRIBUTE } from "../lib/reader/pictures.js";
import { putBookPicture } from "../lib/store/books.js";
import { keptPicture } from "./pictures.js";

/**
 * @typedef {import("../lib/reader/pictures.js").PicturesSummary} PicturesSummary
 */

/**
 * @typedef {object} PictureKeeper
 * @property {(block: Element) => Promise<number[]>} keep the pictures a
 *   rebuilt block shows, kept - each address once per book - and named by
 *   their rows' indexes, in the block's order; a picture that could not be
 *   kept is taken out of the block
 * @property {() => PicturesSummary | null} summary what the book's row
 *   says about its pictures at the end: how many and what they take, or
 *   null for none
 */

/**
 * The keeper of one import's pictures.
 *
 * @param {string} bookId the id the rows are written under
 * @param {(path: string) => Uint8Array | null} entry one entry of the archive by its
 *   path, or null for one it does not hold - or holds beyond the cap
 * @param {(kept: number, bytes: number) => void} onPicture told after every
 *   picture written: how many stand so far, and what they take
 * @returns {PictureKeeper}
 */
export function pictureKeeper(bookId, entry, onPicture) {
  /** @type {Map<string, number | null>} each address to its row's index, or null for one not kept */
  const seen = new Map();
  let count = 0;
  let bytes = 0;

  /**
   * @param {string} src
   * @returns {Promise<number | null>}
   */
  const keepOne = async (src) => {
    const held = seen.get(src);
    if (held !== undefined) return held;
    const data = entry(src);
    // The archive's bytes are the reader's own allocation over a plain
    // buffer; the decoder wants it said so.
    const row =
      data === null
        ? null
        : await keptPicture(bookId, count, src, /** @type {Uint8Array<ArrayBuffer>} */ (data));
    if (row === null) {
      seen.set(src, null);
      return null;
    }
    await putBookPicture(row);
    const index = count;
    count += 1;
    bytes += row.data.byteLength;
    seen.set(src, index);
    onPicture(count, bytes);
    return index;
  };

  return {
    async keep(block) {
      const images = block.localName === "img" ? [block] : Array.from(block.querySelectorAll("img"));
      /** @type {number[]} */
      const shown = [];
      for (const image of images) {
        const src = image.getAttribute(SOURCE_ATTRIBUTE);
        const index = src === null || src.length === 0 ? null : await keepOne(src);
        if (index === null) {
          // A block that is itself a picture nobody kept stays as it is; the
          // caller drops it as a block with nothing to read.
          if (image !== block) image.remove();
          continue;
        }
        if (!shown.includes(index)) shown.push(index);
      }
      return shown;
    },
    summary: () => (count > 0 ? { count, bytes } : null),
  };
}

/**
 * A reader of the archive's pictures by path, refusing an entry above the
 * one hard limit pictures have before inflating it - the directory says
 * the size, so a picture that would not fit costs nothing.
 *
 * @param {import("./zip.js").FflateModule["unzipSync"]} unzipSync
 * @param {Uint8Array} archive the whole file
 * @returns {(path: string) => Uint8Array | null}
 */
export function archivePictures(unzipSync, archive) {
  return (path) => {
    const out = unzipSync(archive, {
      filter: (info) => info.name === path && info.originalSize <= MAX_DOWNLOAD_BYTES,
    });
    return out[path] ?? null;
  };
}
