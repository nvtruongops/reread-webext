import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * A row of the saved-phrases page as the compact layout round (D211) laid
 * it out: three parts in one order at every width - the head with the
 * phrase and its counts, the body with the meanings and the sentence, the
 * actions last - the counts as glyphs with a number, a legend over the
 * list, the actions on the phrase's line. Read at the call sites, the way
 * the filter's state line is tested: what the DOM order and the sheet
 * promise is exactly what a smoke test in one browser cannot prove for the
 * others.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

/**
 * One CSS rule's declarations, by the exact selector line that opens it.
 *
 * @param {string} css
 * @param {string} selector
 * @returns {string}
 */
function rule(css, selector) {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `no rule for ${selector}`);
  return css.slice(at, css.indexOf("}", at));
}

describe("a row of the saved phrases", () => {
  it("is built head, body, actions - the order the keyboard and a screen reader walk", async () => {
    const row = bodyOf(await source("vocab/vocab.js"), "phraseRow");
    const head = row.indexOf('element("div", "phrase-head")');
    const body = row.indexOf('element("div", "phrase-body")');
    const actions = row.indexOf('element("div", "phrase-actions")');
    assert.ok(head !== -1 && body !== -1 && actions !== -1, "a part of the row is missing");
    assert.ok(head < body && body < actions, "the parts are not built head, body, actions");
    // The phrase and its counts share the head; the meanings and the
    // sentence share the body - the same order on a phone and on a desktop.
    assert.match(row, /head\.append\(word\)/, "the phrase does not stand in the head");
    assert.match(row, /body\.append\(meanings\)/, "the meanings do not stand in the body");
    // At rest the sentence stands in the body under the meanings; unfolded,
    // it follows Save and Cancel (the editor is one unit, the sentence the
    // context under it), on the screen and for the keyboard alike.
    assert.match(row, /fold = element\("details", "phrase-sentence"\);/, "the sentence is not a fold");
    assert.match(row, /if \(editActions === null && fold !== null\) body\.append\(fold\);/, "the sentence does not stand in the body at rest");
    assert.match(row, /row\.append\(head\);[\s\S]*row\.append\(body\);[\s\S]*row\.append\(actions\)/, "the row is not appended head, body, actions");
  });

  it("lays the row out as one wrapping line on a phone and three columns from 50rem", async () => {
    const styles = await source("vocab/vocab.css");
    const phone = rule(styles, ".phrase-row");
    assert.match(phone, /display: flex;\s*flex-wrap: wrap;/, "the phone row is not a wrapping line");
    // The head takes its own width and grows; the actions wrap under it
    // only when the phrase's own width plus the buttons will not fit - a
    // fixed floor on the head would drop them under every phrase at 360px.
    assert.match(rule(styles, ".phrase-head"), /order: 1;\s*flex: 1 1 auto;\s*min-width: 0;/, "the head does not grow from its own width");
    assert.match(rule(styles, ".phrase-actions"), /order: 2;[\s\S]*margin-inline-start: auto;/, "the actions do not stand at the line's end");
    assert.match(rule(styles, ".phrase-body"), /order: 3;\s*flex: 1 1 100%;/, "the body does not take the next line whole");
    // Breakpoints in rem like the pager's, none in px. The grid waits for
    // the column to be as wide as it gets (the 46rem body plus its padding
    // is 49rem): three named areas, the meanings three parts to the
    // phrase's one, the actions out of the baseline group.
    assert.doesNotMatch(styles, /@media \(min-width: 600px\)/, "a breakpoint in px survives");
    assert.match(styles, /@media \(min-width: 40rem\)/, "the title's select and the transfer buttons lost their query");
    const desktop = styles.slice(styles.indexOf("@media (min-width: 50rem)"));
    assert.notEqual(desktop.length, 0, "no 50rem breakpoint for the grid");
    assert.doesNotMatch(styles.slice(styles.indexOf("@media (min-width: 40rem)"), styles.indexOf("@media (min-width: 50rem)")), /display: grid/, "the grid stands under 50rem, where the meanings' column is squeezed");
    assert.match(rule(desktop, "  .phrase-row"), /display: grid;\s*grid-template-columns: minmax\(10rem, 1fr\) minmax\(0, 3fr\) auto;\s*grid-template-areas: "head body actions";[\s\S]*align-items: baseline;/, "the desktop row is not the three-column grid");
    assert.match(rule(desktop, "  .phrase-actions"), /grid-area: actions;\s*align-self: start;/, "the actions are not at the row's top, out of the baseline group");
  });

  it("stacks the filter and the order under a phone's width, each the whole line", async () => {
    const styles = await source("vocab/vocab.css");
    const narrow = styles.slice(styles.indexOf("@media (max-width: 30rem)"), styles.indexOf("@media (min-width: 40rem)"));
    assert.notEqual(narrow.length, 0, "no 30rem query");
    assert.match(narrow, /\.filter-line \{\s*flex-wrap: wrap;/, "the filter line does not wrap");
    // The field's flex child is the cross's wrapper, not the input.
    assert.match(narrow, /\.filter-line > \.clear-field \{\s*flex-basis: 100%;/, "the field does not take the whole line");
    assert.match(narrow, /\.filter-line select \{\s*flex: 1 1 100%;\s*max-width: none;\s*margin-inline-start: 0;/, "the order select keeps its 45% cap under the field");
  });

  it("shows a count as a glyph and a number, the whole sentence in its name, and no count at zero", async () => {
    const script = await source("vocab/vocab.js");
    const row = bodyOf(script, "phraseRow");
    // Each count only above zero, the group only when one is; the sentence
    // the catalogue counts with is the accessible name and the hover title.
    assert.match(row, /if \(recalls > 0 \|\| reads > 0\) \{\s*const counts = element\("span", "phrase-counts"\);\s*if \(recalls > 0\) counts\.append\(countStat\("i-lookup", recalls, plural\(recalls, "vocab_recalls"\)\)\);\s*if \(reads > 0\) counts\.append\(countStat\("i-read", reads, plural\(reads, "vocab_reads"\)\)\);\s*head\.append\(counts\);/, "the counts are not two glyph stats in the head, each only above zero");
    const stat = bodyOf(script, "countStat");
    assert.match(stat, /setAttribute\("role", "img"\)/, "a stat is not one image to assistive tech");
    assert.match(stat, /setAttribute\("aria-label", said\);\s*stat\.title = said;/, "the sentence is not the stat's name and title");
    assert.match(stat, /stat\.append\(countIcon\(glyph\), count\.toLocaleString\(\)\)/, "the stat is not the glyph with the number after it");
    const icon = bodyOf(script, "countIcon");
    assert.match(icon, /setAttribute\("aria-hidden", "true"\)/, "the glyph speaks");
    assert.match(icon, /use\.setAttribute\("href", `#\$\{glyph\}`\)/, "the glyph is not a use of the sprite");
    // The sprite carries exactly the two symbols the rows and the legend use.
    const markup = await source("vocab/vocab.html");
    assert.match(markup, /<svg class="icon-sprite" aria-hidden="true" focusable="false">[\s\S]*?<symbol id="i-lookup" viewBox="0 0 16 16">[\s\S]*?<symbol id="i-read" viewBox="0 0 16 16">/, "the sprite does not carry the two symbols");
    assert.doesNotMatch(markup, /icon-sprite" style=/, "the sprite hides by an inline style");
    // In the sprite every stroke is the current ink, so the glyphs follow
    // the counts' color in every theme.
    const sprite = markup.slice(markup.indexOf('<svg class="icon-sprite"'), markup.indexOf("</svg>", markup.indexOf('<svg class="icon-sprite"')));
    for (const stroke of sprite.matchAll(/stroke="([^"]+)"/g)) assert.equal(stroke[1], "currentColor");
  });

  it("keys the glyphs in one line over the list, shown only while a row has a count to explain", async () => {
    const markup = await source("vocab/vocab.html");
    const legend = markup.indexOf('id="legend"');
    assert.notEqual(legend, -1, "the page has no legend");
    assert.ok(markup.indexOf('id="filter-status"') < legend && legend < markup.indexOf('id="list"'), "the legend does not stand between the filter's state line and the list");
    assert.match(markup, /id="legend" class="phrase-legend" hidden/, "the legend stands before the script decides");
    // The two words are the order select's; a glyph and its word never part.
    assert.match(markup, /<use href="#i-lookup" \/><\/svg><span data-i18n="vocab_legend_recalls">/, "the magnifier is parted from its word, or the word is not the catalogue's");
    assert.match(markup, /<use href="#i-read" \/><\/svg><span data-i18n="vocab_legend_reads">/, "the book is parted from its word, or the word is not the catalogue's");
    const script = await source("vocab/vocab.js");
    assert.match(bodyOf(script, "renderList"), /legendLine\.hidden = !anyCounted\(view\.rows\)/, "the legend does not follow the rows on the page");
    // The counts and the legend wear the interface's size, not the Aa panel's.
    const styles = await source("vocab/vocab.css");
    assert.match(rule(styles, ".phrase-counts"), /font-size: max\(13px, 0\.85rem\);/, "the counts do not wear the interface size");
    // And the interface face, said outright: the head around them wears
    // the reading face, and Georgia's oldstyle figures are no digits for
    // a 13px count on e-ink.
    assert.match(rule(styles, ".phrase-counts"), /font-family: system-ui, -apple-system, "Segoe UI", sans-serif;/, "the digits inherit the reading face from the head");
    assert.match(rule(styles, ".phrase-legend"), /font-size: max\(13px, 0\.85rem\);/, "the legend does not wear the counts' size");
    assert.match(rule(styles, ".phrase-count-icon"), /width: 1em;\s*height: 1em;\s*vertical-align: -0\.15em;\s*margin-inline-end: 0\.25em;/, "the glyph is not an em on the baseline with its number a quarter em after");
  });

  it("lights the phrase inside its opened sentence, and keeps the closed line quiet", async () => {
    const row = bodyOf(await source("vocab/vocab.js"), "phraseRow");
    // The sentence is built from segments as text nodes and marks - never
    // markup, the text is a page's - with the phrase's first occurrence lit.
    assert.match(row, /for \(const segment of sentenceSegments\([^)]*phrase\.context\), phrase\.phrase\)\) \{\s*if \(segment\.hit\) \{\s*const mark = document\.createElement\("mark"\);\s*mark\.textContent = segment\.text;/, "the sentence is not segmented around the phrase into text and marks");
    assert.doesNotMatch(row, /fillHighlighted\(summary/, "the filter's marks reach into the sentence");
    const styles = await source("vocab/vocab.css");
    // Only once open: a lit word in the one-line preview would read as a
    // filter hit the filter never made.
    assert.match(rule(styles, ".phrase-sentence:not([open]) mark"), /background: none;\s*color: inherit;\s*text-decoration: none;/, "the closed preview lights the phrase");
    // The press is tall enough for a finger without parting the sentence
    // from the meanings.
    assert.match(rule(styles, ".phrase-sentence > summary"), /padding-block: 0\.25rem;/, "the summary is not a 32px press at the smallest reading size");
    // The opened sentence keeps a measure on the stacked layout, where the
    // body is the whole column.
    assert.match(rule(styles, ".phrase-sentence[open] > summary"), /max-width: 65ch;/, "the opened sentence runs the whole column");
  });

  it("fits the three quiet actions to the phrase's line: 44px to press, no taller than the text", async () => {
    const styles = await source("vocab/vocab.css");
    const buttons = rule(styles, ".phrase-actions > button.quiet");
    assert.match(buttons, /min-height: 44px;\s*min-width: 44px;/, "a row's button is under the touch floor");
    // The margin box is exactly the phrase's line box at every reading
    // size: half of what 44px has over the line, taken back above and below.
    assert.match(buttons, /margin-block: calc\(\(var\(--reader-size, 18px\) \* var\(--phrase-line-height\) - 44px\) \/ 2\);/, "the buttons' height is not given back to the line");
    assert.match(buttons, /white-space: nowrap;/, "a label may break");
    // No gap in the cluster - the padding is the room - and the last label
    // ends on the list's edge.
    assert.doesNotMatch(rule(styles, ".phrase-actions"), /gap:/, "the cluster keeps a gap beyond the buttons' padding");
    assert.match(buttons, /padding: 0 0\.4rem;/, "the buttons' padding is not the narrow one three of them need on a 360px line");
    assert.match(rule(styles, ".phrase-actions > button.quiet:last-child"), /margin-inline-end: calc\(-0\.4rem - 1px\);/, "the last button does not hand its padding to the gutter");
    // The interface size, not the Aa panel's: the shared quiet dress says
    // 0.85rem and nothing in the row's rules overrides it with the reading size.
    assert.match(rule(styles, "button.quiet"), /font-size: 0\.85rem;/, "the quiet buttons do not wear the interface size");
    assert.doesNotMatch(buttons, /font-size/, "the row's buttons change the shared size");
  });

  it("unfolds a row into the same three parts: the box in the body, Save and Cancel in the actions' slot", async () => {
    const script = await source("vocab/vocab.js");
    const row = bodyOf(script, "phraseRow");
    assert.match(row, /const unfolded = editorFor\(phrase\);\s*body\.append\(unfolded\.editor\);\s*editActions = unfolded\.actions;\s*row\.dataset\["editing"\] = "true";/, "the editor does not split into the body and the actions' slot");
    // Save and Cancel follow the body, and the sentence follows them: the
    // box with its hint and the two buttons are one unit, the sentence the
    // context under it (Michał's screenshot, 2026-09-14: on a phone the
    // buttons under the sentence read as the row's, not the box's).
    assert.match(row, /if \(editActions !== null\) \{\s*row\.append\(editActions\);\s*if \(fold !== null\) row\.append\(fold\);\s*return row;\s*\}/, "the unfolded row is not box, Save and Cancel, sentence");
    const editor = bodyOf(script, "editorFor");
    assert.match(editor, /return \{ editor: wrap, actions \};/, "editorFor does not hand back the two pieces");
    assert.doesNotMatch(editor, /wrap\.append\([^)]*actions\)/, "Save and Cancel are still inside the edit box");
    const styles = await source("vocab/vocab.css");
    // On a phone the two go under the box, the whole line to themselves,
    // and the sentence takes the line after them.
    assert.match(rule(styles, '.phrase-row[data-editing="true"] > .phrase-actions'), /order: 4;\s*flex: 1 1 100%;/, "on a phone Save and Cancel do not take the line under the box");
    assert.match(rule(styles, '.phrase-row[data-editing="true"] > .phrase-actions > button'), /min-height: 44px;/, "Save and Cancel are under the touch floor");
    assert.match(rule(styles, '.phrase-row[data-editing="true"] > .phrase-sentence'), /order: 5;\s*flex: 1 1 100%;/, "on a phone the sentence does not take the line after Save and Cancel");
    // On a desktop the head and the body leave the baseline group, and the
    // sentence takes a second grid row in the meanings' column.
    const desktop = styles.slice(styles.indexOf("@media (min-width: 50rem)"));
    assert.match(desktop, /\.phrase-row\[data-editing="true"\] > \.phrase-head,\s*\.phrase-row\[data-editing="true"\] > \.phrase-body \{\s*align-self: start;/, "the phrase aligns to the textarea's bottom edge");
    assert.match(desktop, /\.phrase-row\[data-editing="true"\] \{\s*grid-template-areas:\s*"head body actions"\s*"\. sentence \.";/, "the unfolded row's grid has no row for the sentence");
    assert.match(rule(desktop, '  .phrase-row[data-editing="true"] > .phrase-sentence'), /grid-area: sentence;/, "the sentence does not stand in the meanings' column under the box");
  });

  it("keeps the hint close under the box and the actions' hit box inside the row", async () => {
    const styles = await source("vocab/vocab.css");
    // The hint is a footnote to the box: the column's gap alone parts them.
    assert.match(rule(styles, ".phrase-edit"), /gap: 0\.3rem;/, "the box and its hint stand apart");
    assert.match(rule(styles, ".phrase-edit-hint"), /margin: 0;/, "the hint adds a margin of its own to the gap");
    // On a phone the box stands half a rem under the phrase's line, so its
    // focus ring (4px outside the box) clears the phrase's descenders; on a
    // desktop the phrase is beside the box and the air is taken back.
    assert.match(rule(styles, '.phrase-row[data-editing="true"] > .phrase-body'), /margin-block-start: 0\.5rem;/, "the box's focus ring sits on the phrase's descenders on a phone");
    const desktop = styles.slice(styles.indexOf("@media (min-width: 50rem)"));
    // Its own rule, not the one it shares with the head (which only leaves
    // the baseline group).
    assert.match(desktop, /\n  \.phrase-row\[data-editing="true"\] > \.phrase-body \{\s*margin-block-start: 0;/, "on a desktop the box drops under the phrase's first line");
    // The row's padding grows with what the buttons' 44px box has over
    // the phrase's line, plus a hairline: at a flat 0.5rem the box reached
    // the separator and drew its hover frame over it.
    assert.match(
      rule(styles, ".phrase-row"),
      /padding-block: max\(0\.5rem, calc\(\(44px - var\(--reader-size, 18px\) \* var\(--phrase-line-height\)\) \/ 2 \+ 1px\)\);/,
      "the row's padding does not hold the actions' hit box",
    );
  });

  it("dresses the phrase, the meanings and the sentence in the Aa panel's size, and nothing above them", async () => {
    const styles = await source("vocab/vocab.css");
    const bare = styles.replace(/\/\*[\s\S]*?\*\//g, "");
    // The reading size is set on the content elements themselves; a
    // container carrying it would hand it to the counts and the buttons.
    // Reading the size for arithmetic is another matter: the row's padding
    // counts the phrase's line against the buttons' 44px box.
    for (const selector of [".phrase-row", ".phrase-body", ".phrases"]) {
      assert.doesNotMatch(rule(bare, selector), /font-size/, `${selector} sets a size its interface children would inherit`);
    }
    // The head is the one container that carries the reading size - its
    // strut is the phrase's line, so the counts flowing after the phrase
    // never make the line the interface's height - and the counts inside
    // it override that size in rem (asserted with the counts above).
    assert.match(rule(bare, ".phrase-head"), /font-size: var\(--reader-size, 18px\);\s*line-height: var\(--phrase-line-height\);/, "the head's strut is not the phrase's line");
    assert.doesNotMatch(rule(bare, ".phrase-head"), /display: flex/, "the counts stand on a line of their own under a wrapped phrase");
    assert.match(bare, /\.phrase-word,\s*\.phrase-meanings,[^{]*\{\s*font-family: var\(--reader-font-lead, var\(--reader-font-stack\)\);\s*font-size: var\(--reader-size, 18px\);/, "the phrase and the meanings do not wear the reading face and size");
    assert.match(rule(bare, ".phrase-sentence > summary"), /font-size: var\(--reader-size, 18px\);/, "the sentence does not wear the reading size");
  });
});
