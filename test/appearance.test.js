import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyReading, applyTheme } from "../src/lib/appearance.js";
import { READER_DEFAULTS } from "../src/lib/config.js";

/**
 * Enough of a document root for the appearance rules: the dataset the
 * attributes land in, and a style that remembers what was set on it.
 *
 * @returns {{ dataset: Record<string, string | undefined>,
 *   style: { setProperty(name: string, value: string): void },
 *   properties: Record<string, string> }}
 */
function fakeRoot() {
  /** @type {Record<string, string>} */
  const properties = {};
  return {
    dataset: {},
    style: {
      setProperty(name, value) {
        properties[name] = value;
      },
    },
    properties,
  };
}

describe("applyTheme", () => {
  it("stamps the theme attribute the palettes key on", () => {
    const root = fakeRoot();
    applyTheme(root, "sepia");
    assert.equal(root.dataset["readerTheme"], "sepia");
  });

  it("stamps auto too - the value no palette matches", () => {
    // A page switched back to auto must lose the hand-set palette, and the
    // stamp of a value the CSS ignores is how the attribute never lingers.
    const root = fakeRoot();
    applyTheme(root, "dark");
    applyTheme(root, "auto");
    assert.equal(root.dataset["readerTheme"], "auto");
  });
});

describe("applyReading", () => {
  it("dresses paper, typeface and text size - and nothing else", () => {
    const root = fakeRoot();
    applyReading(root, { ...READER_DEFAULTS, theme: "dark", font: "sans", fontSize: 21 });
    assert.equal(root.dataset["readerTheme"], "dark");
    assert.equal(root.dataset["readerFont"], "sans");
    assert.deepEqual(root.properties, {
      "--reader-size": "21px",
      "--reader-font-lead": "var(--reader-font-stack)",
    });
    // The column's measure and the links mode are the reader page's own; a
    // list page handed them here by mistake must not start wearing them.
    assert.equal(root.dataset["readerLinks"], undefined);
  });

  it("puts the typed font in front of the stack, quoted, only when chosen", () => {
    // Since D163 the name leads only while the Type row says `custom`: a set
    // name no longer overrides a preset choice - it waits, kept, for the row
    // to ask. The name arrives clean from the config (quotes, backslashes
    // and control characters already out), so the quoting here is just
    // quoting - and the stack stays behind it for every character the named
    // font lacks.
    const root = fakeRoot();
    applyReading(root, { ...READER_DEFAULTS, font: "custom", fontFamily: "Iowan Old Style" });
    assert.equal(root.dataset["readerFont"], "custom");
    assert.equal(
      root.properties["--reader-font-lead"],
      '"Iowan Old Style", var(--reader-font-stack)',
    );

    applyReading(root, { ...READER_DEFAULTS, font: "serif", fontFamily: "Iowan Old Style" });
    assert.equal(root.properties["--reader-font-lead"], "var(--reader-font-stack)");
  });

  it("hands the property back to the stack when the choice leaves", () => {
    // Always written, never removed: RootLike has no removeProperty, and a
    // stale lead surviving the choice would be a setting that cannot be
    // undone. A `custom` that somehow arrives with no name (the config heals
    // it away, but this function may be called directly) leads nothing.
    const root = fakeRoot();
    applyReading(root, { ...READER_DEFAULTS, font: "custom", fontFamily: "Atkinson Hyperlegible" });
    applyReading(root, READER_DEFAULTS);
    assert.equal(root.properties["--reader-font-lead"], "var(--reader-font-stack)");

    applyReading(root, { ...READER_DEFAULTS, font: "custom", fontFamily: "" });
    assert.equal(root.properties["--reader-font-lead"], "var(--reader-font-stack)");
  });
});
