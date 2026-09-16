import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The `accept` attribute is not a convenience on iOS - it is a gate. The
 * Files picker maps every token to a registered file type (UTI) and greys
 * out whatever matches none, so an extension iOS has never heard of makes
 * the picker open with nothing selectable. That is how the StarDict inputs
 * shipped broken to an iPad: `.ifo`, `.idx`, `.dict.dz` and `.syn` have no
 * registered type anywhere.
 *
 * The rule this file pins: a file input either names only types iOS
 * registers, or names none at all and lets import validation do its job.
 */

/** @param {string} page */
async function html(page) {
  return readFile(new URL(`../src/${page}`, import.meta.url), "utf8");
}

/**
 * Every `<input type="file" ...>` tag in the page, whole.
 *
 * @param {string} source
 */
function fileInputs(source) {
  return [...source.matchAll(/<input[^>]*type="file"[^>]*>/g)].map((m) => m[0]);
}

describe("file inputs vs the iOS picker", () => {
  it("options page: model and dictionary inputs carry no accept filter", async () => {
    const inputs = fileInputs(await html("options/options.html"));
    assert.equal(inputs.length, 2, "expected the model input and the dictionary input");
    for (const input of inputs) {
      // Model files (.bin/.spm) and StarDict files (.ifo/.idx/.dict.dz/.syn)
      // have no registered type on iOS - any filter here greys them out.
      assert.doesNotMatch(input, /accept=/, `${input} would grey files out on iOS`);
    }
  });

  it("vocabulary page: TSV filter names only types iOS registers", async () => {
    const [input, ...rest] = fileInputs(await html("vocab/vocab.html"));
    assert.ok(input, "expected the TSV import input");
    assert.equal(rest.length, 0, "expected exactly one file input");
    // `text/tab-separated-values` is UTType.tabSeparatedText - registered
    // since iOS 14, so this filter may stay. Change it only with the iOS
    // picker in mind.
    assert.match(input, /accept="\.tsv,text\/tab-separated-values"/);
  });

  it("reader page: the one filter names only types iOS registers", async () => {
    const [transfer, ...rest] = fileInputs(await html("reader/reader.html"));
    assert.ok(transfer, "expected the reading-list transfer input");
    // The highlights page's own picker (D168) went with its copy (D213):
    // the highlights travel in the backup of everything, which this one
    // input takes.
    assert.equal(rest.length, 0, "expected exactly one file input");
    // JSON, ZIP and EPUB all have system-registered types (public.json,
    // public.zip-archive, org.idpf.epub-container), so this filter may stay
    // too. The ZIP is the backup - of everything (D213), or the older one
    // with pictures (D145).
    assert.match(
      transfer,
      /accept="\.json,application\/json,\.zip,application\/zip,\.epub,application\/epub\+zip"/,
    );
  });
});
