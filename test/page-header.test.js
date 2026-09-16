import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The bar stuck to the top of every page (D219): the reading list, the
 * highlights, the saved phrases and the settings wear the article view's
 * stuck box now - one `.page-chrome` in page.css, the reader's own class
 * kept for what only the article view does (the ribbon that folds the bar
 * away). Its height is a token the pages lean on: `scroll-padding-top`
 * keeps anchors and focused rows out from under the bar, and the bar's box
 * takes the token as its height outright, so the number and the bar on
 * screen cannot quietly part. The rules are markup and stylesheets, so this
 * reads them the way `reader-fullscreen-tool` does.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * The declarations of one rule, found by its selector standing alone on a
 * line - the first such rule in the sheet.
 *
 * @param {string} styles
 * @param {string} selector
 */
function ruleOf(styles, selector) {
  const at = styles.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return styles.slice(at, styles.indexOf("}", at));
}

describe("the bar stuck to the top of every page", () => {
  it("is one box in one home: stuck at the window's top, on its own paper, above the page, with no transition", async () => {
    const box = ruleOf(await source("assets/page.css"), ".page-chrome");
    assert.match(box, /position: sticky;/, "the box scrolls away with the page");
    assert.match(box, /top: 0;/, "the box sticks somewhere below the window's top");
    assert.match(box, /background: var\(--page-bg\);/, "the page would show through the stuck box");
    // Above the scrim (1) and above everything in a list - the highlighter's
    // pins and badges stand at 0 for this reason.
    assert.match(box, /z-index: 2;/, "the box lost its place over the scrim and the lists");
    assert.match(box, /padding-top: var\(--header-air\);/, "the stuck box holds no paper over the bar");
    assert.doesNotMatch(box, /transition/, "the box animates, which an e-ink panel draws as a smear");
    // The bar rests exactly where it sticks: the page's whole headroom is
    // the box's own paper, and the body keeps none - with half of it on
    // the body the box slid up by that half on the first scroll (Michał's
    // report, 2026-09-14).
    assert.match(ruleOf(await source("assets/page.css"), "body:has(> .page-chrome)"), /padding-top: 0;/, "the body keeps headroom over the box, which the first scroll eats");
    for (const [path, selector] of /** @type {[string, string][]} */ ([
      ["reader/reader.css", "body.reader"],
      ["vocab/vocab.css", "body"],
      ["options/options.css", "body"],
    ])) {
      assert.doesNotMatch(ruleOf(await source(path), selector), /padding-top/, `${path}: the body keeps a top padding of its own over the box`);
    }
  });

  it("is the reader's box on the reading list and the highlights too, the folding kept to the article view", async () => {
    const markup = await source("reader/reader.html");
    assert.match(markup, /<div class="reader-chrome page-chrome">/, "the reader's box does not wear the shared class");
    assert.match(markup, /<header class="reader-bar page-bar">/, "the reader's bar does not wear the shared class");
    const styles = await source("reader/reader.css");
    assert.doesNotMatch(styles, /position: sticky/, "the reader sticks a box of its own beside the shared one");
    assert.doesNotMatch(styles, /\n\.reader-chrome \{/, "the reader dresses its box twice");
    assert.doesNotMatch(styles, /\n\.reader-bar \{/, "the reader dresses its bar twice");
    // The ribbon folds the bar only over an article: a list keeps its whole
    // chrome, and the shared rule must not fold it.
    assert.match(
      styles,
      /:root\[data-reader-chrome="hidden"\] body\.reader:has\(#article:not\(\[hidden\]\)\) \.reader-chrome > :not\(\.chrome-tab\) \{\s*display: none;/,
      "the bar folds away outside the article view",
    );
    for (const page of ["vocab/vocab.html", "options/options.html"]) {
      const other = await source(page);
      assert.match(other, /<div class="page-chrome">/, `${page} has no shared box`);
      assert.match(other, /<div class="page-bar">/, `${page} has no shared bar`);
    }
  });

  it("has a height the stylesheet knows, as one token every page shares, which the bar's box takes outright", async () => {
    const styles = await source("assets/page.css");
    assert.match(styles, /--header-h: calc\(var\(--header-air\) \+ var\(--bar-h\)\);/, "the bar's reach is not one token");
    const bar = ruleOf(styles, ".page-bar");
    assert.match(bar, /height: var\(--bar-h\);/, "the bar's box is left to measure itself");
    assert.match(bar, /border-bottom: 1px solid var\(--page-line\);/, "the line under the bar is not the separators' token");
    assert.doesNotMatch(bar, /transition/, "the bar animates");
    // The bar is interface (D104): nothing in it follows the Aa panel's size.
    assert.doesNotMatch(bar, /--reader-size/, "the bar's height follows the text size");
    // The floor the token counts is the floor the tools stand on, on every
    // page - the reader's tools keep their own rule and must stand on the
    // same number.
    const parts = /--bar-h: calc\((\d+(?:\.\d+)?rem) \+ (\d+(?:\.\d+)?rem) \+ 1px\);/.exec(styles);
    assert.ok(parts !== null, "the bar's height is not the tools' floor, the air under them and the line");
    const [, floor, air] = parts;
    assert.match(ruleOf(styles, ".page-tools > button"), new RegExp(`min-height: ${floor};`), "the tools stand on another floor than the token counts");
    assert.match(bar, new RegExp(`padding-bottom: ${air};`), "the air under the tools is not what the token counts");
    // The reader's tools stand in the same frame: its span wears the class
    // (D221), and no floor of the reader's own is left to drift.
    assert.match(await source("reader/reader.html"), /<span class="reader-tools page-tools">/, "the reader's tools do not stand in the shared frame");
    const reader = await source("reader/reader.css");
    assert.doesNotMatch(reader, /#menu \{[^}]*min-height/, "the reader keeps a floor of its own for its tools");
    // And the tight dress under a phone's width is the shared bar's too:
    // kept as the reader's own, it left the phrases' tools a desktop's
    // distance apart on the same phone (Michał's screenshots, 2026-09-14).
    assert.doesNotMatch(reader, /\n\s*\.reader-tools \{|\n\s*\.reader-bar \{/, "the reader dresses its bar or its tools twice");
    assert.match(styles, /@media \(max-width: 30rem\) \{\s*\.page-bar \{\s*gap: 0\.5rem;\s*\}\s*\.page-tools \{\s*gap: 0\.4rem;/, "the bar has no tight dress under a phone's width shared by every page");
  });

  it("says a tool in hand by a real wash alone, so that 16 greys keep it and the bar stays quiet, on every page's bar", async () => {
    const styles = await source("assets/page.css");
    const lit = ruleOf(styles, '.page-tools > button[aria-pressed="true"],\n.page-tools > button[aria-expanded="true"]');
    // A quarter of the accent lands two greys under the paper; 12% rounded
    // back into it (Michał's photo from the Boox, 2026-09-14).
    const wash = /background: color-mix\(in srgb, var\(--page-accent\) (\d+)%, transparent\);/.exec(lit);
    assert.ok(wash !== null, "the lit tool has no wash of the accent");
    assert.ok(Number(wash[1]) >= 25, `the lit tool's wash is ${wash[1]}% of the accent - back to invisible on e-ink`);
    // The frame stays the frame: D221's doubled accent ring was too loud
    // for a bar over an article (Michał's second photo from the Boox,
    // 2026-09-14) - the wash is the one signal.
    assert.doesNotMatch(lit, /border-color|box-shadow|outline/, "the lit tool wears a frame of its own");
    assert.doesNotMatch(lit, /transition/, "the lit state animates");
    // One rule for every page's bar: the reader keeps none of its own.
    assert.doesNotMatch(await source("reader/reader.css"), /#marker\[aria-pressed="true"\]/, "the reader lights its tools by a rule of its own");
    // The full-screen tool is not lit: its glyph turns inward while the
    // page has the screen, and a wash on top of it lit the bar for the
    // whole of a reading for nothing.
    assert.doesNotMatch(styles, /:root:fullscreen #fullscreen(?:,|\s*\{)/, "the full-screen tool is lit in full screen, on top of its own glyph");
  });

  it("tells the browser where the visible page begins, so anchors, focus and the pages' own scrolls land under the bar, not behind it", async () => {
    const styles = await source("assets/page.css");
    const padding = ruleOf(styles, ":root:has(.page-chrome)");
    assert.match(padding, /scroll-padding-top: calc\(var\(--header-h\) \+ 0\.25rem\);/, "the root's scroll padding is not the bar's reach and a breath");
    // The landing pads every anchor keeps add their air on top of the
    // padding; none of them may have grown into the bar's own measure.
    for (const [path, selector] of /** @type {[string, string][]} */ ([
      ["options/options.css", "h2"],
      ["vocab/vocab.css", ".filter-status"],
      ["vocab/vocab.css", ".transfer-section"],
      ["reader/reader.css", ".marks-transfer"],
      ["reader/reader.css", ".transfer-section"],
    ])) {
      assert.match(ruleOf(await source(path), selector), /scroll-margin-top: 0\.75rem;/, `${selector} in ${path} lost its landing pad`);
    }
    // The pages' own scrolls aim at the top of what they show and let the
    // padding place it: no arithmetic of their own against the bar.
    const reader = await source("reader/reader.js");
    assert.match(reader, /libraryRows\?\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\)/, "a turned page of the list no longer starts at its top");
    assert.match(reader, /marksRowsList\?\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\)/, "a turned page of the highlights no longer starts at its top");
    assert.match(await source("vocab/vocab.js"), /filterStatus\.scrollIntoView\(\{ block: "start" \}\)/, "\"Show in list\" no longer lands on the filter's line");
    // The shelf's fold measures the visible page from the same number: a
    // book's name under the bar is out of view as much as one past the
    // window's top.
    const shelf = await source("lib/lookup-shelf.js");
    assert.match(shelf, /book\.getBoundingClientRect\(\)\.top < coveredTop\(\)/, "the shelf's fold measures the visible page from the window's edge");
    assert.match(shelf, /getComputedStyle\(document\.documentElement\)\.scrollPaddingTop/, "the shelf's fold does not read the root's scroll padding");
  });

  it("leaves the article view to its own arithmetic: no scroll padding over an article", async () => {
    const styles = await source("reader/reader.css");
    const standDown = ruleOf(styles, ":root:has(body.reader #article:not([hidden]))");
    assert.match(standDown, /scroll-padding-top: auto;/, "the article view keeps the list views' scroll padding");
    // The position restore steps back from `scrollIntoView` by the bar's
    // measure; with the padding standing it would step back twice.
    const reader = await source("reader/reader.js");
    assert.match(reader, /block\.scrollIntoView\(\{ behavior: "instant", block: "start" \}\);\s*(?:\/\/[^\n]*\n\s*)*scrollBy\(0, -chromeFold\(\)\);/, "the position restore no longer steps back from under the bar by its own measure");
  });

  it("is the one stuck strip over a list: the selection's bar scrolls with the rows, under it", async () => {
    const styles = await source("reader/reader.css");
    const bar = ruleOf(styles, ".pick-bar");
    assert.doesNotMatch(bar, /position:/, "the selection's bar is stuck or lifted - a second strip of chrome over the list");
    assert.doesNotMatch(bar, /z-index:/, "the selection's bar carries a stacking of its own, which could paint over the stuck bar");
    // Nothing else on the page is stuck: the speech bar is fixed at the
    // bottom of the article view, and the two never meet.
    assert.equal((styles.match(/position: (?:sticky|fixed)/g) ?? []).length, 1, "a third strip of chrome is stuck or fixed on the reader page");
  });

  it("holds nothing any more: the hold module went with the offset it measured", async () => {
    await assert.rejects(source("lib/chrome-hold.js"), "the hold module is still in the package");
    for (const path of ["assets/page.css", "reader/reader.css", "reader/reader.js", "vocab/vocab.js", "options/options.js"]) {
      assert.doesNotMatch(await source(path), /--chrome-hold|holdChrome/, `${path} still holds the chrome`);
    }
  });
});
