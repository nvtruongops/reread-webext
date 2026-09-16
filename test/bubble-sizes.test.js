import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STYLE } from "../src/content/tooltip.js";

/**
 * The bubble's sizes are a small system: two tiers of custom properties - the
 * desktop set on `.bubble`, the touch set spliced in twice, behind the pointer
 * media query and behind the attribute a finger's gesture sets (D84) - all
 * multiplied by the settings knob (D85). No browser runs here, so what can be
 * held is the system's shape: the two ways of saying "touch" name the same
 * sizes, every variable consumed is a variable defined, and the knob is never
 * read without its fallback. Each of these, broken, would show up only as a
 * bubble subtly wrong on one kind of device - exactly what no smoke test on
 * any single device can catch.
 */

/**
 * The text between a rule's opening brace and the first closing one - enough
 * for rules that nest nothing, which all of the measured ones are.
 *
 * @param {string} marker
 * @returns {string}
 */
function blockAfter(marker) {
  const start = STYLE.indexOf(marker);
  assert.notEqual(start, -1, `the stylesheet lost its "${marker}"`);
  // From `start`, not from the marker's end: a marker may name its own brace.
  const open = STYLE.indexOf("{", start);
  const close = STYLE.indexOf("}", open);
  return STYLE.slice(open + 1, close);
}

/**
 * @param {string} css
 * @returns {Map<string, string>}
 */
function declarations(css) {
  const out = new Map();
  for (const [, name, value] of css.matchAll(/--([a-z-]+)\s*:\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) out.set(name, value.trim());
  }
  return out;
}

const base = declarations(blockAfter(".bubble {"));
// The media query's own brace is the one `blockAfter` finds; the slice then
// runs into the `.bubble` rule inside it, whose declarations are what the
// regex picks up.
const byMedia = declarations(blockAfter("@media (pointer: coarse)"));
const byGesture = declarations(blockAfter('.bubble[data-pointer="coarse"]'));

describe("the bubble's size tiers", () => {
  it("says touch the same way twice: the media query and the gesture set the same sizes", () => {
    assert.ok(byMedia.size > 0, "the touch tier is empty");
    assert.deepEqual(byGesture, byMedia);
  });

  it("gives every touch-tier variable a desktop value to fall back to", () => {
    for (const name of byMedia.keys()) {
      assert.ok(base.has(name), `--${name} has no base value on .bubble`);
    }
  });

  it("never consumes a variable nobody defines", () => {
    for (const one of STYLE.matchAll(/var\(--([a-z-]+)/g)) {
      const name = one[1] ?? "";
      if (name === "bubble-scale") continue;
      assert.ok(base.has(name), `var(--${name}) is consumed but never defined on .bubble`);
    }
  });

  it("never reads the knob without its fallback: a page with no scale set is scale 1", () => {
    for (const one of STYLE.matchAll(/var\(--bubble-scale([^)]*)\)/g)) {
      assert.match(one[1] ?? "", /^\s*,/, "var(--bubble-scale) without a fallback");
    }
  });
});
