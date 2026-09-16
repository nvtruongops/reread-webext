import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The popup's "Open in reading view" row (D201): a label short enough for
// one line in six languages, a glyph at the first line of its label when
// the label wraps, and a row that goes quiet over a page nothing listens
// in. Read from the sources, since the popup only exists in a browser.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = ["en", "pl", "de", "fr", "es", "uk"];

/** The most a label may be to stay one line at the popup's width, in every language. */
const LABEL_LIMIT = 26;

/**
 * @param {string} sheet
 * @param {string} selector
 * @returns {string}
 */
function rule(sheet, selector) {
  const at = sheet.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

describe("the reading view's row in the popup", () => {
  it("wears a label of at most 26 characters in every language, naming the act", () => {
    for (const locale of LOCALES) {
      const catalogue = JSON.parse(readFileSync(join(ROOT, "src/_locales", locale, "messages.json"), "utf8"));
      const label = String(catalogue.open_reader.message);
      assert.ok([...label].length <= LABEL_LIMIT, `${locale}: "${label}" is ${[...label].length} characters`);
      // The popup is always about the page it opened over: no "this page".
      assert.doesNotMatch(label, /this page|tę stronę|diese Seite|cette page|esta página|цю сторінку/i);
    }
  });

  it("keeps its glyph at the first line of the label, the heart the same", () => {
    const css = readFileSync(join(ROOT, "src/popup/popup.css"), "utf8");
    const rows = rule(css, ".popup-reader,\n.popup-support");
    assert.match(rows, /align-items: flex-start/);
    // Padded to the touch floor from the line's height - the floor less the
    // row's own 1px line, which the border box counts - so a one-line row
    // is centred exactly as it was under `align-items: center`, at 44px.
    assert.match(rows, /padding-block: max\(0\.55rem, calc\(\(43px - var\(--popup-line-height\)\) \/ 2\)\)/);
    const icon = rule(css, ".popup-icon");
    assert.match(icon, /margin-top: calc\(\(var\(--popup-line-height, 1\.6em\) - var\(--popup-icon-size\)\) \/ 2\)/);
  });

  it("goes quiet over a page nothing listens in, and stays in place", () => {
    const script = readFileSync(join(ROOT, "src/popup/index.js"), "utf8");
    const site = script.slice(script.indexOf("function renderSite("), script.indexOf("async function toggleSite("));
    const silent = site.slice(site.indexOf("if (info === null) {"), site.indexOf("over.hostname = info.hostname"));
    assert.match(silent, /siteNote\.hidden = false/);
    assert.match(silent, /readerButton\.disabled = true/);
    // Quiet, not gone: a row that left would move the rows below it (D194).
    assert.doesNotMatch(silent, /readerButton\.hidden = true/);
    // And back to life over a page that answered.
    assert.match(site.slice(site.indexOf("over.hostname = info.hostname")), /readerButton\.disabled = false/);
    // In the theme's disabled grey - neutral, the convention for a control
    // that cannot be pressed - not the notes' muted ink, which the note
    // above the row already wears, and not the lines' token, brown on the
    // sepia paper.
    const css = readFileSync(join(ROOT, "src/popup/popup.css"), "utf8");
    const quiet = rule(css, ".popup-reader:disabled,\n.popup-reader:disabled:hover,\n.popup-reader:disabled .popup-icon");
    assert.match(quiet, /color: var\(--page-disabled\)/);
    assert.doesNotMatch(quiet, /--page-muted|--page-line/);
    // The token stands in every theme block of the pages' sheet: the root
    // light, the dark media block, the three named themes.
    const page = readFileSync(join(ROOT, "src/assets/page.css"), "utf8");
    assert.equal(page.match(/--page-disabled: #[0-9a-f]{6};/g)?.length, 5);
    assert.equal(page.match(/--page-border: #[0-9a-f]{6};/g)?.length, 5);
  });
});
