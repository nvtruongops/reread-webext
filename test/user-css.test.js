import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { screenRules } from "../src/lib/user-css.js";

/**
 * The screen over the reader's own rules (D176). What can be held without a
 * browser is the rule: the parser's serialization goes in, and either every
 * rule comes back as text to adopt or the whole sheet is refused with a
 * reason - at the first value that would load something, wherever it hides.
 *
 * @param {string} cssText
 * @param {import("../src/lib/user-css.js").RuleLike[]} [rules]
 * @param {import("../src/lib/user-css.js").RuleKind} [kind]
 * @returns {import("../src/lib/user-css.js").RuleLike}
 */
function rule(cssText, rules = [], kind = "other") {
  return { kind, cssText, rules };
}

describe("screenRules", () => {
  it("passes rules that only dress, and hands back the parser's text one rule per line", () => {
    const screened = screenRules([
      rule(".entry-label { color: darkorange; }"),
      rule("@media (prefers-color-scheme: dark) {\n  .entry + .entry { border-top-color: white; }\n}", [
        rule(".entry + .entry { border-top-color: white; }"),
      ]),
    ]);
    assert.deepEqual(screened, {
      ok: true,
      css: ".entry-label { color: darkorange; }\n@media (prefers-color-scheme: dark) {\n  .entry + .entry { border-top-color: white; }\n}",
    });
  });

  it("passes an empty sheet as nothing to add", () => {
    assert.deepEqual(screenRules([]), { ok: true, css: "" });
  });

  it("refuses a value that would load something, however it is spelled", () => {
    for (const text of [
      '.bubble { background: url("https://example.com/paper.png"); }',
      '.bubble { background: URL("https://example.com/paper.png"); }',
      '.bubble { background-image: image-set("a.png" 1x, "b.png" 2x); }',
      '.bubble { background-image: -webkit-image-set(url("a.png") 1x); }',
      '.bubble { background: src("https://example.com/paper.png"); }',
      ".bubble { cursor: url(cursor.cur), auto; }",
      ".entry-sense::before { content: image(\"a.png\"); }",
    ]) {
      assert.deepEqual(screenRules([rule(text)]), { ok: false, reason: "network" }, text);
    }
  });

  it("looks inside grouping rules, and refuses the whole sheet for one bad line", () => {
    const screened = screenRules([
      rule(".entry-label { color: darkorange; }"),
      rule("@media (min-width: 40em) {\n  .bubble { background: url(x.png); }\n}", [
        rule(".bubble { background: url(x.png); }"),
      ]),
    ]);
    assert.deepEqual(screened, { ok: false, reason: "network" });
  });

  it("refuses the rules that load by their nature, wherever they stand", () => {
    assert.deepEqual(screenRules([rule('@import url("x.css");', [], "import")]), {
      ok: false,
      reason: "import",
    });
    assert.deepEqual(screenRules([rule("@font-face { font-family: x; src: local(x); }", [], "font-face")]), {
      ok: false,
      reason: "font-face",
    });
    // Nested in a block: the kind is read down the tree, not only at the top.
    assert.deepEqual(
      screenRules([
        rule("@media print {\n  @font-face { font-family: x; src: local(x); }\n}", [
          rule("@font-face { font-family: x; src: local(x); }", [], "font-face"),
        ]),
      ]),
      { ok: false, reason: "font-face" },
    );
    assert.deepEqual(screenRules([rule('@namespace svg url("http://www.w3.org/2000/svg");', [], "namespace")]), {
      ok: false,
      reason: "namespace",
    });
  });

  it("does not mistake a property's name for a load", () => {
    const screened = screenRules([rule(".bubble { background-image: none; list-style-image: none; }")]);
    assert.equal(screened.ok, true);
  });
});
