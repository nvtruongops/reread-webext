/**
 * Taking the files somebody picked and answering with a dictionary.
 *
 * Once, at import, and never again: the .dict file is read from end to end
 * here, and what goes into the database is the result. Nothing reads a
 * dictionary file while somebody is reading a page - which is the whole reason
 * `.dict.dz` never has to be understood as dictzip. A dictzip file is a valid
 * gzip file with a random-access table in its header, and a reader that only
 * ever wants all of it can let the table go by.
 *
 * Archives arrive here already opened. The settings page downloads `.zip`
 * files - the catalogue's from WikDict, or one from an address the reader
 * pasted - and `zip.js` takes them apart; somebody adding files by hand
 * unpacks the archive themselves. Either way, what this module sees is a set
 * of named files - `dictionaryFromZip` below is the whole of the difference,
 * and the paths share every check after it.
 *
 * What the database gets is a stream, not a copy. `openDictionary` unpacks the
 * files and checks the one thing that can be checked up front; `entriesOf` and
 * `aliasesOf` then hand out one word at a time for `rows.js` to key and batch.
 * The alternative - parsing the whole book into an array of entries, then into
 * an array of rows, then writing the rows - held three copies of a dictionary
 * of 850,000 words at once, over a gigabyte, and on a tablet with three of
 * them Android killed the settings page halfway through. The unpacked .dict
 * file is the one thing kept whole, because the index points into it at
 * random; everything else lives for as long as one word takes to write.
 *
 * The sources may be files straight from a picker (a `Blob`, read from disk as
 * it is unpacked) or bytes already in memory (an archive member). The importer
 * takes them: each is struck from the object it arrived in as it is read, so
 * that the page which handed them over is not the one keeping a compressed
 * copy alive for the rest of the import.
 *
 * Nothing in this module touches the browser or the database, so `node --test`
 * drives every path through it, including the ones a smoke test could never
 * reach: a truncated index, an entry pointing past the end of the file, a
 * dictionary that turns out to be something else entirely.
 */

import { aside, t } from "../i18n.js";
import { isGzip } from "../models/files.js";
import { idxEntries, isWord, parseIfo, readFields, synEntries } from "./stardict.js";
import { LIMITS, about, senses } from "./text.js";

/**
 * @typedef {"empty" | "missing_ifo" | "missing_idx" | "missing_dict" | "mixed" | "not_stardict" | "unpack" | "no_entries"} ImportProblem
 */

/**
 * @typedef {object} DictionaryFileNames
 * @property {string} base the name all four files share
 * @property {string} ifo
 * @property {string} idx
 * @property {string} dict
 * @property {string} [syn]
 */

/**
 * One dictionary file, as it arrives: a file from a picker, or bytes already
 * unpacked from an archive. Compressed or not - that is read off the bytes.
 *
 * @typedef {Blob | ArrayBuffer | Uint8Array} FileSource
 */

/**
 * @typedef {object} DictionaryFiles
 * @property {FileSource} ifo
 * @property {FileSource} idx
 * @property {FileSource} dict
 * @property {FileSource} [syn]
 */

/**
 * A dictionary unpacked and ready to be walked.
 *
 * @typedef {object} OpenDictionary
 * @property {string} name
 * @property {string | null} credit
 * @property {Uint8Array} idx
 * @property {Uint8Array} dict
 * @property {Uint8Array | null} syn
 * @property {32 | 64} offsetBits
 * @property {string} sametypesequence
 * @property {number} words index records that name a word; what `entriesOf` will yield
 * @property {number} synonyms records in the synonym file; what `aliasesOf` will yield
 */

/**
 * @typedef {object} Entry
 * @property {number} position of the record in the index, counting every record - what a synonym points at
 * @property {string} headword as the dictionary spells it
 * @property {string[]} senses plain text; empty when the entry could not be read
 */

/**
 * @typedef {object} Alias
 * @property {string} headword another spelling, as the synonym file has it
 * @property {number} target the position of the entry it means
 */

/**
 * @typedef {{ ok: true, value: OpenDictionary } | { ok: false, problem: ImportProblem, detail?: string }} OpenResult
 */

/**
 * @param {string} name
 * @returns {string} without the compression suffix a StarDict file may carry
 */
function withoutCompression(name) {
  return name.replace(/\.(?:gz|dz)$/iu, "");
}

/**
 * Sorts the files of one dictionary out by their extension.
 *
 * Unknown files are ignored rather than refused. A StarDict folder holds more
 * than the four files that matter - offset caches, a resource folder, a readme -
 * and somebody who selects all of them has done nothing wrong.
 *
 * @param {string[]} names
 * @returns {{ ok: true, value: DictionaryFileNames } | { ok: false, problem: ImportProblem, detail?: string }}
 */
export function classifyDictionaryFiles(names) {
  if (names.length === 0) return { ok: false, problem: "empty" };

  /** @type {Map<string, Partial<Record<"ifo" | "idx" | "dict" | "syn", string>>>} */
  const byBase = new Map();

  for (const name of names) {
    const bare = withoutCompression(name);
    const match = /^(.*)\.(ifo|idx|dict|syn)$/iu.exec(bare);
    if (match === null) continue;

    const base = match[1] ?? "";
    const role = /** @type {"ifo" | "idx" | "dict" | "syn"} */ ((match[2] ?? "").toLowerCase());
    const found = byBase.get(base) ?? {};
    // First one wins, so a folder holding both `x.idx` and `x.idx.gz` picks one
    // instead of reading the same index twice.
    if (found[role] === undefined) found[role] = name;
    byBase.set(base, found);
  }

  if (byBase.size === 0) return { ok: false, problem: "missing_ifo" };
  if (byBase.size > 1) {
    return { ok: false, problem: "mixed", detail: [...byBase.keys()].sort().join(", ") };
  }

  const [base] = [...byBase.keys()];
  const files = byBase.get(/** @type {string} */ (base)) ?? {};

  if (files.ifo === undefined) return { ok: false, problem: "missing_ifo" };
  if (files.idx === undefined) return { ok: false, problem: "missing_idx" };
  if (files.dict === undefined) return { ok: false, problem: "missing_dict" };

  return {
    ok: true,
    value: {
      base: /** @type {string} */ (base),
      ifo: files.ifo,
      idx: files.idx,
      dict: files.dict,
      ...(files.syn === undefined ? {} : { syn: files.syn }),
    },
  };
}

/**
 * Whether a name inside an archive is one of the four kinds of file a
 * dictionary is made of - by its extension, compressed or not.
 *
 * Everything else an archive carries is left where it is, and with this as
 * its `wanted` the zip reader never even inflates it: the pictures a
 * Wiktionary build ships in `res/` by the hundred, offset caches, a readme -
 * and the resource forks and folder metadata a Mac zips in (`__MACOSX`, names
 * starting with a dot), which would otherwise read as a second dictionary and
 * fail the one-at-a-time rule for something nobody chose to put there. Real
 * files keep their full archive paths, so two dictionaries genuinely zipped
 * together still refuse cleanly.
 *
 * @param {string} name an archive path
 * @returns {boolean}
 */
export function isDictionaryFile(name) {
  const parts = name.split("/");
  const leaf = parts.pop() ?? "";
  if (leaf.length === 0 || leaf.startsWith(".") || parts.includes("__MACOSX")) return false;
  return /\.(?:ifo|idx|dict|syn)(?:\.(?:gz|dz))?$/iu.test(leaf);
}

/**
 * Sorts the files inside a downloaded archive into the roles of one
 * dictionary, and hands their bytes over.
 *
 * @param {import("./zip.js").ZipEntry[]} entries
 * @returns {{ ok: true, value: { base: string, files: DictionaryFiles } } | { ok: false, problem: ImportProblem, detail?: string }}
 */
export function dictionaryFromZip(entries) {
  const usable = entries.filter((entry) => isDictionaryFile(entry.name));

  const classified = classifyDictionaryFiles(usable.map((entry) => entry.name));
  if (!classified.ok) return classified;
  const { base, ifo, idx, dict, syn } = classified.value;

  /** @param {string} name */
  const bytesOf = (name) => /** @type {Uint8Array} */ (usable.find((entry) => entry.name === name)?.bytes);

  return {
    ok: true,
    value: {
      // The base may still carry the folder the archive wraps its files in;
      // the leaf is what a status line should call the dictionary.
      base: base.split("/").pop() || base,
      files: {
        ifo: bytesOf(ifo),
        idx: bytesOf(idx),
        dict: bytesOf(dict),
        ...(syn === undefined ? {} : { syn: bytesOf(syn) }),
      },
    },
  };
}

/**
 * Reads one source out of the set and strikes it from there.
 *
 * The set is the caller's object, and the caller's frame will keep it for the
 * whole import; a member left in it is a member that cannot be collected. So
 * the importer takes what it reads, and after `openDictionary` the object
 * holds nothing - which is the point, not a side effect.
 *
 * @param {DictionaryFiles} files
 * @param {"ifo" | "idx" | "dict" | "syn"} role
 * @returns {FileSource | undefined}
 */
function take(files, role) {
  const sources = /** @type {Partial<Record<"ifo" | "idx" | "dict" | "syn", FileSource>>} */ (files);
  const source = sources[role];
  delete sources[role];
  return source;
}

/**
 * @param {Uint8Array} bytes
 * @returns {ReadableStream<Uint8Array<ArrayBuffer>>} the bytes as one chunk, without copying them
 */
function streamOf(bytes) {
  return new ReadableStream({
    start(controller) {
      // Nothing here is ever backed by shared memory; the narrower type is
      // what the decompressor's writable side asks for.
      controller.enqueue(/** @type {Uint8Array<ArrayBuffer>} */ (bytes));
      controller.close();
    },
  });
}

/**
 * The most a dictionary file may unpack to (D171). The largest .dict seen is
 * a few hundred megabytes; this is room for several of those, and the
 * ceiling gzip's thousand-to-one packing would otherwise let a small file
 * reach - tens of gigabytes, and the settings page gone with them.
 */
export const MAX_UNPACKED_BYTES = 1024 * 1024 * 1024;

/**
 * Inflates a gzip stream into one buffer.
 *
 * The buffer is allocated once, at the size the gzip trailer claims, and the
 * chunks are written straight into it. Collecting them first and joining them
 * afterwards - what `Response.arrayBuffer()` does - means the whole file twice
 * over for a moment, and for a .dict file that moment is four hundred
 * megabytes. The trailer is the size modulo 2^32, so a buffer that turns out
 * too small grows - a file that large has not been seen, but the cost of being
 * wrong about that would be a thrown import, not a slow one.
 *
 * Past the cap the read stops and the import fails with a sentence (D171):
 * the trailer is what the file says about itself, and a file that unpacks to
 * far more than it claims - or to more than any dictionary is - is not a
 * dictionary. The cap holds the first allocation too, so a trailer claiming
 * four gigabytes costs a refusal, not the allocation.
 *
 * @param {ReadableStream<Uint8Array<ArrayBuffer>>} stream compressed bytes
 * @param {number} sizeHint what the trailer says the result is
 * @param {number} [limit] the most the result may be; the cap by default
 * @returns {Promise<Uint8Array>}
 */
export async function gunzip(stream, sizeHint, limit = MAX_UNPACKED_BYTES) {
  const reader = stream.pipeThrough(new DecompressionStream("gzip")).getReader();
  let out = new Uint8Array(Math.min(sizeHint, limit));
  let length = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.length > limit) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`unpacks to more than ${limit} bytes`);
    }
    if (length + value.length > out.length) {
      const grown = new Uint8Array(Math.min(limit, Math.max(out.length * 2, length + value.length)));
      grown.set(out.subarray(0, length));
      out = grown;
    }
    out.set(value, length);
    length += value.length;
  }

  return length === out.length ? out : out.subarray(0, length);
}

/**
 * @param {Uint8Array} tail the last bytes of a gzip file
 * @returns {number} the uncompressed size its trailer claims, or 0 when there is no trailer to read
 */
function claimedSize(tail) {
  if (tail.length < 4) return 0;
  return new DataView(tail.buffer, tail.byteOffset + tail.length - 4, 4).getUint32(0, true);
}

/**
 * A `.dict.dz` is a gzip file with a table in its header for reading pieces of
 * it without decompressing the rest. We want all of it, once, so the table goes
 * by as a header nobody reads and the browser's own gzip does the work.
 *
 * Compression is read off the first two bytes rather than the extension: `.dz`,
 * `.gz` and a plain `.dict` that happens to be compressed all arrive, and the
 * name is the one thing a person renaming files is free to change.
 *
 * A file from a picker is read as a stream, so the compressed bytes never sit
 * in memory as a whole - only the result does.
 *
 * @param {FileSource | undefined} source
 * @returns {Promise<Uint8Array>} empty when there was nothing to read
 */
async function unpack(source) {
  if (source === undefined) return new Uint8Array();

  if (source instanceof Blob) {
    const head = new Uint8Array(await source.slice(0, 2).arrayBuffer());
    if (!isGzip(head)) return new Uint8Array(await source.arrayBuffer());
    const tail = new Uint8Array(await source.slice(Math.max(0, source.size - 4)).arrayBuffer());
    return gunzip(source.stream(), claimedSize(tail));
  }

  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (!isGzip(bytes)) return bytes;
  return gunzip(streamOf(bytes), claimedSize(bytes));
}

/**
 * Unpacks a dictionary and checks what can be checked before a word is read.
 *
 * The .ifo goes first, because it is tiny and it is where a file that is not
 * a dictionary at all gives itself away - nobody should wait for two hundred
 * megabytes to inflate to be told that. The index is then counted, so an
 * empty one is refused here and a real one can say how far along it is.
 *
 * @param {DictionaryFiles} files consumed: see `take`
 * @param {object} [options]
 * @param {string} [options.fallbackName] when the .ifo does not name the dictionary
 * @returns {Promise<OpenResult>}
 */
export async function openDictionary(files, { fallbackName } = {}) {
  /** @type {(error: unknown) => OpenResult} */
  const unpackFailed = (error) => ({
    ok: false,
    problem: "unpack",
    detail: error instanceof Error ? error.message : String(error),
  });

  /** @type {Uint8Array} */
  let ifoBytes;
  try {
    ifoBytes = await unpack(take(files, "ifo"));
  } catch (error) {
    return unpackFailed(error);
  }

  const ifo = parseIfo(new TextDecoder("utf-8").decode(ifoBytes), fallbackName);
  if (!ifo.ok) return ifo;

  /** @type {Uint8Array} */
  let idx;
  /** @type {Uint8Array} */
  let dict;
  /** @type {Uint8Array | null} */
  let syn;
  try {
    idx = await unpack(take(files, "idx"));
    dict = await unpack(take(files, "dict"));
    const synSource = take(files, "syn");
    syn = synSource === undefined ? null : await unpack(synSource);
  } catch (error) {
    return unpackFailed(error);
  }

  const { offsetBits, sametypesequence } = ifo.value;

  let words = 0;
  for (const entry of idxEntries(idx, offsetBits)) {
    if (isWord(entry)) words += 1;
  }
  if (words === 0) return { ok: false, problem: "no_entries" };

  let synonyms = 0;
  if (syn !== null) {
    for (const _ of synEntries(syn)) synonyms += 1;
  }

  // The .ifo file describes the book in the same HTML its entries are written
  // in, so it gets the same treatment (D29): what a settings page prints must
  // be text by the time it is stored, not markup waiting to be dealt with.
  const name = about(ifo.value.bookname, LIMITS.name) ?? fallbackName ?? t("dict_default_name");

  return {
    ok: true,
    value: {
      name,
      credit: about(ifo.value.credit),
      idx,
      dict,
      syn,
      offsetBits,
      sametypesequence,
      words,
      synonyms,
    },
  };
}

/**
 * Every word of the dictionary, one at a time, in the order the index has them.
 *
 * An entry that cannot be read - an offset past the end of the file, a field
 * with nothing readable in it - comes out with no senses rather than not at
 * all, so that whoever counts the skipped ones can. Records that are not words
 * (see `isWord`) are stepped over, but they still count: `position` is the
 * record's place in the index, which is how a synonym names its target.
 *
 * Words before `readFrom` come out with their headword and nothing else: a
 * run picking up an interrupted import needs their keys to rebuild what it
 * kept between batches, and nothing from their data - reading it would be the
 * expensive half of the import done twice (see `rowBatches`).
 *
 * @param {OpenDictionary} opened
 * @param {{ readFrom?: number }} [options]
 * @returns {Generator<Entry, void, undefined>}
 */
export function* entriesOf({ idx, dict, offsetBits, sametypesequence }, { readFrom = 0 } = {}) {
  let position = -1;
  for (const entry of idxEntries(idx, offsetBits)) {
    position += 1;
    if (!isWord(entry)) continue;
    if (position < readFrom) {
      yield { position, headword: entry.word, senses: [] };
      continue;
    }
    const fields = readFields(dict, entry, sametypesequence);
    yield { position, headword: entry.word, senses: fields === null ? [] : senses(fields) };
  }
}

/**
 * @param {OpenDictionary} opened
 * @returns {Generator<Alias, void, undefined>}
 */
export function* aliasesOf({ syn }) {
  if (syn === null) return;
  for (const { word, target } of synEntries(syn)) yield { headword: word, target };
}

/**
 * @param {ImportProblem} problem
 * @param {string} [detail]
 * @returns {string} something to show whoever picked the files, always ending in
 *   what happened to their data - which is nothing
 */
export function describeImportProblem(problem, detail) {
  switch (problem) {
    case "empty":
      return t("dict_import_empty");
    case "missing_ifo":
      return t("dict_import_missing_ifo");
    case "missing_idx":
      return t("dict_import_missing_idx");
    case "missing_dict":
      return t("dict_import_missing_dict");
    case "mixed":
      return t("dict_import_mixed", detail ?? "");
    case "not_stardict":
      return detail === undefined
        ? t("dict_import_not_stardict")
        : t("dict_import_not_stardict_detail", detail);
    case "unpack":
      return t("dict_import_unpack", aside(detail));
    case "no_entries":
      return detail === undefined
        ? t("dict_import_no_entries")
        : t("dict_import_no_entries_detail", detail);
    default:
      return t("dict_import_unreadable");
  }
}
