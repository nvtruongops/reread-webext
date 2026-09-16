import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  heuristicExtractSummary,
  isAiSummarizerAvailable,
  summarizeText,
} from "../src/lib/summarizer/index.js";

const SAMPLE_ARTICLE = `
The quick brown fox jumps over the lazy dog in a remarkable display of agility.
Language acquisition flourishes when readers engage with rich, authentic context.
Extensive reading provides organic repetition of high-frequency vocabulary across varied sentence structures.
Spaced repetition software reinforces retention, yet comprehensible input remains the cornerstone of fluency.
In conclusion, combining offline reading tools with on-device intelligence creates the optimal private learning experience.
`.trim();

describe("On-Device AI Summarizer (Phase 2)", () => {
  it("reports unavailable when AI summarizer API is absent", async () => {
    const available = await isAiSummarizerAvailable();
    assert.equal(available, false);
  });

  it("extracts 3 key points using deterministic local fallback", () => {
    const points = heuristicExtractSummary(SAMPLE_ARTICLE, 3);
    assert.equal(points.length, 3);
    assert.ok(points[0] && points[0].includes("quick brown fox"));
    assert.ok(points[2] && points[2].includes("optimal private learning experience"));
  });

  it("summarizes text successfully using fallback when native API is missing", async () => {
    const result = await summarizeText({ text: SAMPLE_ARTICLE });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.value.length, 3);
    }
  });

  it("uses native Chromium Summarizer API when present in scope", async () => {
    /** @type {any} */ (globalThis).ai = {
      summarizer: {
        async capabilities() {
          return { available: "readily" };
        },
        /** @param {{ type: string, length: string }} options */
        async create(options) {
          return {
            /** @param {string} text */
            async summarize(text) {
              return "• First main takeaway.\n• Second key argument.\n• Third closing insight.";
            },
          };
        },
      },
    };

    try {
      const result = await summarizeText({ text: SAMPLE_ARTICLE });
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.deepEqual(result.value, [
          "First main takeaway.",
          "Second key argument.",
          "Third closing insight.",
        ]);
      }
    } finally {
      delete /** @type {any} */ (globalThis).ai;
    }
  });

  it("handles empty or blank text gracefully", async () => {
    const result = await summarizeText({ text: "   " });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value, []);
    }
  });
});
