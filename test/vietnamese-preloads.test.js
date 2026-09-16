// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { classifyLine } from "../src/lib/dict/line-classifier.js";
import { formatPronunciationRow, formatExampleRow, formatIdiomRow } from "../src/lib/lookup-shelf.js";

function mockDocument() {
  return {
    createElement(tag) {
      const children = [];
      return {
        tag,
        className: "",
        textContent: "",
        children,
        append(...items) {
          children.push(...items);
        },
        querySelector(selector) {
          const cls = selector.replace(".", "");
          return children.find((c) => c.className === cls);
        },
      };
    },
  };
}

describe("Vietnamese dictionary classification and formatting", () => {
  it("classifies Vietnamese parts of speech as headings, stripping bullets", () => {
    assert.equal(classifyLine("■ danh từ", "en"), "heading");
    assert.equal(classifyLine("■ tính từ", "en"), "heading");
    assert.equal(classifyLine("■ động từ", "en"), "heading");
    assert.equal(classifyLine("noun", "en"), "heading");
  });

  it("classifies CEFR levels and IPA as pronunciation", () => {
    assert.equal(classifyLine("CEFR: A1", "en"), "pronunciation");
    assert.equal(classifyLine("CEFR: B2", "en"), "pronunciation");
    assert.equal(classifyLine("/bʊk/", "en"), "pronunciation");
    assert.equal(classifyLine("beau·ti·ful — /ˈbjuːtɪfl/", "en"), "pronunciation");
  });

  it("classifies examples and idioms separately from meanings", () => {
    assert.equal(classifyLine("‣ old book ↔ sách cũ", "en"), "example");
    assert.equal(classifyLine("to read ↔ đọc", "en"), "example");
    assert.equal(classifyLine("★ to bring someone to book ↔ hỏi tội ai", "en"), "idiom");
    assert.equal(classifyLine("1. sách", "en"), "meaning");
  });

  it("formats example rows with source, arrow, and target", () => {
    globalThis.document = mockDocument();
    const row = formatExampleRow("‣ old book ↔ sách cũ");
    assert.equal(row.className, "lookup-example");
    assert.equal(row.querySelector(".lookup-ex-source")?.textContent, "old book");
    assert.equal(row.querySelector(".lookup-ex-target")?.textContent, "sách cũ");
  });

  it("formats idiom rows with star, source, and target", () => {
    globalThis.document = mockDocument();
    const row = formatIdiomRow("★ bad book ↔ không được ưa");
    assert.equal(row.className, "lookup-idiom");
    assert.equal(row.querySelector(".lookup-idiom-star")?.textContent, "★");
    assert.equal(row.querySelector(".lookup-idiom-source")?.textContent, "bad book");
    assert.equal(row.querySelector(".lookup-idiom-target")?.textContent, "không được ưa");
  });
});

describe("Vietnamese models and dictionary preloads", () => {
  it("has envi and vien registered in official registryModels", async () => {
    const { registryModels, findRegistryModel } = await import("../src/lib/models/registry.js");
    const envi = findRegistryModel("en", "vi");
    const vien = findRegistryModel("vi", "en");

    assert.ok(envi, "envi model must be in registry");
    assert.equal(envi.pair, "envi");
    assert.equal(envi.from, "en");
    assert.equal(envi.to, "vi");
    assert.equal(envi.files.length, 3);
    assert.ok(envi.files.some(f => f.role === "model"));
    assert.ok(envi.files.some(f => f.role === "shortlist"));
    assert.ok(envi.files.some(f => f.role === "vocab"));

    assert.ok(vien, "vien model must be in registry");
    assert.equal(vien.pair, "vien");
    assert.equal(vien.from, "vi");
    assert.equal(vien.to, "en");
    assert.equal(vien.files.length, 3);
    assert.ok(vien.files.some(f => f.role === "model"));
    assert.ok(vien.files.some(f => f.role === "shortlist"));
    assert.ok(vien.files.some(f => f.role === "vocab"));
  });

  it("pairChoices includes both en-vi and vi-en in popup dropdown", async () => {
    const { pairChoices } = await import("../src/popup/choices.js");
    const installed = [
      { pair: "envi", from: "en", to: "vi" },
      { pair: "vien", from: "vi", to: "en" },
    ];
    const config = { sourceLang: "en", targetLang: "vi" };
    const choices = pairChoices(config, installed);

    const pairs = choices.map(c => c.pair);
    assert.ok(pairs.includes("envi"), "envi must be in popup choices");
    assert.ok(pairs.includes("vien"), "vien must be in popup choices");
  });

  it("prebuilt dictionary file exists and contains entries when present", async () => {
    const { existsSync } = await import("node:fs");
    if (!existsSync("dictionaries/tudien-stardict-en-vi.prebuilt.json.gz")) return;
    const { readFile } = await import("node:fs/promises");
    const zlib = await import("node:zlib");
    const gz = await readFile("dictionaries/tudien-stardict-en-vi.prebuilt.json.gz");
    assert.ok(gz.byteLength > 1_000_000, "prebuilt dictionary must be non-trivial size");

    const jsonBuf = zlib.gunzipSync(gz);
    const data = JSON.parse(jsonBuf.toString("utf8"));
    assert.ok(data.rows.length > 200_000, "must contain over 200,000 entries");
    assert.ok(data.summary.entryCount > 200_000, "summary must report over 200,000 entries");

    // Check a sample word
    const hello = data.rows.find(r => r[0] === "hello" || r[1] === "hello");
    assert.ok(hello, "must have hello entry");
    assert.equal(hello[1], "hello");
    assert.ok(hello[2].length > 0, "hello must have senses");
  });
});

