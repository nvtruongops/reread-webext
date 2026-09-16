import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

/**
 * The settings page's menu (the drawn ☰ of every page): its rows lead to
 * the other rooms whatever the settings say. The phrases row hid with the
 * translation switch until 2026-09-13 - a leftover from before the
 * vocabulary worked without the model (D158/D162) - and a reader in the
 * dictionaries-only mode found no way to the saved phrases from here.
 */

const ROOT = new URL("../src/", import.meta.url);

/** @param {string} path */
async function source(path) {
  return readFile(new URL(path, ROOT), "utf8");
}

describe("the settings page's menu", () => {
  it("leads to the reading list, the highlights and the saved phrases whatever the translation switch says", async () => {
    const markup = await source("options/options.html");
    const menu = markup.slice(markup.indexOf('id="menu-panel"'), markup.indexOf("</nav>", markup.indexOf('id="menu-panel"')));
    for (const id of ["nav-library", "nav-marks", "nav-vocabulary"]) {
      assert.match(menu, new RegExp(`<button id="${id}"[^>]*>`), `the menu has no ${id} row`);
    }
    assert.doesNotMatch(menu, /translation-only/, "a menu row still hides with the translation switch");
    // The row's press goes the popup's way: the background raises the
    // phrases tab or turns this one.
    const script = await source("options/options.js");
    assert.match(script, /getElementById\("nav-vocabulary"\)\?\.addEventListener\("click", \(\) => \{\s*setMenu\(false\);\s*void webext\(\)\.runtime\.sendMessage\(\{ kind: Message\.OPEN_VOCABULARY \}\)/, "the phrases row does not open the phrases page through the background");
  });

  it("closes the menu on the last row showing, with no clause for a row that follows the switch", async () => {
    const styles = await source("assets/page.css");
    const rule = styles.slice(styles.indexOf(".nav-menu > :is(a, button):not(:has(~ :is(a, button):not([hidden])))"), styles.indexOf("border-bottom: none;", styles.indexOf(".nav-menu > :is(a, button):not(:has(~ :is(a, button):not([hidden])))")));
    assert.notEqual(rule.length, 0, "the closing row's rule is gone");
    assert.doesNotMatch(rule, /no-translation|translation-only/, "the closing row's rule still knows a row that hides with the switch");
  });
});
