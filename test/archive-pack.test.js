import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { packArchive } from "../src/reader/zip.js";

// Loaded by a path the type checker does not follow: the vendored file is
// untyped, and checking it is not this test's business.
/** @type {Pick<import("../src/reader/zip.js").FflateModule, "Zip" | "ZipDeflate" | "ZipPassThrough" | "unzipSync">} */
const fflate = await import(new URL("../vendor/fflate/browser.js", import.meta.url).href);

/**
 * The archive packed as a stream (D218): entries in, the ZIP out, read
 * back with the same vendored library the page unpacks with. The module
 * under test is the reader page's; the library is injected because the
 * page loads it from the built package's own path.
 */

const encoder = new TextEncoder();

/** @param {Blob} blob */
async function entriesOf(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  /** @type {{ name: string, size: number, originalSize: number }[]} */
  const infos = [];
  const files = fflate.unzipSync(bytes, {
    filter: (info) => {
      infos.push({ name: info.name, size: info.size, originalSize: info.originalSize });
      return true;
    },
  });
  return { infos, files };
}

describe("packArchive", () => {
  it("writes every entry, deflating text and storing what is compressed already", async () => {
    const text = encoder.encode("The quick brown fox ".repeat(200));
    const picture = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
    const blob = await packArchive(
      [
        { name: "manifest.json", data: text, deflate: true },
        { name: "pictures/0/0.jpg", data: picture, deflate: false },
      ],
      fflate,
    );
    assert.equal(blob.type, "application/zip");
    const { infos, files } = await entriesOf(blob);
    assert.deepEqual(
      infos.map((info) => info.name),
      ["manifest.json", "pictures/0/0.jpg"],
    );
    assert.deepEqual(Array.from(files["manifest.json"] ?? []), Array.from(text));
    assert.deepEqual(Array.from(files["pictures/0/0.jpg"] ?? []), Array.from(picture));
    const [deflated, stored] = infos;
    assert.ok(deflated !== undefined && deflated.size < deflated.originalSize, "the text was not deflated");
    assert.ok(stored !== undefined && stored.size === stored.originalSize, "the picture was not stored as it is");
  });

  it("takes its entries from a generator, one at a time", async () => {
    /** @type {string[]} */
    const asked = [];
    async function* entries() {
      for (const name of ["a.json", "books/one.json", "books/two.json"]) {
        asked.push(name);
        yield { name, data: encoder.encode(`{"name":"${name}"}`), deflate: true };
      }
    }
    const { infos, files } = await entriesOf(await packArchive(entries(), fflate));
    assert.deepEqual(asked, ["a.json", "books/one.json", "books/two.json"]);
    assert.deepEqual(infos.map((info) => info.name), asked);
    assert.equal(new TextDecoder().decode(files["books/two.json"]), '{"name":"books/two.json"}');
  });

  it("writes an archive with no entry at all as a valid, empty ZIP", async () => {
    const { infos } = await entriesOf(await packArchive([], fflate));
    assert.deepEqual(infos, []);
  });
});
