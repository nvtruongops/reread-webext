import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { exportArticleToMarkdown } from "../src/lib/export-markdown.js";

describe("Markdown & Obsidian Export (Phase 5)", () => {
  it("generates markdown with valid YAML frontmatter and highlights", () => {
    const markdown = exportArticleToMarkdown({
      title: "The Art of Language Learning",
      byline: "Jane Doe",
      url: "https://example.com/art-of-languages",
      siteName: "Example Blog",
      savedAt: 1773660000000,
      marks: [
        {
          text: "Language acquisition is primarily subconscious.",
          color: "yellow",
          note: "Krashen's hypothesis",
        },
        {
          text: "Comprehensible input is the essential ingredient.",
          color: "green",
        },
      ],
    });

    // Check YAML frontmatter
    assert.ok(markdown.startsWith("---\n"));
    assert.ok(markdown.includes('title: "The Art of Language Learning"'));
    assert.ok(markdown.includes('author: "Jane Doe"'));
    assert.ok(markdown.includes('url: "https://example.com/art-of-languages"'));
    assert.ok(markdown.includes("tags:\n  - reread\n  - reading-notes"));

    // Check Highlights & Notes
    assert.ok(markdown.includes("# The Art of Language Learning"));
    assert.ok(markdown.includes("> Language acquisition is primarily subconscious."));
    assert.ok(markdown.includes("**Note:** Krashen's hypothesis"));
    assert.ok(markdown.includes("> Comprehensible input is the essential ingredient."));
  });

  it("handles articles without highlights or notes gracefully", () => {
    const markdown = exportArticleToMarkdown({
      title: "Short Note",
    });

    assert.ok(markdown.includes('title: "Short Note"'));
    assert.ok(markdown.includes("# Short Note"));
    assert.equal(markdown.includes("## Highlights"), false);
  });
});
