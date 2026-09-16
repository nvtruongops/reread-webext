/**
 * Reading the four files a StarDict dictionary is made of.
 *
 * The format is from 2003 and it shows: three binary files with no headers, no
 * checksums and no length field that can be trusted, plus one text file that
 * describes them. This module takes bytes and answers with words and their
 * fields; it knows nothing about markup, about the database, or about the
 * browser, which is what lets `node --test` drive all of it.
 *
 * Two rules run through everything here:
 *
 * 1. **The numbers in the .ifo are somebody's claim, not a fact.** `wordcount`
 *    and `idxfilesize` are written by whatever tool built the dictionary, and a
 *    file whose count is off by one is still a perfectly good dictionary. So
 *    nothing is driven by them: the index is walked to its end and the entries
 *    are counted here. The one field that must be believed is `idxoffsetbits`,
 *    because it decides how the bytes are read at all.
 * 2. **One broken entry is not a broken dictionary.** An offset past the end of
 *    the .dict file loses that word and nothing else. Refusing a whole
 *    dictionary over a handful of bad rows would mean a reader who cannot look
 *    anything up because of a word they will never select - so bad entries are
 *    counted, reported, and skipped.
 *
 * The index and the synonym file are walked, not loaded: each is a generator
 * yielding one record at a time, so a dictionary of a million words costs the
 * memory of one word while it is being read. The records come out in file
 * order with nothing left out - a `.syn` file points at its targets by their
 * position in the index, empty records included, so a reader that dropped one
 * would shift every synonym after it onto the wrong word.
 */

/** What the format allows a word to be, and a length that says the file is not what it claims. */
const MAX_WORD_BYTES = 255;

const MAGIC = "StarDict's dict ifo file";

/** Magic lines of the two dictionary kinds we do not read, so we can say which one arrived. */
const OTHER_MAGIC = Object.freeze({
  "StarDict's treedict ifo file": "a tree dictionary",
  "StarDict's storage ifo file": "a resource storage file",
});

const decoder = new TextDecoder("utf-8");

/**
 * @typedef {object} Ifo
 * @property {string} bookname what the dictionary calls itself
 * @property {string} version
 * @property {number} wordcount as claimed; informational
 * @property {32 | 64} offsetBits how wide the offsets in the .idx file are
 * @property {string} sametypesequence empty when each field carries its own type byte
 * @property {string | null} credit author, website and description, for attribution
 */

/**
 * @typedef {object} IdxEntry
 * @property {string} word empty in a record some tool left behind
 * @property {number} offset into the .dict file
 * @property {number} size
 */

/**
 * @typedef {object} Field
 * @property {string} type one character from the format's list
 * @property {string} text decoded UTF-8; binary fields never get here
 */

/**
 * @param {string} line
 * @returns {[string, string] | null}
 */
function keyValue(line) {
  const at = line.indexOf("=");
  if (at <= 0) return null;
  return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
}

/**
 * The .ifo file: one magic line, then `key=value`.
 *
 * Only the magic line can make this fail. Everything else has a defensible
 * default, and a dictionary that opens is worth more than a dictionary refused
 * over a field nobody reads.
 *
 * @param {string} text
 * @param {string} [fallbackName] used when the file does not name itself
 * @returns {{ ok: true, value: Ifo } | { ok: false, problem: "not_stardict", detail?: string }}
 */
export function parseIfo(text, fallbackName = "Dictionary") {
  const lines = text.split(/\r?\n/u);
  const magic = (lines[0] ?? "").trim();

  if (magic !== MAGIC) {
    const known = /** @type {Record<string, string>} */ (OTHER_MAGIC)[magic];
    return { ok: false, problem: "not_stardict", detail: known };
  }

  /** @type {Map<string, string>} */
  const fields = new Map();
  for (const line of lines.slice(1)) {
    const pair = keyValue(line);
    if (pair !== null) fields.set(pair[0], pair[1]);
  }

  const bookname = fields.get("bookname")?.trim() ?? "";
  const credit = [fields.get("author"), fields.get("website"), fields.get("description")]
    .map((part) => part?.trim() ?? "")
    .filter((part) => part.length > 0)
    .join(" - ");

  return {
    ok: true,
    value: {
      bookname: bookname.length > 0 ? bookname : fallbackName,
      version: fields.get("version") ?? "",
      wordcount: Number.parseInt(fields.get("wordcount") ?? "", 10) || 0,
      // 64-bit offsets exist only in 3.0.0, and 32 is the default everywhere
      // else. Getting this wrong turns every offset into nonsense, so it is the
      // one declared field that has to be believed.
      offsetBits: fields.get("idxoffsetbits")?.trim() === "64" ? 64 : 32,
      sametypesequence: fields.get("sametypesequence")?.trim() ?? "",
      credit: credit.length > 0 ? credit : null,
    },
  };
}

/**
 * @param {Uint8Array} bytes
 * @param {number} from
 * @returns {number} index of the next zero byte, or -1
 */
function zeroAt(bytes, from) {
  for (let at = from; at < bytes.length; at += 1) {
    if (bytes[at] === 0) return at;
  }
  return -1;
}

/**
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {Uint8Array}
 */
function bytesOf(data) {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * The .idx file: `word\0`, then the offset and size of that word's data.
 *
 * Walked to the end rather than to `wordcount`, and a truncated tail ends the
 * walk instead of throwing: whatever was whole is still a dictionary. Every
 * record is yielded, the empty ones too - the synonym file counts positions,
 * and a position has to mean the same thing here as there. Whether a record
 * is a word is the caller's question (`isWord`).
 *
 * @param {ArrayBuffer | Uint8Array} data
 * @param {32 | 64} offsetBits
 * @returns {Generator<IdxEntry, void, undefined>}
 */
export function* idxEntries(data, offsetBits) {
  const bytes = bytesOf(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offsetSize = offsetBits === 64 ? 8 : 4;
  let at = 0;

  while (at < bytes.length) {
    const end = zeroAt(bytes, at);
    if (end < 0) return;
    // A word longer than the format allows means the offset width is wrong, or
    // this is not an index at all. Either way the rest is not readable.
    if (end - at > MAX_WORD_BYTES) return;
    if (end + 1 + offsetSize + 4 > bytes.length) return;

    const word = decoder.decode(bytes.subarray(at, end));
    const numbers = end + 1;
    const offset =
      offsetBits === 64
        ? Number(view.getBigUint64(numbers, false))
        : view.getUint32(numbers, false);
    const size = view.getUint32(numbers + offsetSize, false);

    yield { word, offset, size };
    at = numbers + offsetSize + 4;
  }
}

/**
 * Whether an index record names a word at all.
 *
 * The empty string is not a word, and some tools leave one behind - whole
 * runs of them, even: an index padded with zeros to twice its length reads as
 * hundreds of thousands of empty records after the last real one. A word with
 * no data is not a word either.
 *
 * @param {IdxEntry} entry
 * @returns {boolean}
 */
export function isWord(entry) {
  return entry.word.length > 0 && entry.size > 0;
}

/**
 * The .syn file: `synonym\0`, then which record of the .idx file it means.
 *
 * This is where inflected forms live - `went` pointing at `go` - which is the
 * dictionary's own answer to a problem our matching deliberately does not
 * solve. Optional, and absent more often than not.
 *
 * @param {ArrayBuffer | Uint8Array} data
 * @returns {Generator<{ word: string, target: number }, void, undefined>}
 */
export function* synEntries(data) {
  const bytes = bytesOf(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;

  while (at < bytes.length) {
    const end = zeroAt(bytes, at);
    if (end < 0 || end - at > MAX_WORD_BYTES || end + 5 > bytes.length) return;

    const word = decoder.decode(bytes.subarray(at, end));
    if (word.length > 0) yield { word, target: view.getUint32(end + 1, false) };
    at = end + 5;
  }
}

/**
 * One word's data, split into its fields.
 *
 * Two layouts, and both are in the wild: with `sametypesequence` the types are
 * known in advance and only the last field of each word drops its terminator,
 * without it every field starts with its own type byte. Uppercase types are
 * sounds and pictures - their length is a number in front of them, and this
 * function steps over them rather than decoding them.
 *
 * Reading past the end of the entry is not possible here: everything is bounded
 * by `size`, and a field that claims more than is left is cut to what is left.
 * That forgiveness is on purpose - writers that omit the final terminator are
 * common enough that refusing them would refuse working dictionaries.
 *
 * @param {ArrayBuffer | Uint8Array} data the whole .dict file
 * @param {IdxEntry} entry
 * @param {string} sametypesequence from the .ifo, or empty
 * @returns {Field[] | null} null when the entry points outside the file
 */
export function readFields(data, entry, sametypesequence) {
  const bytes = bytesOf(data);
  const start = entry.offset;
  const end = start + entry.size;
  if (start < 0 || end > bytes.length) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  /** @type {Field[]} */
  const fields = [];
  let at = start;

  /**
   * @param {string} type
   * @param {boolean} last
   */
  const readOne = (type, last) => {
    const upper = type >= "A" && type <= "Z";

    if (upper) {
      // Size-prefixed binary, except as the last field of a word under
      // sametypesequence, where the size is implied by what is left.
      if (last) return end;
      if (at + 4 > end) return end;
      const size = view.getUint32(at, false);
      return Math.min(end, at + 4 + size);
    }

    const stop = last ? -1 : zeroAt(bytes, at);
    const text = decoder.decode(bytes.subarray(at, stop < 0 || stop > end ? end : stop));
    fields.push({ type, text });
    return stop < 0 || stop > end ? end : stop + 1;
  };

  if (sametypesequence.length > 0) {
    for (let index = 0; index < sametypesequence.length; index += 1) {
      if (at >= end) break;
      const last = index === sametypesequence.length - 1;
      at = readOne(sametypesequence[index] ?? "m", last);
    }
    return fields;
  }

  while (at < end) {
    const type = String.fromCharCode(bytes[at] ?? 0);
    at += 1;
    at = readOne(type, false);
  }

  return fields;
}
