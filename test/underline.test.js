import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { withDefaults } from "../src/lib/config.js";
import {
  DEFAULT_UNDERLINE,
  UNDERLINE_NAMES,
  UNDERLINE_WEIGHTS,
  isUnderlineWeight,
  underlineName,
} from "../src/lib/underline.js";

/**
 * The underline's weights (D130), and the one thing about them no smoke test
 * on a single device can catch: a weight whose name the stylesheet has no rule
 * for. A highlight registered under an unstyled name paints *nothing* - the
 * phrases would quietly stop being underlined for whoever picked that step,
 * and only on their device.
 */
const sheet = await readFile(new URL("../src/content/highlight.css", import.meta.url), "utf8");

const THICKNESS = "text-decoration-thickness";
const COLOR = "text-decoration-color";

/**
 * How much of the page's ink a declared colour carries: the whole of it, or
 * the percentage the mix keeps.
 *
 * @param {string | null} color
 * @returns {number}
 */
function inkStrength(color) {
  if (color === "currentColor") return 100;
  return Number.parseFloat(/currentColor (\d+)%/.exec(color ?? "")?.[1] ?? "");
}

/**
 * What a highlight name ends up with for one property, read the way the
 * cascade reads it: every rule whose selector names it, in file order, last
 * one wins. The stylesheet nests nothing, so a rule is a selector list and
 * one flat block.
 *
 * @param {string} name the highlight registration's name
 * @param {string} property
 * @returns {string | null}
 */
function declared(name, property) {
  /** @type {string | null} */
  let value = null;
  const plain = sheet.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!String(rule[1]).includes(`::highlight(${name})`)) continue;
    const found = new RegExp(`${property}:\\s*([^;]+);`).exec(String(rule[2]));
    if (found !== null) value = String(found[1]).trim();
  }
  return value;
}

describe("the underline's weights", () => {
  it("offers three, lightest first, and starts in the middle", () => {
    assert.deepEqual([...UNDERLINE_WEIGHTS], ["fine", "medium", "strong"]);
    // D133, after a day on an e-ink panel: the line the screen swallows is
    // not the one to hand somebody who has chosen nothing.
    assert.equal(DEFAULT_UNDERLINE, "medium");
  });

  it("has a rule in the stylesheet for every weight", () => {
    for (const weight of UNDERLINE_WEIGHTS) {
      assert.ok(
        sheet.includes(`::highlight(${underlineName(weight)})`),
        `highlight.css no longer styles ::highlight(${underlineName(weight)})`,
      );
    }
  });

  it("draws every weight in the page's own ink, never in a colour of ours", () => {
    // The rule the whole stylesheet stands on: a fixed colour is a compromise
    // between light pages and dark ones, and a compromise that reads
    // everywhere is loud somewhere.
    for (const name of UNDERLINE_NAMES) {
      assert.match(
        declared(name, COLOR) ?? "",
        /^(currentColor|color-mix\(in srgb, currentColor \d+%, transparent\))$/,
        `${name} stopped drawing in the page's own ink`,
      );
    }
  });

  it("gets heavier with every step, in both of its two numbers", () => {
    // One dial, two numbers: a thicker line in the same faint ink would still
    // be faint on the panel that asked for the change. Read the way a browser
    // reads it - the shared rule first, each weight's own block after it.
    const steps = UNDERLINE_NAMES.map((name) => ({
      name,
      thickness: Number.parseFloat(declared(name, THICKNESS) ?? ""),
      ink: inkStrength(declared(name, COLOR)),
    }));

    /** @type {(typeof steps)[number] | null} */
    let lighter = null;
    for (const step of steps) {
      assert.ok(Number.isFinite(step.thickness), `${step.name} says nothing about its line`);
      assert.ok(Number.isFinite(step.ink), `${step.name} says nothing about its ink`);
      if (lighter !== null) {
        assert.ok(step.thickness > lighter.thickness, `${step.name} is not the thicker line`);
        assert.ok(step.ink > lighter.ink, `${step.name} is not the stronger ink`);
      }
      lighter = step;
    }
  });

  it("knows a weight from anything else a stored setting could hold", () => {
    for (const weight of UNDERLINE_WEIGHTS) assert.equal(isUnderlineWeight(weight), true);
    for (const other of ["", "bold", "FINE", 2, null, undefined, {}]) {
      assert.equal(isUnderlineWeight(other), false, String(other));
    }
  });
});

describe("the underline in the settings", () => {
  it("is the middle weight when nothing has been stored", () => {
    assert.equal(withDefaults(undefined).underline, DEFAULT_UNDERLINE);
    assert.equal(withDefaults({}).underline, DEFAULT_UNDERLINE);
  });

  it("keeps a weight this version knows, the old default included", () => {
    assert.equal(withDefaults({ underline: "strong" }).underline, "strong");
    // The whisper `fine` was the default until D133; a profile that pressed
    // it keeps it, which is the whole point of storing a press.
    assert.equal(withDefaults({ underline: "fine" }).underline, "fine");
  });

  it("falls back rather than paint under a name nothing styles", () => {
    // A weight from a future version, or a hand-edited profile: a
    // registration the stylesheet has no rule for underlines nothing at all,
    // so the setting must never survive into the paint.
    for (const stored of ["heavy", "", 3, true, null]) {
      assert.equal(withDefaults({ underline: stored }).underline, DEFAULT_UNDERLINE, String(stored));
    }
  });
});
