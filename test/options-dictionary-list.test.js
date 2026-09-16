import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The list of dictionaries on the settings page (the seventh brief): what
// the smoke test cannot count and the eye cannot measure - the shape every
// row is built in, the one narrow-screen move, the ink of a disabled arrow,
// where the focus goes after a move. Read from the sources, since the page
// only exists in a browser.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "src/options/options.css"), "utf8");
const script = readFileSync(join(ROOT, "src/options/options.js"), "utf8");
const page = readFileSync(join(ROOT, "src/options/options.html"), "utf8");

/**
 * The declarations of one rule, found by its selector line.
 *
 * @param {string} sheet
 * @param {string} selector
 * @returns {string}
 */
function rule(sheet, selector) {
  const at = sheet.indexOf(`${selector} {`);
  assert.ok(at >= 0, `no rule for ${selector}`);
  return sheet.slice(at, sheet.indexOf("}", at));
}

/**
 * The body of one function of the settings script, from its name to the
 * next one's.
 *
 * @param {string} name
 * @param {string} next
 * @returns {string}
 */
function fn(name, next) {
  const from = script.indexOf(`function ${name}(`);
  const to = script.indexOf(`function ${next}(`);
  assert.ok(from >= 0 && to > from, `${name} before ${next}`);
  return script.slice(from, to);
}

describe("the dictionary list's rows", () => {
  it("are items of a list, the browser's bullets and indent taken off", () => {
    assert.match(page, /<ul id="dictionary-catalog" class="models"><\/ul>/);
    assert.match(script, /element\("li", "dictionary-row"\)/);
    assert.match(rule(css, "ul.models"), /list-style: none/);
    assert.match(rule(css, "ul.models"), /padding: 0/);
    // The empty line and the "no match" line stand in the list as items too.
    assert.match(script, /element\("li", "empty", t\("options_no_catalog"\)\)/);
    assert.match(script, /element\("li", "empty", t\("options_filter_no_match_dictionaries"\)\)/);
  });

  it("stack the same four lines at every width: head, title, small print, fold", () => {
    const row = fn("renderDictionary", "refreshRowName");
    const order = [
      "dictionaryRow(",
      'element("p", "dictionary-name"',
      'element("p", "dictionary-meta")',
      'element("details", "dictionary-details")',
    ].map((mark) => row.indexOf(mark));
    assert.ok(order.every((at) => at >= 0), "every line is built");
    assert.deepEqual([...order].sort((a, b) => a - b), order);
    // No grid anywhere in the row: a wrapping flex line for the head, the
    // rest in the page's own flow.
    assert.doesNotMatch(rule(css, ".dictionary-row"), /grid/);
    assert.match(rule(css, ".dictionary-head"), /display: flex;\s+flex-wrap: wrap/);
    // The catalogue's rows and the download-in-progress row are built the
    // same way, from the same head.
    assert.match(fn("renderCatalogRow", "renderCatalog"), /dictionaryRow\(entry\.from, entry\.to\)/);
    assert.match(fn("renderFetching", "downloadDictionary"), /element\("div", "dictionary-head"\)/);
    assert.match(page, /<div id="dictionary-link-row" class="dictionary-row" hidden><\/div>/);
  });

  it("never break the pair in the middle, and let the badge wrap instead", () => {
    assert.match(rule(css, ".dictionary-pair"), /white-space: nowrap/);
    // Only a pair wider than the whole row is cut, rather than scrolling the page sideways.
    assert.match(rule(css, ".dictionary-pair"), /text-overflow: ellipsis/);
    assert.doesNotMatch(rule(css, ".dictionary-head .badge"), /nowrap/);
  });

  it("keep the buttons in one group at the right edge, under the pair only on a narrow screen", () => {
    const actions = rule(css, ".dictionary-actions");
    assert.match(actions, /flex: none/);
    assert.match(actions, /margin-left: auto/);
    assert.match(rule(css, ".dictionary-actions button"), /white-space: nowrap/);
    const narrow = css.slice(css.indexOf("@media (max-width: 480px)"));
    assert.match(narrow, /\.dictionary-actions \{\s+flex-basis: 100%;\s+justify-content: flex-end;/);
    // And no other narrow-screen rule for the row: the stack is the same everywhere.
    assert.equal(css.match(/@media \(max-width/g)?.length, 1);
  });

  it("title the row with the shown name and wrap it rather than cut it", () => {
    assert.match(fn("renderDictionary", "refreshRowName"), /element\("p", "dictionary-name", shown\)/);
    const title = rule(css, ".dictionary-name");
    assert.match(title, /overflow-wrap: anywhere/);
    assert.doesNotMatch(title, /text-overflow|nowrap|line-clamp/);
  });

  it("say the file's name in the small print only while it differs, and keep a count whole", () => {
    const meta = fn("fillDictionaryMeta", "renderDictionary");
    assert.match(meta, /if \(shownName\(dictionary\) !== dictionary\.name\) items\.push\(element\("span", "dictionary-file", dictionary\.name\)\)/);
    // The items apart by a middle dot after a no-break space: a line may end
    // after the dot, never begin with it.
    assert.match(meta, /meta\.append\("\\u00a0· "\)/);
    // Each count with its unit in a span that does not wrap; the file's
    // name may break anywhere, since it can be wider than a phone.
    assert.match(meta, /element\("span", "dictionary-count", words\(dictionary\.entryCount\)\)/);
    assert.match(meta, /element\("span", "dictionary-count", megabytes\(dictionary\.bytes\)\)/);
    assert.match(rule(css, ".dictionary-count"), /white-space: nowrap/);
    assert.match(rule(css, ".dictionary-meta"), /overflow-wrap: anywhere/);
  });
});

describe("the arrows", () => {
  it("wear the separator lines' ink when disabled, not a thinner version of their own", () => {
    const disabled = rule(css, ".model-move:disabled,\n.model-move:disabled:hover");
    assert.match(disabled, /color: var\(--page-line\)/);
    assert.doesNotMatch(disabled, /opacity: 0\./);
    // Said in the attribute as well as the state.
    assert.match(fn("moveButton", "moveLabel"), /if \(button\.disabled\) button\.setAttribute\("aria-disabled", "true"\)/);
  });

  it("stay in place at the ends of the list rather than vanishing", () => {
    // Both arrows are built whenever there is anything to arrange; only
    // their enabled state changes with the row's place.
    const row = fn("renderDictionary", "refreshRowName");
    assert.match(row, /moveButton\(dictionary, -1, place\.at > 0\)/);
    assert.match(row, /moveButton\(dictionary, 1, place\.at < place\.total - 1\)/);
  });

  it("keep the focus on the arrow that moved with its row, or the opposite one at the end", () => {
    const focus = fn("focusMove", "moveDictionary");
    assert.match(focus, /moveButtonFor\(id, step\)/);
    assert.match(focus, /moveButtonFor\(id, -step\)/);
    assert.match(fn("moveDictionary", "renameField"), /focusMove\(dictionary\.id, step\)/);
  });
});

describe("the list's fold", () => {
  it("stands at the rows' left edge and reads like the shelf's own", () => {
    const fold = rule(css, ".show-all");
    assert.match(fold, /text-align: start/);
    assert.match(fold, /background: none/);
    assert.doesNotMatch(fold, /width: 100%|text-align: center/);
  });

  it("reads Show all with the count the filter lets through, and Show fewer once unfolded", () => {
    const apply = fn("applyFilterIn", "applyModelFilter");
    assert.match(apply, /showAllState\(\{ total: matching, installedCount: installedMatching, expanded \}\)/);
    assert.match(apply, /state\.expanded \? t\("options_show_fewer"\) : t\("options_show_all", state\.count\.toLocaleString\(\)\)/);
    assert.match(apply, /setAttribute\("aria-expanded", String\(state\.expanded\)\)/);
    // "Nothing matched" is about the filter alone, never about the fold.
    assert.match(apply, /none\.hidden = !filterActive\(query\) \|\| matching > 0/);
    assert.match(page, /id="dictionaries-show-all" class="show-all" aria-controls="dictionary-catalog"/);
    assert.match(page, /id="models-show-all" class="show-all" aria-controls="models"/);
  });

  it("walks the focus into the list on unfolding and leaves it on the button on folding", () => {
    const toggle = fn("toggleList", "renderModels");
    assert.match(toggle, /if \(!opening\) return;/);
    assert.match(toggle, /\[data-installed="false"\]:not\(\[hidden\]\) button/);
    assert.match(script, /addEventListener\("click", \(\) => toggleList\("dictionary-catalog"\)\)/);
  });
});
