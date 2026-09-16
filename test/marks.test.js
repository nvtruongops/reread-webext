import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { STYLE } from "../src/content/tooltip.js";
import { MAX_NOTE_LENGTH } from "../src/lib/reader/marks.js";

/**
 * The two marks this extension paints on a page it does not own - the underline
 * of a saved phrase and the wash under the phrase an open recall bubble is
 * about (D89) - and the tint gate on the bubble's dictionary lines. All three
 * are contracts between files that never import each other: a highlight name
 * lives once in `highlighter.js` and once in `highlight.css`, and a rename on
 * either side is not an error anywhere - the mark is simply, silently gone.
 * No browser runs in CI, so what can be held is the agreement itself.
 *
 * @param {string} path
 */
async function read(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

describe("the marks on the page", () => {
  it("names the recall mark the same in the script and in the stylesheet", async () => {
    const script = await read("../src/content/highlighter.js");
    const sheet = await read("../src/content/highlight.css");

    // The underline's own names are the weights' (D130) and are held to this
    // same stylesheet in `test/underline.test.js`; this one is the mark under
    // the phrase an open bubble is about, which has no dial and one name.
    assert.ok(script.includes('"reread-active"'), 'highlighter.js no longer registers "reread-active"');
    assert.ok(
      sheet.includes("::highlight(reread-active)"),
      "highlight.css no longer styles ::highlight(reread-active)",
    );
  });

  it("washes the recalled phrase in the page's own ink, never in a colour of ours", async () => {
    const sheet = await read("../src/content/highlight.css");
    const start = sheet.indexOf("::highlight(reread-active)");
    const block = sheet.slice(sheet.indexOf("{", start) + 1, sheet.indexOf("}", start));

    // The same rule the underline lives by: a fixed colour has to be a
    // compromise between light pages and dark ones, and a compromise that
    // reads everywhere is loud somewhere. `currentColor` answers per page.
    assert.match(
      block,
      /background-color:\s*color-mix\(in srgb, currentColor \d+%, transparent\)/,
      "the recall mark stopped being a wash of currentColor",
    );
  });

  it("keeps the dictionary rows' hover away from the touch tier, and paints no wash for it", () => {
    // Innermost rules only, which every `.lookup-line` rule is - the media
    // query wrapping the dark theme never matches this shape itself. The
    // comments go first: a comment about hovers is not a hover rule.
    let found = 0;
    const rules = STYLE.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const [, selector, body] of rules.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!(selector ?? "").includes(".lookup-line") || !(selector ?? "").includes(":hover")) continue;
      found += 1;
      // Under a finger :hover is an emulation: it paints the line a scroll is
      // passing through and sticks after the finger lifts. The gate is the
      // gesture's own attribute, because the pointer media query answers
      // wrong on an e-ink tablet (D84). And the hover says nothing with a
      // wash (the fifth brief): the text underlines, a wash is one of the
      // 16 greys an e-ink panel rounds back to paper.
      assert.ok(
        (selector ?? "").includes('.bubble:not([data-pointer="coarse"])'),
        `a hover on a dictionary row is not gated to the mouse: "${(selector ?? "").trim()}"`,
      );
      assert.doesNotMatch(body ?? "", /background/, "a hover on a dictionary row paints a wash");
    }
    assert.ok(found >= 1, "the hover rule went missing");
    assert.doesNotMatch(STYLE, /\.entry-sense|\.entry-label|\.entry-dict|\.entry \+ \.entry/, "the old dictionary section's dress is still there");
  });

  it("names the highlighter's strokes the same in the scripts and in reader.css", async () => {
    // The same contract one page over (D106): the wet stroke is registered in
    // select.js, the dried ones per colour in marks-view.js, and reader.css
    // dresses both - names again, agreed on by files that never import each
    // other, silently gone on any rename.
    const sheet = await read("../src/reader/reader.css");
    const gesture = await read("../src/content/select.js");
    const view = await read("../src/reader/marks-view.js");
    const rules = await read("../src/lib/reader/marks.js");

    assert.ok(gesture.includes('"reread-marker-draft"'), "select.js no longer registers the draft");
    assert.ok(
      sheet.includes("::highlight(reread-marker-draft)"),
      "reader.css no longer styles the draft stroke",
    );

    assert.ok(view.includes('"reread-marker-"'), "marks-view.js no longer prefixes colour names");
    for (const color of ["yellow", "green", "blue", "pink"]) {
      // Every colour the rules know is a registry name the stylesheet must
      // dress - a mark in an unstyled colour would paint invisibly.
      assert.ok(
        rules.includes(`"${color}"`),
        `lib/reader/marks.js no longer knows the colour "${color}"`,
      );
      assert.ok(
        sheet.includes(`::highlight(reread-marker-${color})`),
        `reader.css no longer styles ::highlight(reread-marker-${color})`,
      );
    }
  });

  it("holds the note box to the note cap (D118)", async () => {
    // The same agreement one layer up: the cap lives in lib/reader/marks.js,
    // the box in reader.html, and the two never import each other. A box
    // looser than the cap would take words the healer then cuts silently.
    const page = await read("../src/reader/reader.html");
    assert.ok(
      page.includes(`maxlength="${MAX_NOTE_LENGTH}"`),
      "reader.html's note box no longer wears MAX_NOTE_LENGTH as its maxlength",
    );
  });
});
