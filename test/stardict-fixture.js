/**
 * Building StarDict files byte by byte, so the parser can be tested against the
 * format rather than against one dictionary somebody downloaded.
 *
 * No dictionary is vendored into this repository for this. A real file would be
 * one publisher's habits frozen into the test suite - and the cases worth
 * testing are precisely the ones no real file has: a truncated index, an entry
 * pointing past the end, a type byte for a picture in the middle of the text.
 */

const encoder = new TextEncoder();

/**
 * @param {(Uint8Array | number[])[]} parts
 * @returns {Uint8Array}
 */
export function concat(parts) {
  const flat = parts.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)));
  const total = flat.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of flat) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * @param {string} text
 * @returns {Uint8Array} UTF-8, null-terminated, as every string in this format is
 */
export function cstring(text) {
  return concat([encoder.encode(text), [0]]);
}

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
export function utf8(text) {
  return encoder.encode(text);
}

/**
 * @param {number} value
 * @returns {Uint8Array} network byte order, as the format says everywhere
 */
export function u32(value) {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value, false);
  return out;
}

/**
 * @param {number} value
 * @returns {Uint8Array}
 */
export function u64(value) {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), false);
  return out;
}

/**
 * @param {Record<string, string | number>} fields
 * @returns {string}
 */
export function ifo(fields) {
  const lines = Object.entries(fields).map(([key, value]) => `${key}=${value}`);
  return ["StarDict's dict ifo file", ...lines, ""].join("\n");
}

/**
 * An index and the body it points into, built together so the offsets are right.
 *
 * @param {{ word: string, data: Uint8Array }[]} entries
 * @param {{ offsetBits?: 32 | 64 }} [options]
 * @returns {{ idx: Uint8Array, dict: Uint8Array }}
 */
export function index(entries, { offsetBits = 32 } = {}) {
  /** @type {Uint8Array[]} */
  const idxParts = [];
  /** @type {Uint8Array[]} */
  const dictParts = [];
  let offset = 0;

  for (const entry of entries) {
    idxParts.push(cstring(entry.word));
    idxParts.push(offsetBits === 64 ? u64(offset) : u32(offset));
    idxParts.push(u32(entry.data.length));
    dictParts.push(entry.data);
    offset += entry.data.length;
  }

  return { idx: concat(idxParts), dict: concat(dictParts) };
}

/**
 * @param {{ word: string, target: number }[]} synonyms
 * @returns {Uint8Array}
 */
export function syn(synonyms) {
  return concat(synonyms.flatMap((one) => [cstring(one.word), u32(one.target)]));
}

/**
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>} the same bytes as a gzip file
 */
export async function gzip(bytes) {
  const stream = new Blob([bytes.slice().buffer]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
