/**
 * Saving an article's pictures, on the reader page (D145): the fetching,
 * decoding and drawing that follow the rules in `lib/reader/pictures.js`,
 * where every number and every decision lives and is tested. This file is
 * the part that needs a browser - `fetch`, an `<img>` to decode with, a
 * canvas to draw on - and it makes no decision of its own. The decoding
 * and drawing serve a book's pictures too (`keptPicture`, D183): what
 * differs there is only where the bytes come from.
 *
 * The shape of the work is one picture at a time, written the moment it is
 * ready: an article of seventy pictures never has seventy in memory, and
 * the count needs no limit (B6). A save cut short - the reader left the
 * article, or pressed the row again - takes back everything it wrote, so
 * that "stopped" and "never started" leave the same article. What it could
 * not fetch (a server that wants a referrer, a picture that is gone) is
 * simply not among the pictures; the result says how many of how many.
 */

import {
  JPEG_QUALITY,
  MAX_DOWNLOAD_BYTES,
  encodedType,
  fitWithin,
  isIllustration,
  keepsOriginal,
  sniffPictureType,
} from "../lib/reader/pictures.js";
import { deletePictures, putPicture, setPictures } from "../lib/store/articles.js";

/**
 * @typedef {import("../lib/reader/pictures.js").PictureRow} PictureRow
 * @typedef {import("../lib/reader/pictures.js").PictureType} PictureType
 */

/**
 * Where a save stands, told after every address is settled - fetched and
 * kept, or fetched and let go.
 *
 * @typedef {{ done: number, of: number, bytes: number }} PicturesProgress
 */

/**
 * How a save ended: how many pictures the article has now, out of how many
 * it asked for, and what they take. `aborted` is the reader's own stop,
 * after which the article has none.
 *
 * @typedef {{ saved: number, of: number, bytes: number, aborted: boolean }} PicturesResult
 */

/** How much of a download the type is read from - an SVG's opening tag may sit behind a prolog. */
const SNIFF_BYTES = 512;

/**
 * The article's pictures fetched, decided on and written, in reading order.
 * Throws only for a database that will not take a row; the caller then
 * finds the article as it was, because the rows written before are taken
 * back first.
 *
 * @param {string} url the article's address, the key of its rows
 * @param {string[]} sources the addresses the rebuilt article asks for (`pictureSources`)
 * @param {{ signal: AbortSignal, onProgress: (progress: PicturesProgress) => void }} options
 * @returns {Promise<PicturesResult>}
 */
export async function savePictures(url, sources, { signal, onProgress }) {
  let index = 0;
  let bytes = 0;
  try {
    // Whatever a save cut short by a closed tab left behind goes first: the
    // rows are written one by one, and a tab can close between two.
    await deletePictures(url);
    for (const [at, src] of sources.entries()) {
      if (signal.aborted) break;
      const row = await fetchPicture(url, index, src, signal);
      if (signal.aborted) break;
      if (row !== null) {
        await putPicture(row);
        index += 1;
        bytes += row.data.byteLength;
      }
      onProgress({ done: at + 1, of: sources.length, bytes });
    }
  } catch (error) {
    await deletePictures(url).catch(() => undefined);
    throw error;
  }
  if (signal.aborted) {
    await deletePictures(url);
    return { saved: 0, of: sources.length, bytes: 0, aborted: true };
  }
  if (index > 0) await setPictures(url, { count: index, bytes });
  return { saved: index, of: sources.length, bytes, aborted: false };
}

/**
 * One address to one row, or nothing - for any reason at all: a refusal, a
 * download that is not a picture, one too small or too large, one that will
 * not decode. Nothing here is an error the reader has to see; the picture
 * is simply not there.
 *
 * The request carries nothing of the reader's: no cookies, no referrer.
 * That is what makes it a request the article's server has already
 * answered once, for the page, rather than a new fact about anybody.
 *
 * @param {string} url
 * @param {number} index
 * @param {string} src
 * @param {AbortSignal} signal
 * @returns {Promise<PictureRow | null>}
 */
async function fetchPicture(url, index, src, signal) {
  try {
    const response = await fetch(src, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "follow",
      signal,
    });
    if (!response.ok || response.body === null) return null;
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > MAX_DOWNLOAD_BYTES) return null;
    const bytes = await readCapped(response.body, MAX_DOWNLOAD_BYTES);
    if (bytes === null) return null;
    return await keptPicture(url, index, src, bytes);
  } catch {
    return null;
  }
}

/**
 * The bytes of a picture - a download's, or an entry's of a book's archive
 * (D183) - decided on and made into a row, or nothing: not a picture by
 * its first bytes, one too small, one that will not decode. The rules are
 * `lib/reader/pictures.js`'s, the same for every source; this is the part
 * that needs a decoder and a canvas. Never throws: nothing here is an
 * error anybody has to see, the picture is simply not there.
 *
 * @param {string} url the document the row belongs to - an article's address, a book's id
 * @param {number} index the row's place among the document's pictures
 * @param {string} src the address the document's text asks for it by
 * @param {Uint8Array<ArrayBuffer>} bytes the whole file, within `MAX_DOWNLOAD_BYTES`
 * @returns {Promise<PictureRow | null>}
 */
export async function keptPicture(url, index, src, bytes) {
  try {
    const type = sniffPictureType(bytes.subarray(0, SNIFF_BYTES));
    if (type === null) return null;

    const decoded = await decode(bytes, type);
    if (decoded === null) return null;
    try {
      const { width, height } = decoded;
      if (!isIllustration(width, height)) return null;
      if (keepsOriginal({ type, byteLength: bytes.byteLength, width, height })) {
        return { url, index, src, mime: type, width, height, data: exactBuffer(bytes) };
      }
      const fitted = fitWithin(width, height);
      const drawn = await draw(decoded.image, fitted, encodedType(type));
      if (drawn === null) return null;
      return {
        url,
        index,
        src,
        mime: drawn.type,
        width: fitted.width,
        height: fitted.height,
        data: await drawn.arrayBuffer(),
      };
    } finally {
      decoded.release();
    }
  } catch {
    return null;
  }
}

/**
 * A body read whole, up to the cap - past it the read is cancelled and the
 * answer is nothing, so a picture that lied about its size costs the cap
 * and not the memory.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {number} cap
 * @returns {Promise<Uint8Array<ArrayBuffer> | null>}
 */
async function readCapped(body, cap) {
  const reader = body.getReader();
  /** @type {Uint8Array[]} */
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const whole = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return whole;
}

/**
 * The bytes as their own buffer - the database stores the buffer, and a
 * view's buffer may be wider than the view.
 *
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {ArrayBuffer}
 */
function exactBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * The download decoded by the browser's own decoder, through an `<img>`
 * over a `blob:` address of this page's making - the one road every kind
 * takes, SVG included (`createImageBitmap` does not decode an SVG blob in
 * Firefox). A picture that reports no size (an SVG without one) is let go:
 * drawing it would mean guessing its shape.
 *
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @param {PictureType} type
 * @returns {Promise<{ image: HTMLImageElement, width: number, height: number, release: () => void } | null>}
 */
async function decode(bytes, type) {
  const objectUrl = URL.createObjectURL(new Blob([bytes], { type }));
  const image = new Image();
  try {
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
  } catch {
    URL.revokeObjectURL(objectUrl);
    return null;
  }
  const { naturalWidth: width, naturalHeight: height } = image;
  if (width === 0 || height === 0) {
    URL.revokeObjectURL(objectUrl);
    return null;
  }
  return { image, width, height, release: () => URL.revokeObjectURL(objectUrl) };
}

/**
 * The picture drawn again at the size it is stored at. A JPEG has no
 * transparency, so what was transparent is painted white first - the
 * colour of the page it came from, near enough.
 *
 * @param {HTMLImageElement} image
 * @param {{ width: number, height: number }} size
 * @param {"image/png" | "image/jpeg"} type
 * @returns {Promise<Blob | null>}
 */
function draw(image, size, type) {
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (context === null) return Promise.resolve(null);
  if (type === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => resolve(blob !== null && blob.size > 0 ? blob : null),
      type,
      type === "image/jpeg" ? JPEG_QUALITY : undefined,
    );
  });
}
