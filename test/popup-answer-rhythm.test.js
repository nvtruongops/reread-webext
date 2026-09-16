import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The rhythm of the look-up answer in the popup (D204): rows that only read
// give up the shelf's touch floor, the books' names keep theirs.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @param {string} path */
const sheet = (path) => readFileSync(join(ROOT, path), "utf8");

/**
 * @param {string} css
 * @param {string} selector
 * @returns {string}
 */
function rule(css, selector) {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

describe("the popup's look-up answer", () => {
  it("stands at a 32px floor, rows and names alike, from the shelf's own tokens", () => {
    const css = sheet("src/popup/popup.css");
    const answer = rule(css, ".popup-lookup-answer .lookup-answer");
    assert.match(answer, /--lookup-touch: 32px/);
    assert.match(answer, /--lookup-row-gap: 0\.3rem/);
    // No floor of the names' own: kept at 44px, a name stood 23px of it
    // over its text, and the gap under the phrase was the biggest thing on
    // the screen.
    assert.doesNotMatch(css, /--lookup-label-touch/);
    // And no air under the head: the shelf's room there is for the
    // standing line the popup does not draw.
    assert.match(rule(css, ".popup-lookup-answer .lookup-entries"), /margin-top: 0/);
  });

  it("leaves the shelf's reckoning to its one floor everywhere else", () => {
    const shelf = rule(sheet("src/assets/page.css"), ".lookup-answer");
    assert.match(shelf, /--lookup-label-pad-top: max\(var\(--lookup-row-pad\), calc\(var\(--lookup-touch\) - var\(--lookup-label-line\) - var\(--lookup-row-pad\)\)\)/);
    assert.match(shelf, /--lookup-row-pad: max\(var\(--lookup-row-gap\), calc\(\(var\(--lookup-touch\) - var\(--lookup-line-height, 1\.6em\)\) \/ 2\)\)/);
  });
});
