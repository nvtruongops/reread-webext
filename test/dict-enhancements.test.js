import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { formatDictName } from "../src/lib/lookup-shelf.js";

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("formatDictName", () => {
  it("shortens tudien Anh-Việt tổng hợp (en-vi) to EN - VI", () => {
    assert.equal(formatDictName("tudien Anh-Việt tổng hợp (en-vi)"), "EN - VI");
    assert.equal(formatDictName("tudien Anh-Việt"), "EN - VI");
  });

  it("leaves already short or other dictionary names unchanged", () => {
    assert.equal(formatDictName("EN - VI"), "EN - VI");
    assert.equal(formatDictName("FreeDict en-pl"), "FreeDict en-pl");
  });
});

describe("aboutFold deduplication in lookup-shelf.js", () => {
  it("filters out duplicate pronunciation, example, idiom and meaning rows from aboutFold", async () => {
    const shelf = await source("lib/lookup-shelf.js");
    assert.match(shelf, /const seenTexts = new Set\(\);/, "does not track already rendered texts");
    assert.match(shelf, /seenTexts\.has\(trimmed\)/, "does not filter duplicates from aboutFold");
    assert.match(shelf, /about\.hidden = true;/, "does not hide aboutFold when no extra info exists");
  });
});

describe("select and option theme-aware styling for dark mode", () => {
  it("has color-scheme: inherit and background in page.css", async () => {
    const css = await source("assets/page.css");
    assert.match(css, /select\s*\{[\s\S]*?color-scheme:\s*inherit;/, "select does not have color-scheme: inherit");
    assert.match(css, /select\s*\{[\s\S]*?background:\s*var\(--surface-raised,\s*var\(--page-bg\)\);/, "select does not have theme surface background");
    assert.match(css, /option\s*\{[\s\S]*?background-color:\s*var\(--surface-raised,\s*var\(--page-bg\)\);/, "option does not have theme background");
  });

  it("has color-scheme: inherit and surface background in popup.css", async () => {
    const css = await source("popup/popup.css");
    assert.match(css, /\.popup-pair select\s*\{[\s\S]*?color-scheme:\s*inherit;/, "popup select does not have color-scheme: inherit");
    assert.match(css, /\.popup-pair select\s*\{[\s\S]*?background:\s*var\(--surface-raised\);/, "popup select does not have surface background");
    assert.match(css, /\.popup-pair select option\s*\{[\s\S]*?background-color:\s*var\(--surface-raised\);/, "popup option does not have surface background");
  });
});
