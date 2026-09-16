import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The bubble's dictionary section on the shared shelf (Michał's fifth
 * brief, 2026-09-12): the same rows the saved-phrases page and the popup
 * draw (`lib/lookup-shelf.js`), in the bubble's own dress, a tick saving
 * at once. Read at the call sites, the way the other bubble tests are:
 * the shelf's own rules have their tests in `lookup.test.js` and
 * `lookup-box.test.js`, and what could regress here is a bubble that
 * draws rows of its own again, a press that composes instead of saving,
 * a caller that hands over blocks instead of groups, or a fold that grows
 * the bubble.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the bubble's dictionary shelf", () => {
  it("draws the shared shelf, compact: no Show all, the folds afresh with every answer, rows prose in the quiet bubble", async () => {
    const tooltip = await source("content/tooltip.js");
    assert.match(tooltip, /import \{ renderShelf \} from "\.\.\/lib\/lookup-shelf\.js";/, "the bubble does not import the shelf");
    const setting = bodyOf(tooltip, "setEntries");
    assert.match(setting, /entriesElement\.style\.height = "";/, "a new answer keeps the old answer's pinned height");
    assert.match(setting, /renderShelf\(groups, \{\s*meanings: currentMeanings\(\),\s*folds: new Map\(\),\s*readOnly: plain,\s*disabled: editing,\s*foldAt: null,\s*oneOpen: true,\s*onPress: \(line\) => choose\(line\),/, "the shelf is not drawn compact, afresh, one book at a time, with the quiet bubble's rows prose and a tick choosing");
    // No rows of the bubble's own any more.
    assert.doesNotMatch(tooltip, /\.entry-sense|\.entry-label|\.entry-dict|"entry"|"entry-/, "the old dictionary section is still drawn");
    assert.doesNotMatch(tooltip, /afterChoosing/, "a tick composes the gloss the old way");
    assert.match(tooltip, /entriesElement\.className = "entries lookup-entries";/, "the bubble's box is not the shelf's column");
  });

  it("saves at once on a tick, and the last untick forgets the phrase the way Learned does", async () => {
    const tooltip = await source("content/tooltip.js");
    const choosing = bodyOf(tooltip, "choose");
    assert.match(choosing, /const next = afterPress\(currentMeanings\(\), sense\);/, "a tick does not ask the page's own rule");
    assert.match(choosing, /if \(next\.act === "forget"\) \{\s*emit\("learned"\);\s*return;/, "the last meaning unticked does not forget the phrase");
    assert.match(choosing, /setBody\(next\.meanings\.join\(MEANING_SEPARATOR\)\);\s*place\(\);\s*emit\("choose"\);/, "a tick does not land in the card and go out as a choose");
    // The ticks follow the card in place - a redraw would lose the scroll and the focus.
    const controls = bodyOf(tooltip, "refreshControls");
    assert.match(controls, /for \(const row of entriesElement\.querySelectorAll\("\.lookup-line"\)\)/, "the rows are not synced with the card");
    assert.match(controls, /const saved = isSaved\(meanings, line\);\s*row\.dataset\["saved"\] = saved \? "true" : "false";/, "a row does not say whether its meaning is in the card");
    assert.match(controls, /box\.checked = saved;\s*box\.disabled = editing;/, "the box does not follow the card, or stays in reach while the edit box is open");
    assert.match(bodyOf(tooltip, "pressableLines"), /querySelectorAll\("input\.lookup-line-box"\)/, "Save's prompt counts something other than the boxes");
  });

  it("keeps the bubble's height when a book is unfolded: the box is pinned on the press and scrolls", async () => {
    const tooltip = await source("content/tooltip.js");
    assert.match(tooltip, /entriesElement\.addEventListener\("click", pinEntries, true\);\s*entriesElement\.addEventListener\("keydown", pinEntries, true\);/, "the presses on a book's name are not caught before the fold opens");
    const pinning = bodyOf(tooltip, "pinEntries");
    assert.match(pinning, /if \(entriesElement === null \|\| entriesElement\.style\.height !== ""\) return;/, "the box is pinned more than once");
    assert.match(pinning, /target\.closest\("summary"\) === null\) return;/, "a press anywhere pins the box");
    assert.match(pinning, /entriesElement\.style\.height = `\$\{entriesElement\.getBoundingClientRect\(\)\.height\}px`;/, "the box is not pinned at the height it has");
    // The box still scrolls inside itself, the only place outside the popup where that is allowed.
    assert.match(tooltip, /\.entries \{[\s\S]*?max-height: 40vh;\s*overflow-y: auto;/, "the box no longer scrolls inside itself");
  });

  it("stands the books one open at a time, and brings the book opened into the box's view (D214)", async () => {
    const tooltip = await source("content/tooltip.js");
    assert.match(bodyOf(tooltip, "setEntries"), /foldAt: null,\s*oneOpen: true,/, "the bubble's books open one under another - the second out of sight under the pinned box's edge");
    const shelf = await source("lib/lookup-shelf.js");
    assert.match(shelf, /if \(oneOpen\) book\.name = "lookup-group";/, "the books do not share a name - the browser's own exclusive group");
    assert.match(shelf, /summary\.addEventListener\("click", \(\) => \{\s*requestAnimationFrame\(\(\) => \{\s*if \(book\.open\) showOpened\(book\);/, "a book opened by a press is not brought into view once the fold has answered the press");
  });

  it("is handed groups with their rows told apart, in the books' language, by every caller", async () => {
    const reading = await source("content/reading.js");
    assert.match(reading, /import \{ entryGroups \} from "\.\.\/lib\/lookup\.js";/, "the reading side does not group the entries");
    assert.doesNotMatch(reading, /entryBlocks/, "the reading side still hands over blocks");
    assert.match(bodyOf(reading, "landQuietAnswer"), /tooltip\.setEntries\(entryGroups\(answer\.entries, normalized, answer\.lang\)\)/, "the quiet answer's rows are not told apart in the books' language");
    const second = bodyOf(reading, "fillSecondLayer");
    assert.match(second, /entryGroups\(entries, phrase\.normalized, answer\?\.lang \?\? phrase\.lang\)/, "the quiet second layer's rows are not told apart");
    assert.match(second, /entryGroups\(entries \?\? \[\], phrase\.normalized, phrase\.answered\.length > 0 \? phrase\.answered : ttsLang\)/, "the second layer's rows are not told apart in the language that knew the phrase");
    assert.match(reading, /entryGroups\(entries \?\? \[\], normalized, language \?\? ttsLang\)/, "the fresh answer's rows are not told apart");
    assert.doesNotMatch(reading, /setEntries\(blocks\)/, "blocks still reach the bubble");
  });

  it("dresses the shelf in the bubble's own sheet: the tokens, the rows, no wash, the old classes gone", async () => {
    const tooltip = await source("content/tooltip.js");
    // The measures stand with the tiers' variables on .bubble, from the
    // second layer's type, so they step up with the tier and the knob.
    assert.match(tooltip, /--lookup-box-size: 20px;\s*--lookup-line-gap: 12px;\s*--lookup-line-height: calc\(var\(--type-second\) \* var\(--bubble-scale, 1\) \* 1\.45\);\s*--lookup-check-offset: calc\(var\(--type-second\) \* var\(--bubble-scale, 1\) \* 0\.1\);/, "the shelf's measures are not the bubble's own tokens");
    assert.doesNotMatch(tooltip, /--pad-sense/, "the old rows' padding token is still there");
    // The rows' rhythm at the compact floor, the pages' own reckoning (the
    // sixth brief): name-to-row equals row-to-row, in px.
    assert.match(tooltip, /--lookup-touch: 40px;\s*--lookup-row-gap: calc\(var\(--type-second\) \* var\(--bubble-scale, 1\) \* 0\.6\);\s*--lookup-label-size: calc\(var\(--type-label\) \* var\(--bubble-scale, 1\)\);\s*--lookup-label-line: calc\(var\(--lookup-label-size\) \* 1\.3\);\s*--lookup-row-pad: max\(var\(--lookup-row-gap\), calc\(\(var\(--lookup-touch\) - var\(--lookup-line-height\)\) \/ 2\)\);\s*--lookup-label-pad-top: max\(var\(--lookup-row-pad\), calc\(var\(--lookup-touch\) - var\(--lookup-label-line\) - var\(--lookup-row-pad\)\)\);/, "the rhythm's tokens are not the pages' reckoning at the bubble's floor");
    assert.match(tooltip, /\.lookup-line \{[\s\S]*?padding: var\(--lookup-row-pad\) 5px;/, "a row does not keep the pad above and below");
    assert.match(tooltip, /\.lookup-group-label,\s*\.lookup-about-label \{[\s\S]*?padding: var\(--lookup-label-pad-top\) 5px var\(--lookup-row-pad\);/, "a book's name line does not end in the row's pad");
    assert.match(tooltip, /--lookup-touch: 40px;/, "the compact floor is not a finger's press");
    assert.match(tooltip, /\.lookup-line \{[\s\S]*?min-height: var\(--lookup-touch\);/, "a row is shorter than the compact floor");
    assert.match(tooltip, /--lookup-box-top: calc\(\(var\(--lookup-line-height\) - var\(--lookup-box-size\)\) \/ 2 \+ var\(--lookup-check-offset\)\);/, "the box's top margin is not the bubble's own token");
    assert.match(tooltip, /\.lookup-line > \.lookup-line-box \{[\s\S]*?margin: var\(--lookup-box-top\) 0 min\(0px, calc\(var\(--lookup-line-height\) - var\(--lookup-box-size\) - var\(--lookup-box-top\)\)\);\s*color: inherit;\s*accent-color: currentColor;/, "the box is not centred on the text's first line in the bubble's ink, or grows the row under a short line");
    assert.match(tooltip, /\.lookup-group-label,\s*\.lookup-about-label \{\s*display: list-item;/, "a book's name hides the browser's triangle");
    assert.match(tooltip, /\.lookup-line\[data-saved="true"\] \.lookup-line-text \{ font-weight: 600; \}/, "a saved row is not told by its weight");
    assert.doesNotMatch(tooltip, /\.lookup-line[^{]*\{[^}]*background/, "a row paints a wash");
  });
});
