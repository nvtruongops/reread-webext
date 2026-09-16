import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STYLE } from "../src/content/tooltip.js";

/**
 * Every line the bubble draws - the separators in front of the second layer,
 * the cut where a dictionary entry runs past its box, the frames around the
 * things that can be pressed - goes through one custom property, and the point
 * of it is a panel nobody here is looking at: an e-ink screen has 16 greys, and
 * it rounds a translucent black back into the paper. A hairline written as a
 * tenth of an alpha is not a faint line there, it is no line (reported from a
 * Boox: the bubble's separators were simply gone). The build after that one had
 * two strengths, a quiet one for separators and a loud one for edges, as the
 * extension's own pages do - and read on paper the quiet one still looked like
 * a mistake beside the loud one, so one strength is what the bubble keeps.
 *
 * That is exactly the kind of regression a smoke test cannot catch, because the
 * screen it is run on shows the faint line perfectly well. What can be held
 * without a browser is the rule itself: borders name the property and nothing
 * else, it carries enough contrast against the bubble's own paper in both
 * themes, and nothing in the bubble is told apart by a shadow.
 */

/**
 * The text between a rule's opening brace and the first closing one. The dark
 * theme's marker is its media query: the first brace after it opens the query,
 * the first closing one ends the `.bubble` rule inside it, and the slice is
 * that rule's declarations.
 *
 * @param {string} marker
 * @returns {string}
 */
function blockAfter(marker) {
  const start = STYLE.indexOf(marker);
  assert.notEqual(start, -1, `the stylesheet lost its "${marker}"`);
  const open = STYLE.indexOf("{", start);
  const close = STYLE.indexOf("}", open);
  return STYLE.slice(open + 1, close);
}

/**
 * @param {string} css
 * @param {string} property
 * @returns {string}
 */
function hex(css, property) {
  const found = new RegExp(`${property}\\s*:\\s*(#[0-9a-f]{6})\\s*;`).exec(css);
  assert.notEqual(found, null, `${property} is not a plain hex color`);
  return found?.[1] ?? "";
}

/**
 * WCAG relative luminance. Written out rather than approximated, because the
 * numbers this test asserts are the ones page.css reasons in.
 *
 * @param {string} color
 * @returns {number}
 */
function luminance(color) {
  const channels = [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16) / 255);
  const linear = channels.map((one) => (one <= 0.03928 ? one / 12.92 : ((one + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (linear[0] ?? 0) + 0.7152 * (linear[1] ?? 0) + 0.0722 * (linear[2] ?? 0);
}

/**
 * @param {string} one
 * @param {string} other
 * @returns {number}
 */
function contrast(one, other) {
  const [dark, light] = [luminance(one), luminance(other)].sort((a, b) => a - b);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const THEMES = [
  { name: "light", css: blockAfter(".bubble {") },
  { name: "dark", css: blockAfter("@media (prefers-color-scheme: dark)") },
  // The reader-named papers: the reader hands its theme down with every show,
  // so these two blocks dress the bubble whatever the system prefers - the
  // same 4.5:1 floor holds on each.
  { name: "reader dark", css: blockAfter('.bubble[data-scheme="dark"]') },
  { name: "reader sepia", css: blockAfter('.bubble[data-scheme="sepia"]') },
];

describe("the bubble's lines", () => {
  it("draws every border with the line property and never with an alpha", () => {
    for (const [, value] of STYLE.matchAll(/(border(?:-[a-z]+)*)\s*:\s*([^;]+);/g)) {
      const declaration = value ?? "";
      assert.ok(
        !/rgba?\(|#[0-9a-f]{3}/.test(declaration),
        `a border is drawn in a color of its own: "${declaration.trim()}"`,
      );
    }
  });

  for (const theme of THEMES) {
    it(`keeps the line readable on the ${theme.name} bubble's own paper`, () => {
      const paper = hex(theme.css, "background");
      const edge = hex(theme.css, "--edge");

      // The floor a control's boundary has to clear (WCAG 1.4.11 asks 3:1;
      // page.css holds its edges past 4.5:1 and so does this).
      assert.ok(contrast(edge, paper) >= 4.5, `--edge is ${contrast(edge, paper).toFixed(2)}:1, under 4.5:1`);
    });
  }

  it("marks a list longer than its box with ink, not with a fade", () => {
    const block = blockAfter('.entries[data-more="true"]');
    // A hard stop, because a gradient is what an e-ink panel dithers, and the
    // colour is the bubble's one line - a mark in a colour of its own would
    // be the alpha problem again, one element further along.
    assert.match(block, /conic-gradient\([^)]*var\(--edge\) 0 90deg, transparent 0\)/);
    assert.match(block, /border-bottom-width:\s*1px/);
  });

  it("tells nothing apart by a shadow inside the bubble", () => {
    // The two shadows left are the bubble's own, under its outer edge, and
    // that edge is what says where the bubble ends on a panel that cannot
    // draw them. An inset shadow is different: it lands on the text.
    assert.ok(!/box-shadow:\s*inset/.test(STYLE), "an inset shadow is back in the bubble");
  });
});
