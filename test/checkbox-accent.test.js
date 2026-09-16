import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Every checkbox of the extension ticks in the text's own ink (D202): one
// token in the pages' sheet, no page dressing its switches in the accent
// beside the look-up answer's boxes.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
const sheet = (path) => readFileSync(join(ROOT, path), "utf8");

/**
 * The rules of a sheet whose declarations set `accent-color`, each as
 * `[selector, declarations]`.
 *
 * @param {string} css
 * @returns {Array<[string, string]>}
 */
function accentRules(css) {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  /** @type {Array<[string, string]>} */
  const found = [];
  for (const match of bare.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [, selector, body] = match;
    if (String(body).includes("accent-color")) found.push([String(selector).trim(), String(body)]);
  }
  return found;
}

describe("the checkboxes' accent", () => {
  it("is the text's ink, set once for every page", () => {
    const rules = accentRules(sheet("src/assets/page.css"));
    const boxes = rules.find(([selector]) => selector === 'input[type="checkbox"]');
    assert.ok(boxes !== undefined, "the pages' checkbox rule");
    assert.match(boxes[1], /accent-color: var\(--page-fg\)/);
    // The look-up answer's box says the same in the bubble's words - the
    // current colour, which is the text's - since a shadow root has no
    // page tokens; on the pages the two agree.
    const shelf = rules.find(([selector]) => selector.includes(".lookup-line > .lookup-line-box"));
    assert.ok(shelf !== undefined, "the shelf's box rule");
    assert.match(shelf[1], /accent-color: currentColor/);
  });

  it("is dressed in the accent by no page of its own", () => {
    for (const path of ["src/popup/popup.css", "src/options/options.css", "src/vocab/vocab.css", "src/reader/reader.css"]) {
      for (const [selector, body] of accentRules(sheet(path))) {
        // A progress bar may keep the accent: it is not a checkbox.
        if (/progress/.test(selector)) continue;
        assert.doesNotMatch(body, /accent-color: var\(--page-accent\)/, `${path}: ${selector}`);
      }
    }
    // The bubble's own sheet, in the same words as the shelf on the pages.
    const bubble = readFileSync(join(ROOT, "src/content/tooltip.js"), "utf8");
    assert.match(bubble, /accent-color: currentColor;/);
    assert.doesNotMatch(bubble, /accent-color: var\(/);
  });
});
