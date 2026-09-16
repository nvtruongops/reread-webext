import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildMdxHeaderBuffer,
  parseMdxEntry,
  parseMdxHeader,
} from "../src/lib/dict/mdx.js";

describe("MDX Dictionary Parser (Phase 3)", () => {
  it("encodes and decodes MDX dictionary header XML metadata", () => {
    const buffer = buildMdxHeaderBuffer({
      title: "Oxford Advanced Learner's Dictionary",
      description: "9th Edition MDX format",
      encoding: "UTF-8",
    });

    const parsed = parseMdxHeader(buffer);
    assert.equal(parsed.title, "Oxford Advanced Learner's Dictionary");
    assert.equal(parsed.description, "9th Edition MDX format");
    assert.equal(parsed.encoding, "UTF-8");
  });

  it("throws on truncated or corrupted header bytes", () => {
    assert.throws(() => parseMdxHeader(new Uint8Array([1, 2, 3])));
    assert.throws(() => parseMdxHeader(new Uint8Array([0, 0, 100, 0, 1, 2, 3])));
  });

  it("cleans and extracts dictionary entry senses from raw HTML content", () => {
    const rawHtml = "<b>read</b><br/><i>verb</i><p>1. look at and comprehend the meaning of written text.</p><p>2. discover by reading.</p>";
    const senses = parseMdxEntry(rawHtml);
    assert.ok(senses.length >= 2);
    assert.ok(senses[0] && senses[0].includes("read"));
    assert.ok(senses.some((s) => s.includes("look at and comprehend")));
  });
});
