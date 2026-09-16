/**
 * Bytes as text and back, for the one place that stores nothing but text:
 * `storage.local` keeps JSON in every browser this extension runs in, so a
 * picture copied there (D145) travels as base64. The chunking is the whole
 * reason this is not two one-liners: `btoa` wants a string of Latin-1
 * characters, and building one from a megabyte of bytes with a single
 * `String.fromCharCode(...bytes)` spreads a million arguments onto the
 * stack - which is where a large picture would throw.
 */

/** Bytes per `btoa` call - well under any argument-count limit. */
const CHUNK = 0x8000;

/**
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string}
 */
export function toBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  /** @type {string[]} */
  const pieces = [];
  for (let at = 0; at < view.length; at += CHUNK) {
    pieces.push(String.fromCharCode(...view.subarray(at, at + CHUNK)));
  }
  return btoa(pieces.join(""));
}

/**
 * The bytes a base64 text stands for, or nothing for text that is not
 * base64 - a hand-edited row, a truncated one. Nothing here throws: a
 * picture that will not decode is a picture that is not there.
 *
 * @param {unknown} text
 * @returns {Uint8Array | null}
 */
export function fromBase64(text) {
  if (typeof text !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) {
    return null;
  }
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
    return bytes;
  } catch {
    return null;
  }
}
