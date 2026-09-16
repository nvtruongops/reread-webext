import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The popup's rows stand still under the cursor (D194).
 *
 * The site row used to appear only once the page had said which site it is,
 * and the page was asked after the models and the dictionaries had been
 * read - a second or two after the popup opened, on Michał's desk
 * (2026-09-11). Every row below moved down at that moment, and a press on
 * its way to Settings landed on the checkbox that had arrived under it.
 * Two rules keep that from coming back, and both are call sites and markup
 * saying something, so this test reads them the way `bubble-fold` does.
 */

const ROOT = new URL("../src/popup/", import.meta.url);

/** @param {string} name */
async function source(name) {
  return readFile(new URL(name, ROOT), "utf8");
}

describe("the popup's site row", () => {
  it("stands in the markup from the first paint, with its switch waiting disabled", async () => {
    const markup = await source("index.html");
    const row = markup.slice(markup.indexOf('id="site-row"'), markup.indexOf("</label>", markup.indexOf('id="site-row"')));
    assert.doesNotMatch(markup, /id="site-row"[^>]*hidden/, "the site row waits for the page's answer to stand at all");
    assert.match(row, /id="site-toggle"[\s\S]*?disabled/, "the switch takes presses before it knows which site it is about");
    // The note for a page nothing runs on stays hidden until it is the
    // answer: it takes the switch's place, not a place of its own.
    assert.match(markup, /id="site-note"[^>]*hidden/, "the no-page note stands beside the switch instead of in its place");
  });

  it("is asked about before the models are read, and filled in wherever the answer lands", async () => {
    const script = await source("index.js");
    const render = bodyOf(script, "render");
    const asked = render.indexOf("askPage(tabId)");
    const models = render.indexOf("installedModels()");
    assert.ok(asked !== -1 && models !== -1, "the popup's draw lost a step");
    assert.ok(asked < models, "the page is asked only after the models have been read");
    assert.match(render, /page\.then\(\(info\) => renderSite\(info, config\)\)/, "the page's answer waits for the rest of the draw");
    assert.match(render, /siteStands = siteRowStands\(config\)/, "the site switch is decided by something other than the settings alone");

    const landing = bodyOf(script, "renderSite");
    assert.match(landing, /siteToggle\.disabled = false/, "the switch stays disabled once the site is known");
    // The two answers that take the row away replace it at the same height
    // (the note) or go with the reader's own page, where the rows below are
    // the popup's first rows anyway.
    assert.match(landing, /info === null\) \{[\s\S]*?stand\(siteRow, false\);[\s\S]*?siteNote\.hidden = false/, "a page nothing runs on leaves the empty switch standing");
  });

  it("says the host is being asked before it knows it", async () => {
    const script = await source("index.js");
    const before = script.slice(0, script.indexOf("async function render()"));
    assert.match(before, /siteLabel\.textContent = t\("popup_site_enabled", "\.\.\."\)/, "the row opens with an empty label");
  });
});
