import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { STYLE } from "../src/content/tooltip.js";

const ROOT = new URL("../", import.meta.url);

describe("tooltip.css sync (Phase 1)", () => {
  it("matches STYLE in tooltip.js exactly", async () => {
    const rawCss = await readFile(new URL("src/content/tooltip.css", ROOT), "utf8");
    const normalizedCss = rawCss.replace(/\r\n/g, "\n").trim();
    const normalizedStyle = STYLE.replace(/\r\n/g, "\n").trim();
    assert.equal(normalizedStyle, normalizedCss, "tooltip.css should be the clean extracted stylesheet of tooltip.js");
  });
});
