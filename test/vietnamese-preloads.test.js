// @ts-nocheck
import assert from "node:assert/strict";
import { describe, it, beforeEach, after } from "node:test";
import { classifyLine } from "../src/lib/dict/line-classifier.js";
import { formatPronunciationRow, formatExampleRow, formatIdiomRow } from "../src/lib/lookup-shelf.js";

const origDocument = globalThis.document;

function mockDocument() {
  const makeElement = (tag) => {
    const children = [];
    const listeners = {};
    const dataset = {};
    const el = {
      tag,
      className: "",
      textContent: "",
      dataset,
      hidden: false,
      children,
      get childElementCount() {
        return children.length;
      },
      append(...items) {
        children.push(...items);
      },
      addEventListener(type, listener) {
        listeners[type] = listeners[type] || [];
        listeners[type].push(listener);
      },
      click() {
        listeners["click"]?.forEach((cb) => cb({ target: el }));
      },
      setAttribute(name, val) {
        el[name] = val;
      },
      querySelector(selector) {
        return el.querySelectorAll(selector)[0] || null;
      },
      querySelectorAll(selector) {
        const matches = [];
        const matchSingle = (node) => {
          if (!node || typeof node !== "object") return;
          const classes = (node.className || "").split(/\s+/);
          const targetClass = selector.replace(/^[^.]*\./, "");
          if (classes.includes(targetClass) || node.tag === selector) {
            matches.push(node);
          }
          (node.children || []).forEach(matchSingle);
        };
        (el.children || []).forEach(matchSingle);
        return matches;
      },
    };
    return el;
  };
  return { createElement: makeElement };
}

describe("Vietnamese dictionary classification and formatting", () => {
  beforeEach(() => {
    globalThis.document = mockDocument();
  });

  after(() => {
    globalThis.document = origDocument;
  });

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
    const row = formatExampleRow("‣ old book ↔ sách cũ");
    assert.equal(row.className, "lookup-example");
    assert.equal(row.querySelector(".lookup-ex-source")?.textContent, "old book");
    assert.equal(row.querySelector(".lookup-ex-target")?.textContent, "sách cũ");
  });

  it("formats idiom rows with star, source, and target", () => {
    const row = formatIdiomRow("★ bad book ↔ không được ưa");
    assert.equal(row.className, "lookup-idiom");
    assert.equal(row.querySelector(".lookup-idiom-star")?.textContent, "★");
    assert.equal(row.querySelector(".lookup-idiom-source")?.textContent, "bad book");
    assert.equal(row.querySelector(".lookup-idiom-target")?.textContent, "không được ưa");
  });

  it("translates etymology phrases into understandable Vietnamese", async () => {
    const { translateEtymology } = await import("../src/lib/lookup-shelf.js");
    const raw = "late Middle English: from Old French comunete, reinforced by its source, Latin communitas, from...";
    const translated = translateEtymology(raw);
    assert.ok(translated.includes("tiếng Anh trung đại muộn"), "must translate late Middle English");
    assert.ok(translated.includes("tiếng Pháp cổ"), "must translate Old French");
    assert.ok(translated.includes("tiếng La-tinh"), "must translate Latin");
  });

  it("translates weird etymology naturally without broken English fragments", async () => {
    const { translateEtymology } = await import("../src/lib/lookup-shelf.js");
    const weirdRaw = "Old English wyrd ‘destiny’, of Germanic origin. The adjective (late Middle English) originally meant ‘having the power to control destiny’, and was used especially in the Weird Sisters, originally referring to the Fates, later the witches in Shakespeare's Macbeth; the latter use gave rise to the sense ‘unearthly’ (early 19th cent.).";
    const res = translateEtymology(weirdRaw);
    assert.ok(res.includes("Bắt nguồn từ tiếng Anh cổ"), "must translate Old English starter");
    assert.ok(res.includes("thuộc gốc Giéc-manh"), "must translate Germanic origin");
    assert.ok(res.includes("ban đầu mang nghĩa 'có quyền năng điều khiển số phận'"), "must translate originally meant");
    assert.ok(res.includes("Weird Sisters"), "must keep Weird Sisters in quotes");
    assert.ok(res.includes("Ba nữ thần Định Mệnh"), "must translate Fates");
    assert.ok(res.includes("vở kịch Macbeth của Shakespeare"), "must translate Macbeth reference");
    assert.ok(res.includes("đầu thế kỷ 19"), "must translate early 19th cent");
    assert.ok(!res.includes("of Germanic origin"), "must not leave raw English phrase");
  });

  it("formats etymology as a collapsible details closed by default", async () => {
    const { formatAboutRow } = await import("../src/lib/lookup-shelf.js");
    const weirdRaw = "• Old English wyrd ‘destiny’, of Germanic origin. The adjective (late Middle English)...";
    const row = formatAboutRow(weirdRaw);
    const details = row.querySelector("details.lookup-etymology-details");
    assert.ok(details, "must contain details element with class lookup-etymology-details");
    assert.equal(details.open, false, "must be closed by default");
    const summary = details.querySelector("summary.lookup-etymology-summary");
    assert.ok(summary, "must have summary");
    const body = details.querySelector(".lookup-etymology-body");
    assert.ok(body, "must have body element");
    assert.ok(body.textContent.includes("Bắt nguồn từ tiếng Anh cổ"), "body must contain natural translation");
  });

  it("limits examples to 2 per meaning and provides extra toggle", async () => {
    const { renderShelf } = await import("../src/lib/lookup-shelf.js");
    const group = {
      dictionary: "tudien-en-vi",
      entries: [
        {
          headword: "process",
          rows: [
            { kind: "meaning", text: "1. quá trình; quy trình" },
            { kind: "example", text: "‣ ex1 ↔ ví dụ 1" },
            { kind: "example", text: "‣ ex2 ↔ ví dụ 2" },
            { kind: "example", text: "‣ ex3 ↔ ví dụ 3" },
            { kind: "example", text: "‣ ex4 ↔ ví dụ 4" },
            { kind: "meaning", text: "2. phương pháp" },
            { kind: "example", text: "‣ ex5 ↔ ví dụ 5" },
          ],
        },
      ],
      lines: ["1. quá trình; quy trình", "2. phương pháp"],
      about: [],
    };

    const books = renderShelf([group], { meanings: [], folds: new Map(), readOnly: false });
    const book = books[0];
    const extraWraps = book.querySelectorAll(".lookup-extra-examples");
    assert.equal(extraWraps.length, 1, "should have 1 extra examples wrapper for meaning 1");
    assert.equal(extraWraps[0].childElementCount, 2, "extra wrap should hold 2 examples (ex3 and ex4)");
    assert.equal(extraWraps[0].hidden, true, "extra wrap should be hidden by default");

    const toggle = book.querySelector("button.lookup-examples-toggle");
    assert.ok(toggle, "must have extra examples toggle button");
    assert.ok(toggle.textContent.includes("2"), "toggle button must show count of 2 extra examples");

    // Click toggle to unfold
    toggle.click();
    assert.equal(extraWraps[0].hidden, false, "clicking toggle should unhide extra examples");

    // Click toggle to fold back
    toggle.click();
    assert.equal(extraWraps[0].hidden, true, "clicking toggle again should hide extra examples");
  });

  it("preserves sentence action in reading.js during change() on automatic keep", async () => {
    const fs = await import("node:fs");
    const readingSrc = fs.readFileSync("src/content/reading.js", "utf-8");
    assert.match(
      readingSrc,
      /const sentenceAction\s*=\s*[\s\S]*?unfetched\?\.context[\s\S]*?\["sentence"\][\s\S]*?tooltip\.setActions\(\[\.\.\.next,\s*\.\.\.sentenceAction,\s*\.\.\.secondLayer\]\)/,
      "change() must preserve sentenceAction so Translate sentence button is not lost on first click",
    );
  });

  it("derives form details with grammatical tag, Vietnamese meaning, and examples", async () => {
    const { deriveFormDetails } = await import("../src/lib/lookup-shelf.js");
    const details = deriveFormDetails("communities", "community", "cộng đồng", ["work for the good of the community ↔ làm việc vì lợi ích của cộng đồng"]);
    assert.equal(details.form, "communities");
    assert.equal(details.meaning, "các cộng đồng");
    assert.ok(details.tag.includes("số nhiều"), "must identify plural");
    assert.ok(details.exSrc.length > 0, "must provide example source");
    assert.ok(details.exTgt.length > 0, "must provide example target");
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

