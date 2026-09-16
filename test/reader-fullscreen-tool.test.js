import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { bodyOf } from "./openings.js";

/**
 * The bar's full-screen tool (D195; in the bar of every page since D220,
 * on every platform, and it no longer folds the bar): one press for the
 * whole screen where the browser has one to give and the row has room. The
 * rules are markup, stylesheets and one shared module, so this reads them
 * the way `bubble-fold` does.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the bar's full-screen tool", () => {
  it("stands right before the menu on every page, with both glyphs, named plainly and hidden until earned", async () => {
    for (const [page, glyph] of /** @type {[string, string][]} */ ([
      ["reader/reader.html", "reader-icon"],
      ["vocab/vocab.html", "page-icon"],
      ["options/options.html", "page-icon"],
    ])) {
      const markup = await source(page);
      const tool = markup.indexOf('id="fullscreen"');
      const menu = markup.indexOf('id="menu"');
      assert.ok(tool !== -1 && menu !== -1, `${page}: the bar lost the tool or the menu`);
      assert.ok(tool < menu, `${page}: the tool left its place before the menu`);
      const display = markup.indexOf('id="display"');
      if (display !== -1) assert.ok(display < tool, `${page}: the tool stands before Aa`);
      const button = markup.slice(tool, markup.indexOf("</button>", tool));
      assert.match(button, new RegExp(`class="${glyph} fullscreen-enter"`), `${page}: the entering glyph is gone`);
      assert.match(button, new RegExp(`class="${glyph} fullscreen-exit"`), `${page}: the leaving glyph is gone`);
      // The plain "Full screen", the menu row's own word: the bar no longer
      // folds away with the press, so the name says nothing about it.
      assert.match(button, /data-i18n-title="reader_fullscreen"/, `${page}: the tool is not named the plain "Full screen"`);
      assert.match(button, /data-i18n-aria-label="reader_fullscreen"/, `${page}: the tool's accessible name is not the plain "Full screen"`);
      const startTag = markup.slice(markup.lastIndexOf("<button", tool), markup.indexOf(">", tool));
      assert.match(startTag, /\n\s+hidden\s*$/, `${page}: the tool stands before the row is measured`);
    }
  });

  it("is offered where the browser has a full screen to give and the row has room - every view, every page, every platform", async () => {
    const module = await source("lib/fullscreen-tool.js");
    const arm = bodyOf(module, "armFullscreenTool");
    assert.notEqual(arm.length, 0, "the shared module has no armFullscreenTool");
    assert.match(arm, /document\.fullscreenEnabled === true/, "the tool stands where the browser has no full screen");
    assert.doesNotMatch(module, /platformOs|android/, "the tool still keeps to one platform - a laptop reads too (D220)");
    assert.doesNotMatch(arm, /shown === null/, "the tool still keeps to the article view");
    // Room is measured in the row, not read off a breakpoint: the row's
    // width in CSS pixels follows the browser's zoom, and a Boox with room
    // to spare fell under a fixed 30rem (Michał's photo, 2026-09-11). A
    // row that is not laid out has no width to ask about.
    assert.match(arm, /bar\.clientWidth > 0 && bar\.scrollWidth > bar\.clientWidth/, "the room for the tool is assumed rather than measured");
    assert.match(arm, /window\.addEventListener\("resize", update\)/, "a turned phone keeps the old answer about the room");
    assert.match(arm, /document\.addEventListener\("fullscreenchange", update\)/, "the tool's name does not follow the browser's state");
    // Another resident of the row coming or going - the reader's pen and
    // speaker, the back arrow - changes the room; the tool's own flips do
    // not ask again, or the asking would never end.
    assert.match(arm, /new MutationObserver/, "a resident shown or hidden keeps the old answer about the room");
    assert.match(arm, /attributeFilter: \["hidden"\]/, "the observer watches more than the residents' hidden flips");
    assert.match(arm, /record\.target !== tool/, "the tool's own flips ask the measure again, without end");
    assert.match(arm, /t\("reader_fullscreen_exit"\)/, "the tool's name in full screen is not the row's Exit");
    assert.match(arm, /t\("reader_fullscreen"\)/, "the tool's name is not the row's Full screen");
    for (const page of ["reader/reader.js", "vocab/vocab.js", "options/options.js"]) {
      assert.match(await source(page), /armFullscreenTool\(/, `${page} does not arm the tool`);
    }
    const reader = await source("reader/reader.js");
    assert.doesNotMatch(reader, /function updateFullscreenTool|platformOs/, "the reader keeps a full-screen rule of its own");
    // The reader's bar unfolding from behind its ribbon lays the row out
    // again - the one change the tool cannot see for itself.
    assert.match(reader, /refreshFullscreenTool = armFullscreenTool\(fullscreenTool, closePanels\)/, "the reader does not keep the tool's room question");
    assert.match(bodyOf(reader, "applyAppearance"), /refreshFullscreenTool\(\)/, "an unfolded bar keeps the old answer about the room");
  });

  it("asks for the screen inside the press and leaves on the second press - and folds nothing", async () => {
    const module = await source("lib/fullscreen-tool.js");
    const arm = bodyOf(module, "armFullscreenTool");
    const at = arm.indexOf('tool.addEventListener("click"');
    assert.ok(at !== -1, "the tool answers no press");
    const handler = arm.slice(at, arm.indexOf("\n  });", at));
    assert.match(handler, /closePanels\?\.\(\)/, "an open panel stays under the screen change");
    assert.match(handler, /document\.documentElement\.requestFullscreen\(\)/, "the press does not ask for the screen");
    assert.match(handler, /exitFullscreen\(\)/, "the second press does not leave full screen");
    // Until D220 the press also folded the reader's bar behind its ribbon;
    // the bar stays now, on every page - the ribbon alone folds it.
    assert.doesNotMatch(module, /chromeHidden|writeConfig/, "the press folds the bar, which D220 took away");
    assert.doesNotMatch(await source("reader/reader.js"), /fullscreenTool\?\.addEventListener/, "the reader keeps a press handler of its own on the tool");
  });

  it("wears the row's tight dress on a narrow screen, and says full screen by its glyph alone on every page", async () => {
    const sheet = await source("reader/reader.css");
    const shared = await source("assets/page.css");
    // The tight dress is every page's (one bar, one dress): the tools
    // give up their air together, and none is taken away by width - the
    // zoom makes a width a lie, so the room is measured in the row.
    const narrow = shared.slice(shared.indexOf("@media (max-width: 30rem) {\n  .page-bar {"));
    assert.match(narrow, /\.page-tools > button \{\s*min-width: 2\.4rem;/, "the tools keep the desktop's floor on a phone");
    assert.doesNotMatch(narrow, /#fullscreen \{\s*display: none/, "the stylesheet takes the tool away by width, which the zoom makes a lie");
    assert.doesNotMatch(sheet, /@media \(max-width: 30rem\) \{/, "the reader keeps a tight dress of its own for the bar");
    // The glyph is the tool's whole state: the corners turn inward while
    // the page has the screen, and no wash or frame lights the bar for the
    // whole of a reading on top of it (Michał's photo, 2026-09-14).
    assert.doesNotMatch(shared, /:root:fullscreen #fullscreen(?:,|\s*\{)/, "the tool lights up on top of its own glyph while the page has the screen");
    assert.match(
      shared,
      /:root:fullscreen #fullscreen \.fullscreen-enter,\s*:root:not\(:fullscreen\) #fullscreen \.fullscreen-exit \{\s*display: none;/,
      "the glyph does not follow the browser's state",
    );
    assert.match(sheet, /:root:fullscreen #nav-fullscreen \.fullscreen-enter,\s*:root:not\(:fullscreen\) #nav-fullscreen \.fullscreen-exit/, "the menu row's labels no longer follow the browser's state");
    assert.doesNotMatch(sheet, /:root:fullscreen #fullscreen(?:,|\s*\{)/, "the reader dresses the tool twice");
  });

  it("has no key left for a bar folded away", async () => {
    for (const locale of ["en", "pl", "de", "fr", "es", "uk"]) {
      assert.doesNotMatch(await source(`_locales/${locale}/messages.json`), /reader_fullscreen_bar/, `${locale} still names the folded bar`);
    }
    assert.doesNotMatch(await source("../README.md"), /folds the reader's own bar away/, "the README still promises a fold on the press");
  });
});
