import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  dictionaryRows,
  filterActive,
  firstStepsMove,
  matchesFilter,
  orderForDisplay,
  pairChoices,
  rowVisible,
  searchableText,
  showAllState,
  sortByLabel,
} from "../src/options/models-view.js";

/**
 * @param {string} from
 * @param {string} to
 * @param {{ installed?: boolean }} [state]
 * @returns {import("../src/lib/models/registry.js").ModelRow}
 */
function row(from, to, { installed = false } = {}) {
  return {
    pair: `${from}${to}`,
    from,
    to,
    installed: installed ? { pair: `${from}${to}`, from, to, bytes: 1, addedAt: 1 } : null,
    available: null,
  };
}

describe("orderForDisplay", () => {
  const reading = { sourceLang: "en", targetLang: "pl" };

  it("puts the pair being read first, even when it is not installed", () => {
    const rows = orderForDisplay([row("ar", "en"), row("en", "pl")], reading);
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["enpl", "aren"],
    );
  });

  it("puts installed pairs above the rest of the catalogue", () => {
    const rows = orderForDisplay([row("ar", "en"), row("uk", "en", { installed: true }), row("en", "pl")], reading);
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["enpl", "uken", "aren"],
    );
  });

  it("orders each group by the name on screen, not the code behind it", () => {
    // By code German (de) comes before Basque (eu); on screen the names are
    // the other way around, and the screen is what is being sorted.
    const rows = orderForDisplay([row("de", "en"), row("eu", "en")], { sourceLang: "xx", targetLang: "yy" });
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["euen", "deen"],
    );
  });

  it("gives no row the top tier while no pair is chosen", () => {
    const rows = orderForDisplay(
      [row("en", "pl"), row("de", "en", { installed: true })],
      { sourceLang: null, targetLang: null },
    );
    // Installed first, then the catalogue - nothing is "being read".
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["deen", "enpl"],
    );
  });
});

describe("sortByLabel", () => {
  it("sorts by name alone, with no tier for what is installed", () => {
    const rows = sortByLabel([row("de", "en", { installed: true }), row("eu", "en")]);
    assert.deepEqual(
      rows.map((one) => one.pair),
      ["euen", "deen"],
    );
  });

  it("leaves the rows it was given alone", () => {
    const given = [row("de", "en"), row("eu", "en")];
    sortByLabel(given);
    assert.deepEqual(
      given.map((one) => one.pair),
      ["deen", "euen"],
    );
  });
});

describe("dictionaryRows", () => {
  const reading = { sourceLang: "en", targetLang: "pl" };

  /**
   * @param {string} langFrom
   * @param {string} langTo
   * @param {string} [name]
   * @returns {import("../src/lib/dict/store.js").Dictionary}
   */
  function stored(langFrom, langTo, name = `dict ${langFrom}-${langTo}`) {
    return {
      id: name,
      name,
      langFrom,
      langTo,
      entryCount: 1,
      aliasCount: 0,
      bytes: 1,
      addedAt: 1,
      // The rows arrive already in answering order (`answerOrder`), so what
      // this says is never read here - the view must not re-sort by it.
      rank: 0,
      ready: true,
      credit: null,
    };
  }

  /**
   * @param {string} from
   * @param {string} to
   */
  function offered(from, to) {
    return { from, to, url: `https://example.invalid/wikdict-${from}-${to}.zip` };
  }

  it("puts what is stored above the catalogue, and the pair being read on top of the catalogue", () => {
    const rows = dictionaryRows([stored("de", "en")], [offered("ar", "en"), offered("en", "pl")], reading);
    assert.deepEqual(
      rows.map((one) => `${one.from}-${one.to}:${one.installed === null ? "offered" : "stored"}`),
      ["de-en:stored", "en-pl:offered", "ar-en:offered"],
    );
  });

  it("shows the stored ones in the order they answer in, never re-sorted", () => {
    // The promise the arrows make: this list is the bubble's list. Sorted by
    // label, or by the pair being read, `en-pl` would climb over `pl-en`.
    const rows = dictionaryRows(
      [stored("pl", "en"), stored("en", "pl"), stored("en", "en")],
      [offered("ar", "en")],
      reading,
    );
    assert.deepEqual(
      rows.filter((one) => one.installed !== null).map((one) => `${one.from}-${one.to}`),
      ["pl-en", "en-pl", "en-en"],
    );
  });

  it("folds away the catalogue row of a pair already answered for", () => {
    const rows = dictionaryRows([stored("en", "pl")], [offered("en", "pl"), offered("de", "en")], reading);
    assert.deepEqual(
      rows.map((one) => `${one.from}-${one.to}:${one.installed === null ? "offered" : "stored"}`),
      ["en-pl:stored", "de-en:offered"],
    );
  });

  it("keeps two stored dictionaries of one pair as two rows", () => {
    const rows = dictionaryRows([stored("en", "pl", "first"), stored("en", "pl", "second")], [offered("en", "pl")], reading);
    assert.deepEqual(
      rows.map((one) => one.installed?.name ?? "offered"),
      ["first", "second"],
    );
  });
});

describe("searchableText", () => {
  it("holds the codes, both spellings of the pair and the names, lowered", () => {
    const text = searchableText(row("en", "pl"));
    for (const needle of ["en", "pl", "enpl", "en-pl", "english", "polish"]) {
      assert.ok(text.includes(needle), `missing ${needle} in ${text}`);
    }
  });

  it("builds the pair itself when a row carries none, as catalogue rows do", () => {
    const text = searchableText({ from: "en", to: "pl" });
    assert.ok(text.includes("enpl"));
    assert.ok(text.includes("en-pl"));
  });
});

describe("firstStepsMove", () => {
  it("opens the fold on the first look while either download is missing", () => {
    assert.deepEqual(firstStepsMove(null, false, false), { done: false, open: true });
    assert.deepEqual(firstStepsMove(null, true, false), { done: false, open: true });
    assert.deepEqual(firstStepsMove(null, false, true), { done: false, open: true });
  });

  it("folds on the first look when both are already stored", () => {
    assert.deepEqual(firstStepsMove(null, true, true), { done: true, open: false });
  });

  it("folds at the moment the second of the two downloads lands", () => {
    assert.deepEqual(firstStepsMove(false, true, true), { done: true, open: false });
  });

  it("opens again when the last model or the last dictionary is deleted", () => {
    assert.deepEqual(firstStepsMove(true, false, true), { done: false, open: true });
    assert.deepEqual(firstStepsMove(true, true, false), { done: false, open: true });
  });

  it("stands still between changes, leaving a hand-toggled fold alone", () => {
    assert.deepEqual(firstStepsMove(false, true, false), { done: false, open: null });
    assert.deepEqual(firstStepsMove(true, true, true), { done: true, open: null });
  });
});

describe("matchesFilter", () => {
  const text = searchableText(row("en", "pl"));

  it("matches everything on an empty or blank query", () => {
    assert.ok(matchesFilter(text, ""));
    assert.ok(matchesFilter(text, "   "));
  });

  it("needs every word, in any order and any case", () => {
    assert.ok(matchesFilter(text, "English pol"));
    assert.ok(matchesFilter(text, "pol english"));
    assert.ok(!matchesFilter(text, "english german"));
  });

  it("finds a pair by bare code", () => {
    assert.ok(matchesFilter(text, "pl"));
    assert.ok(!matchesFilter(text, "de"));
  });
});

describe("filterActive", () => {
  it("asks nothing on empty and on whitespace alone", () => {
    assert.ok(!filterActive(""));
    assert.ok(!filterActive("   "));
    assert.ok(filterActive(" pl "));
  });
});

describe("rowVisible", () => {
  it("shows only the installed rows while folded", () => {
    assert.ok(rowVisible({ installed: true, matches: true, expanded: false }));
    assert.ok(!rowVisible({ installed: false, matches: true, expanded: false }));
  });

  it("shows every row once unfolded", () => {
    assert.ok(rowVisible({ installed: false, matches: true, expanded: true }));
  });

  it("hides what the filter does not match, folded or not, installed or not", () => {
    assert.ok(!rowVisible({ installed: true, matches: false, expanded: false }));
    assert.ok(!rowVisible({ installed: false, matches: false, expanded: true }));
    // A match does not unfold the list by itself (block 4 of the seventh
    // brief): the fold counts it and shows it on the press.
    assert.ok(!rowVisible({ installed: false, matches: true, expanded: false }));
  });
});

describe("showAllState", () => {
  it("stands under a folded list, wearing the count the filter lets through", () => {
    assert.deepEqual(showAllState({ total: 118, installedCount: 2, expanded: false }), {
      shown: true,
      expanded: false,
      count: 118,
    });
    // Seven rows match the query, one of them installed: the fold promises
    // the seven, not the whole list.
    assert.deepEqual(showAllState({ total: 7, installedCount: 1, expanded: false }), {
      shown: true,
      expanded: false,
      count: 7,
    });
  });

  it("stays once the list is unfolded, reading the other way", () => {
    assert.deepEqual(showAllState({ total: 118, installedCount: 2, expanded: true }), {
      shown: true,
      expanded: true,
      count: 118,
    });
  });

  it("has nothing to offer when everything is already on screen", () => {
    assert.equal(showAllState({ total: 2, installedCount: 2, expanded: false }).shown, false);
    assert.equal(showAllState({ total: 2, installedCount: 2, expanded: true }).shown, false);
    assert.equal(showAllState({ total: 0, installedCount: 0, expanded: false }).shown, false);
  });
});

describe("pairChoices", () => {
  const reading = { sourceLang: "en", targetLang: "pl" };

  it("offers only the installed pairs, sorted by the name on screen", () => {
    const choices = pairChoices(
      [row("eu", "en", { installed: true }), row("de", "en", { installed: true }), row("en", "pl", { installed: true }), row("ar", "en")],
      reading,
    );
    // Basque before German on screen, and the catalogue-only ar-en not at all.
    assert.deepEqual(
      choices.map((one) => one.pair),
      ["euen", "enpl", "deen"],
    );
  });

  it("is empty with nothing installed - the select explains itself instead", () => {
    assert.deepEqual(pairChoices([row("en", "pl"), row("de", "en")], reading), []);
  });

  it("offers exactly the installed pairs while no pair is chosen", () => {
    const choices = pairChoices(
      [row("de", "en", { installed: true }), row("en", "pl")],
      { sourceLang: null, targetLang: null },
    );
    assert.deepEqual(
      choices.map((one) => one.pair),
      ["deen"],
    );
  });

  it("keeps the configured pair even with its model gone", () => {
    // A settings page must never disagree with the settings: the pair stays
    // choosable (and chosen) until something else is picked.
    const choices = pairChoices([row("de", "en", { installed: true })], reading);
    assert.deepEqual(
      choices.map((one) => one.pair),
      ["enpl", "deen"],
    );
  });

  it("offers a ready dictionary's pair, marked as the dictionary's (D158)", () => {
    // The quiet vocabulary files under a pair, and with no model at all the
    // dictionaries are the only ones that can vouch for one.
    const choices = pairChoices([], { sourceLang: null, targetLang: null }, [
      { langFrom: "en", langTo: "en", ready: true },
      { langFrom: "de", langTo: "pl", ready: false },
    ]);
    assert.deepEqual(choices, [{ pair: "enen", from: "en", to: "en", dictionaryOnly: true }]);
  });

  it("offers a monolingual book's pair only as the last resort for its language (D166)", () => {
    // Michał's doubt: en -> en beside en -> pl is a second shelf for English,
    // and the en-en book already answers under en -> pl. A model reading the
    // language counts the same as a bilingual book.
    const none = { sourceLang: null, targetLang: null };
    const books = [
      { langFrom: "en", langTo: "en", ready: true },
      { langFrom: "pl", langTo: "en", ready: true },
      { langFrom: "pl", langTo: "pl", ready: true },
    ];
    assert.deepEqual(
      pairChoices([row("en", "pl", { installed: true })], none, books).map((one) => one.pair),
      ["enpl", "plen"],
    );
    assert.deepEqual(
      pairChoices([], none, books).map((one) => one.pair),
      ["enen", "plen"],
    );
    // The shelf somebody stands on never vanishes: chosen, the monolingual
    // pair stays listed even beside the bilingual one that outranks it.
    assert.deepEqual(
      pairChoices([row("en", "pl", { installed: true })], { sourceLang: "en", targetLang: "en" }, books).map(
        (one) => one.pair,
      ),
      ["enen", "enpl", "plen"],
    );
  });

  it("lets the model's line win over the same pair's dictionary", () => {
    // Under the model's line both halves of the extension work, so the pair
    // is not the dictionary's to mark - and it appears once, not twice.
    const choices = pairChoices(
      [row("de", "en", { installed: true })],
      { sourceLang: null, targetLang: null },
      [
        { langFrom: "de", langTo: "en", ready: true },
        { langFrom: "de", langTo: "en", ready: true },
        { langFrom: "en", langTo: "en", ready: true },
      ],
    );
    assert.deepEqual(
      choices.map((one) => [one.pair, one.dictionaryOnly]),
      [
        ["enen", true],
        ["deen", false],
      ],
    );
  });
});
