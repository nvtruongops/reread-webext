/**
 * The vendored ZIP library as this extension uses it: the synchronous
 * single-entry reads the book import has always made, and - since the
 * reading list's backup learned to carry pictures (D145) - a writer. The
 * writer is a stream since the backup learned to carry books (D218):
 * `Zip` with a `ZipDeflate` or `ZipPassThrough` per entry, fed one entry
 * at a time, so that a library of thirty books never stands in memory
 * whole beside its own archive - the archive's chunks are all the export
 * holds, and one entry's bytes beside them. Nothing asynchronous: that
 * path spawns Web Workers from `Blob` URLs, which is exactly the kind of
 * dynamic code an auditor should be able to rule out
 * (`vendor/fflate/README.md`; `test/vendor-surface.test.js` holds the
 * promise). Loaded once, the first time an import or export actually
 * needs it - the reader page in its usual life never pays for it.
 */

/**
 * @typedef {{ name: string, size: number, originalSize: number }} ZipEntryInfo
 * @typedef {{ push: (data: Uint8Array, final: boolean) => void }} ZipFile
 * @typedef {{
 *   unzipSync: (
 *     data: Uint8Array,
 *     opts?: { filter?: (file: ZipEntryInfo) => boolean },
 *   ) => Record<string, Uint8Array>,
 *   Zip: new (
 *     cb: (error: Error | null, chunk: Uint8Array<ArrayBuffer>, final: boolean) => void,
 *   ) => { add: (file: ZipFile) => void, end: () => void },
 *   ZipDeflate: new (name: string, opts?: { level: number }) => ZipFile,
 *   ZipPassThrough: new (name: string) => ZipFile,
 * }} FflateModule
 */

/**
 * One entry to write: its name, its bytes, and whether it is worth
 * deflating - text is, a picture that is already compressed is not.
 *
 * @typedef {{ name: string, data: Uint8Array, deflate: boolean }} ArchiveEntry
 */

/** @type {FflateModule | null} */
let fflate = null;

/**
 * A dynamic import of the copied file rather than a bundled one, so what
 * runs is byte-for-byte what `vendor/fflate/CHECKSUMS` pins. The specifier
 * is written for the built package, where `vendor/` stands beside
 * `reader/`; the build marks it external so it survives bundling verbatim.
 *
 * @returns {Promise<FflateModule>}
 */
export async function loadFflate() {
  if (fflate === null) {
    fflate = /** @type {FflateModule} */ (
      // @ts-expect-error - the path exists only in the built package (the
      // vendored file is copied, never bundled), so the checker cannot
      // resolve it from the source tree.
      await import("../vendor/fflate/browser.js")
    );
  }
  return fflate;
}

/**
 * Every entry's name and sizes, without inflating one: the directory is
 * scanned, and a filter that keeps nothing leaves it at that.
 *
 * @param {Uint8Array} bytes the whole archive
 * @returns {Promise<ZipEntryInfo[]>}
 */
export async function listEntries(bytes) {
  const { unzipSync } = await loadFflate();
  /** @type {ZipEntryInfo[]} */
  const infos = [];
  unzipSync(bytes, {
    filter: (info) => {
      infos.push(info);
      return false;
    },
  });
  return infos;
}

/**
 * A reader of single entries by name, each refused before inflating when
 * the directory says it is larger than `cap` - or missing. Synchronous
 * once made, so a loop over an article's pictures needs no await per one.
 *
 * @param {Uint8Array} bytes the whole archive
 * @returns {Promise<(name: string, cap: number) => Uint8Array | null>}
 */
export async function entryReader(bytes) {
  const { unzipSync } = await loadFflate();
  return (name, cap) => {
    const out = unzipSync(bytes, {
      filter: (info) => info.name === name && info.originalSize <= cap,
    });
    return out[name] ?? null;
  };
}

/**
 * The archive an export writes, as a stream: deflated where the entry is
 * text, stored where it is a picture that is compressed already - a JPEG
 * through deflate is the same size and the time it took. The entries come
 * one at a time, from an array or from a generator that reads each book
 * only when its turn comes, and leave as the chunks of the archive; what
 * the export holds at any moment is those chunks and the one entry being
 * written. The result is a `Blob` of the chunks - what a download takes,
 * and what a browser may keep outside memory when it is large.
 *
 * @param {Iterable<ArchiveEntry> | AsyncIterable<ArchiveEntry>} entries
 * @param {Pick<FflateModule, "Zip" | "ZipDeflate" | "ZipPassThrough">} [lib]
 *   the vendored module, injected by the tests; loaded here otherwise
 * @returns {Promise<Blob>}
 */
export async function packArchive(entries, lib) {
  const { Zip, ZipDeflate, ZipPassThrough } = lib ?? (await loadFflate());
  /** @type {Uint8Array<ArrayBuffer>[]} */
  const parts = [];
  /** @type {Error | null} */
  let failed = null;
  const zip = new Zip((error, chunk) => {
    if (error !== null) failed = error;
    else parts.push(chunk);
  });
  for await (const entry of entries) {
    const file = entry.deflate ? new ZipDeflate(entry.name, { level: 6 }) : new ZipPassThrough(entry.name);
    zip.add(file);
    file.push(entry.data, true);
    if (failed !== null) throw failed;
  }
  zip.end();
  if (failed !== null) throw failed;
  return new Blob(parts, { type: "application/zip" });
}
