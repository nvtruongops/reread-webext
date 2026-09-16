import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  asDictEntries,
  asLookUp,
  asPage,
  asPageInfo,
  asPageRequest,
  asRequest,
  asRestoreRow,
  asResult,
  asTranslation,
  ErrorCode,
  fail,
  isLanguageCode,
  MAX_COUNTED_KEYS,
  Message,
  ok,
} from "../src/lib/protocol.js";

describe("asDictEntries", () => {
  it("keeps the entries that can be rendered and drops the rest", () => {
    // The `look-up` answer's own door (D162) - the same narrowing the
    // translation's entries have always gone through, exported for it.
    const kept = asDictEntries([
      { dictionary: "WikDict", headword: "watch", senses: ["zegarek"] },
      { dictionary: 7, headword: null, senses: ["still shown"] },
      { dictionary: "broken", headword: "x", senses: [] },
      { dictionary: "broken", headword: "x" },
      "not an entry",
    ]);
    assert.deepEqual(kept, [
      { dictionary: "WikDict", headword: "watch", senses: ["zegarek"] },
      { dictionary: "", headword: "", senses: ["still shown"] },
    ]);
  });

  it("answers nothing for a shape that is not a list", () => {
    assert.deepEqual(asDictEntries(undefined), []);
    assert.deepEqual(asDictEntries({ dictionary: "x" }), []);
  });
});

describe("asLookUp", () => {
  const ENTRY = { dictionary: "WikDict", headword: "watch", senses: ["zegarek"] };

  it("passes a well-formed answer through, its entries narrowed", () => {
    // The quiet bubble's own door (D164): the count is what tells "not in
    // your dictionaries" from "no dictionary for this language", and the
    // language (D191) is what the sentence names and the voice reads in.
    assert.deepEqual(
      asLookUp({ entries: [ENTRY, "junk"], dictionaries: 2, lang: "en" }),
      { entries: [ENTRY], dictionaries: 2, lang: "en" },
    );
    assert.deepEqual(asLookUp({ entries: [], dictionaries: 0, lang: "pl" }), { entries: [], dictionaries: 0, lang: "pl" });
  });

  it("answers no answer for anything else, an older background's answers included", () => {
    // Saying nothing beats saying something wrong: a "no dictionary" line off
    // a malformed count, or naming a language nobody asked in, would send
    // somebody to the settings for nothing. An older background answers a
    // bare list (before D164) or a count without a language (before D191).
    assert.equal(asLookUp(null), null);
    assert.equal(asLookUp(undefined), null);
    assert.equal(asLookUp([ENTRY]), null);
    assert.equal(asLookUp({ entries: [], dictionaries: 0 }), null);
    assert.equal(asLookUp({ entries: [], dictionaries: 0, lang: "" }), null);
    assert.equal(asLookUp({ entries: [], dictionaries: 0, lang: 7 }), null);
    assert.equal(asLookUp({ entries: [], dictionaries: -1, lang: "en" }), null);
    assert.equal(asLookUp({ entries: [], dictionaries: 1.5, lang: "en" }), null);
    assert.equal(asLookUp({ entries: [], dictionaries: "2", lang: "en" }), null);
    assert.equal(asLookUp({ entries: "none", dictionaries: 1, lang: "en" }), null);
  });
});

describe("asTranslation", () => {
  const ENTRY = { dictionary: "Test", headword: "bank", senses: ["brzeg", "instytucja"] };

  it("passes a well-formed translation through", () => {
    assert.deepEqual(asTranslation({ gloss: "bank", sentence: "Brzeg był stromy.", entries: [ENTRY] }), {
      gloss: "bank",
      sentence: "Brzeg był stromy.",
      entries: [ENTRY],
    });
  });

  it("keeps the gloss when there is no sentence", () => {
    assert.deepEqual(asTranslation({ gloss: "bank", sentence: null }), {
      gloss: "bank",
      sentence: null,
      entries: [],
    });
  });

  /**
   * A page can be running a content script from before an update while the
   * background is already the new one. Whatever comes back, the bubble may not
   * throw into somebody else's console.
   */
  it("turns anything else into an empty translation rather than throwing", () => {
    for (const value of [null, undefined, "bank", 42, [], {}, { gloss: 7 }, { sentence: "only" }]) {
      assert.deepEqual(asTranslation(value), { gloss: "", sentence: null, entries: [] });
    }
  });

  it("drops a sentence that is not a string, keeping the gloss", () => {
    assert.deepEqual(asTranslation({ gloss: "bank", sentence: 42 }), {
      gloss: "bank",
      sentence: null,
      entries: [],
    });
  });

  it("answers with an array of entries whatever arrived in their place", () => {
    for (const entries of [undefined, null, "brzeg", 42, {}, [null], [{ senses: "brzeg" }], [{ senses: [] }]]) {
      assert.deepEqual(asTranslation({ gloss: "bank", sentence: null, entries }).entries, []);
    }
  });

  it("keeps the entries that are whole and drops the ones that are not", () => {
    const mixed = asTranslation({
      gloss: "bank",
      sentence: null,
      entries: [ENTRY, { dictionary: "Broken" }, { senses: ["ok", 42, ""] }],
    });

    assert.deepEqual(mixed.entries, [ENTRY, { dictionary: "", headword: "", senses: ["ok"] }]);
  });

  it("has no second layer to offer when there is no gloss to offer it with", () => {
    assert.deepEqual(asTranslation({ gloss: "", sentence: "Brzeg był stromy.", entries: [ENTRY] }), {
      gloss: "",
      sentence: null,
      entries: [],
    });
  });

  it("carries the count of dictionaries asked when it is one (D192)", () => {
    // Zero is a count - the one that says there is no dictionary at all.
    assert.deepEqual(asTranslation({ gloss: "bank", sentence: null, entries: [], dictionaries: 0 }), {
      gloss: "bank",
      sentence: null,
      entries: [],
      dictionaries: 0,
    });
    assert.equal(asTranslation({ gloss: "bank", sentence: null, entries: [ENTRY], dictionaries: 2 }).dictionaries, 2);
  });

  it("leaves the count out when it is not one, and when there is no gloss", () => {
    // A background from before the field sends none; anything that is not a
    // whole non-negative number says nothing about the dictionaries and must
    // not be read as if it did - the bubble then says nothing (D164).
    for (const dictionaries of [undefined, null, -1, 1.5, "2", NaN, Infinity]) {
      assert.equal("dictionaries" in asTranslation({ gloss: "bank", sentence: null, entries: [], dictionaries }), false);
    }
    assert.equal("dictionaries" in asTranslation({ gloss: "", sentence: null, entries: [], dictionaries: 0 }), false);
  });

  it("carries a phrase found to be in another language, with its entries and no gloss (D193)", () => {
    // The engine was not asked: no gloss, no sentence - and the entries and
    // the count are the answer, so they ride along the one time a gloss is
    // missing on purpose.
    assert.deepEqual(asTranslation({ gloss: "", sentence: null, entries: [ENTRY], dictionaries: 1, language: "pl" }), {
      gloss: "",
      sentence: null,
      entries: [ENTRY],
      dictionaries: 1,
      language: "pl",
    });
    // A sentence still needs a gloss to be extra to.
    assert.equal(asTranslation({ gloss: "", sentence: "Brzeg.", entries: [], language: "pl" }).sentence, null);
    for (const language of [undefined, "", 42, null, ["pl"]]) {
      assert.equal("language" in asTranslation({ gloss: "bank", sentence: null, entries: [], language }), false);
    }
  });
});

describe("asRequest", () => {
  it("accepts a translate request", () => {
    assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "hello" }), {
      kind: Message.TRANSLATE,
      text: "hello",
    });
  });

  it("drops fields it was not asked for", () => {
    assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "hello", url: "https://example.com" }), {
      kind: Message.TRANSLATE,
      text: "hello",
    });
  });

  it("keeps the sentence a translate request carries", () => {
    assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "bank", context: "The bank was steep." }), {
      kind: Message.TRANSLATE,
      text: "bank",
      context: "The bank was steep.",
    });
  });

  it("drops a sentence that is not one, rather than refusing the translation", () => {
    for (const context of [42, null, {}, ["a"], undefined]) {
      assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "bank", context }), {
        kind: Message.TRANSLATE,
        text: "bank",
      });
    }
  });

  it("keeps the language the page declares for a translate request, and drops what is not one (D193)", () => {
    assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "bank", context: "Nad rzeką.", lang: "pl" }), {
      kind: Message.TRANSLATE,
      text: "bank",
      context: "Nad rzeką.",
      lang: "pl",
    });
    for (const lang of ["", 42, null, {}, ["pl"], undefined]) {
      assert.deepEqual(asRequest({ kind: Message.TRANSLATE, text: "bank", lang }), {
        kind: Message.TRANSLATE,
        text: "bank",
      });
    }
  });

  it("accepts the requests that carry nothing", () => {
    for (const kind of [
      Message.OPEN_READER,
      Message.OPEN_LIBRARY,
      Message.OPEN_MARKS,
      Message.OPEN_VOCABULARY,
      Message.OPEN_SETTINGS,
      Message.LIST_PHRASES,
    ]) {
      assert.deepEqual(asRequest({ kind }), { kind });
    }
  });

  it("lets open-library carry nothing even when something was sent along", () => {
    // The whole point of the kind is that it is not about any tab.
    assert.deepEqual(asRequest({ kind: Message.OPEN_LIBRARY, sourceTabId: 42 }), {
      kind: Message.OPEN_LIBRARY,
    });
  });

  it("lets open-marks carry nothing even when something was sent along", () => {
    // The highlights page is not about any tab either; its per-document
    // variant exists only inside the reader, so no scope may ride in.
    assert.deepEqual(asRequest({ kind: Message.OPEN_MARKS, sourceTabId: 42, scope: "x" }), {
      kind: Message.OPEN_MARKS,
    });
  });

  it("lets open-vocabulary carry a phrase to look up, and nothing else (D197)", () => {
    // Same rule as the reading list for tabs and pairs: the page shows the
    // configured pair, and neither may ride in.
    assert.deepEqual(asRequest({ kind: Message.OPEN_VOCABULARY, sourceTabId: 42, pair: "enpl" }), {
      kind: Message.OPEN_VOCABULARY,
    });
    // The phrase the popup's field read, for the page's "Add a phrase" fold
    // to look up on arrival - kept as typed.
    assert.deepEqual(asRequest({ kind: Message.OPEN_VOCABULARY, text: " take off " }), {
      kind: Message.OPEN_VOCABULARY,
      text: " take off ",
    });
    // An extra like the settings' section: anything that is not a phrase is
    // dropped, and the page opens on its list as before.
    for (const text of ["", "   ", 42, null, {}, ["news"], undefined]) {
      assert.deepEqual(asRequest({ kind: Message.OPEN_VOCABULARY, text }), { kind: Message.OPEN_VOCABULARY });
    }
  });

  it("keeps the tab the reader is asked to read", () => {
    assert.deepEqual(asRequest({ kind: Message.OPEN_READER, sourceTabId: 42 }), {
      kind: Message.OPEN_READER,
      sourceTabId: 42,
    });
  });

  it("keeps the settings section a press names, and drops one it does not know (D192)", () => {
    assert.deepEqual(asRequest({ kind: Message.OPEN_SETTINGS, section: "dictionaries" }), {
      kind: Message.OPEN_SETTINGS,
      section: "dictionaries",
    });
    // A section is a name off a closed list, never a fragment to paste into
    // an address: anything else opens the settings at the top, as before.
    for (const section of ["models", "dictionaries#x", "", 42, null, {}, undefined]) {
      assert.deepEqual(asRequest({ kind: Message.OPEN_SETTINGS, section }), { kind: Message.OPEN_SETTINGS });
    }
  });

  it("drops a tab id that is not one, rather than refusing the reader", () => {
    for (const sourceTabId of ["42", null, {}, [42], undefined]) {
      assert.deepEqual(asRequest({ kind: Message.OPEN_READER, sourceTabId }), {
        kind: Message.OPEN_READER,
      });
    }
  });

  it("accepts a save with its meanings", () => {
    assert.deepEqual(asRequest({ kind: Message.SAVE_PHRASE, text: "bank", translations: ["bank", "brzeg"] }), {
      kind: Message.SAVE_PHRASE,
      text: "bank",
      translations: ["bank", "brzeg"],
    });
  });

  it("carries the sentence a phrase is saved from, and drops one that is not a string (D210)", () => {
    assert.deepEqual(
      asRequest({ kind: Message.SAVE_PHRASE, text: "bank", translations: ["brzeg"], context: "The bank was steep." }),
      { kind: Message.SAVE_PHRASE, text: "bank", translations: ["brzeg"], context: "The bank was steep." },
    );
    // An extra, read the way `translate` reads its own: a save must not fail
    // over the part of it the reader never asked to see.
    for (const context of [42, null, {}, ["a"], undefined]) {
      assert.deepEqual(asRequest({ kind: Message.SAVE_PHRASE, text: "bank", translations: ["brzeg"], context }), {
        kind: Message.SAVE_PHRASE,
        text: "bank",
        translations: ["brzeg"],
      });
    }
  });

  it("rejects a save whose meanings are not a list of strings", () => {
    for (const translations of [undefined, "brzeg", 7, null, ["brzeg", 7], [{}]]) {
      assert.equal(
        asRequest({ kind: Message.SAVE_PHRASE, text: "bank", translations }),
        null,
        `should have rejected ${JSON.stringify(translations) ?? "undefined"}`,
      );
    }
  });

  it("rejects a save without the phrase it is about", () => {
    assert.equal(asRequest({ kind: Message.SAVE_PHRASE, translations: ["brzeg"] }), null);
  });

  it("accepts an import with its rows", () => {
    assert.deepEqual(
      asRequest({ kind: Message.IMPORT_PHRASES, rows: [{ text: "bank", translations: ["brzeg"] }] }),
      { kind: Message.IMPORT_PHRASES, rows: [{ text: "bank", translations: ["brzeg"] }] },
    );
  });

  it("accepts an import with no rows at all - an empty file is not a broken one", () => {
    assert.deepEqual(asRequest({ kind: Message.IMPORT_PHRASES, rows: [] }), {
      kind: Message.IMPORT_PHRASES,
      rows: [],
    });
  });

  it("rejects an import whose rows are not a list", () => {
    for (const rows of [undefined, null, "bank\tbrzeg", 7, {}]) {
      assert.equal(
        asRequest({ kind: Message.IMPORT_PHRASES, rows }),
        null,
        `should have rejected ${JSON.stringify(rows) ?? "undefined"}`,
      );
    }
  });

  it("rejects the whole import over one broken row rather than importing half a file", () => {
    for (const row of [
      null,
      "bank",
      { translations: ["brzeg"] },
      { text: 42, translations: ["brzeg"] },
      { text: "bank" },
      { text: "bank", translations: "brzeg" },
      { text: "bank", translations: ["brzeg", 7] },
    ]) {
      assert.equal(
        asRequest({ kind: Message.IMPORT_PHRASES, rows: [{ text: "ok", translations: ["ok"] }, row] }),
        null,
        `should have rejected ${JSON.stringify(row) ?? "undefined"}`,
      );
    }
  });

  it("keeps of an import row only what a row is", () => {
    assert.deepEqual(
      asRequest({
        kind: Message.IMPORT_PHRASES,
        rows: [{ text: "bank", translations: ["brzeg"], id: "smuggled", createdAt: 7 }],
      }),
      { kind: Message.IMPORT_PHRASES, rows: [{ text: "bank", translations: ["brzeg"] }] },
    );
  });

  it("accepts a count report with its keys and tallies (D209)", () => {
    assert.deepEqual(
      asRequest({
        kind: Message.COUNT_PHRASES,
        recalled: ["bank", "bank", "river"],
        read: [
          ["bank", 3],
          ["shore", 1],
        ],
      }),
      {
        kind: Message.COUNT_PHRASES,
        recalled: ["bank", "bank", "river"],
        read: [
          ["bank", 3],
          ["shore", 1],
        ],
        sentences: [],
      },
    );
    assert.deepEqual(asRequest({ kind: Message.COUNT_PHRASES, recalled: [], read: [] }), {
      kind: Message.COUNT_PHRASES,
      recalled: [],
      read: [],
      sentences: [],
    });
  });

  it("accepts the sentences the openings stood in, and reads a report without them as carrying none (D216)", () => {
    assert.deepEqual(
      asRequest({
        kind: Message.COUNT_PHRASES,
        recalled: ["bank", "read"],
        read: [],
        sentences: [
          ["bank", "The bank was steep."],
          ["read", "I read it twice."],
        ],
      }),
      {
        kind: Message.COUNT_PHRASES,
        recalled: ["bank", "read"],
        read: [],
        sentences: [
          ["bank", "The bank was steep."],
          ["read", "I read it twice."],
        ],
      },
    );
    // A page older than the field sends none; an empty list is the same.
    assert.deepEqual(asRequest({ kind: Message.COUNT_PHRASES, recalled: ["bank"], read: [], sentences: [] }), {
      kind: Message.COUNT_PHRASES,
      recalled: ["bank"],
      read: [],
      sentences: [],
    });
  });

  it("refuses sentences that are not exact, as it refuses the two lists", () => {
    for (const sentences of [
      "The bank was steep.",
      {},
      [["bank"]],
      [["bank", "The bank was steep.", "extra"]],
      [["", "The bank was steep."]],
      [["bank", ""]],
      [["bank", 42]],
      [[42, "The bank was steep."]],
      ["bank"],
      [null],
      new Array(MAX_COUNTED_KEYS + 1).fill(["bank", "The bank was steep."]),
    ]) {
      assert.equal(
        asRequest({ kind: Message.COUNT_PHRASES, recalled: ["bank"], read: [], sentences }),
        null,
        JSON.stringify(sentences).slice(0, 60),
      );
    }
  });

  it("refuses a count report that is not exact, and one past the vocabulary budget", () => {
    for (const bad of [
      { recalled: "bank", read: [] },
      { recalled: [], read: {} },
      { recalled: [42], read: [] },
      { recalled: [""], read: [] },
      { recalled: [], read: [["bank"]] },
      { recalled: [], read: [["bank", 0]] },
      { recalled: [], read: [["bank", 1.5]] },
      { recalled: [], read: [["bank", "3"]] },
      { recalled: [], read: [[42, 3]] },
      { recalled: [], read: ["bank"] },
      { read: [] },
      { recalled: [] },
      { recalled: new Array(MAX_COUNTED_KEYS + 1).fill("bank"), read: [] },
      { recalled: [], read: new Array(MAX_COUNTED_KEYS + 1).fill(["bank", 1]) },
    ]) {
      assert.equal(asRequest({ kind: Message.COUNT_PHRASES, ...bad }), null, JSON.stringify(bad).slice(0, 60));
    }
  });

  it("keeps of a count report only what a report is", () => {
    assert.deepEqual(
      asRequest({ kind: Message.COUNT_PHRASES, recalled: ["bank"], read: [], url: "https://example.org/" }),
      { kind: Message.COUNT_PHRASES, recalled: ["bank"], read: [], sentences: [] },
    );
  });

  it("accepts forgetting a phrase, and only with the phrase", () => {
    assert.deepEqual(asRequest({ kind: Message.FORGET_PHRASE, text: "bank" }), {
      kind: Message.FORGET_PHRASE,
      text: "bank",
    });
    assert.equal(asRequest({ kind: Message.FORGET_PHRASE }), null);
    assert.equal(asRequest({ kind: Message.FORGET_PHRASE, text: 42 }), null);
  });

  it("accepts a look-up, and only with the text (D162)", () => {
    assert.deepEqual(asRequest({ kind: Message.LOOK_UP, text: "bank" }), {
      kind: Message.LOOK_UP,
      text: "bank",
    });
    assert.equal(asRequest({ kind: Message.LOOK_UP }), null);
    assert.equal(asRequest({ kind: Message.LOOK_UP, text: 42 }), null);
    // The page's own language rides along when it declared one (D165);
    // anything else is "the page said nothing" and the pair stands in.
    assert.deepEqual(asRequest({ kind: Message.LOOK_UP, text: "notatki", lang: "pl" }), {
      kind: Message.LOOK_UP,
      text: "notatki",
      lang: "pl",
    });
    assert.deepEqual(asRequest({ kind: Message.LOOK_UP, text: "bank", lang: "" }), {
      kind: Message.LOOK_UP,
      text: "bank",
    });
    assert.deepEqual(asRequest({ kind: Message.LOOK_UP, text: "bank", lang: 7 }), {
      kind: Message.LOOK_UP,
      text: "bank",
    });
  });

  it("rejects a translate request without text", () => {
    assert.equal(asRequest({ kind: Message.TRANSLATE }), null);
  });

  it("rejects a translate request whose text is not a string", () => {
    assert.equal(asRequest({ kind: Message.TRANSLATE, text: 42 }), null);
  });

  it("rejects anything that is not one of ours", () => {
    for (const message of [null, undefined, 7, "translate", [], {}, { kind: "drop-database" }]) {
      assert.equal(asRequest(message), null, `should have rejected ${JSON.stringify(message) ?? "undefined"}`);
    }
  });
});

describe("asResult", () => {
  it("passes a well-formed answer through", () => {
    assert.deepEqual(asResult(ok("witaj")), ok("witaj"));
    assert.deepEqual(asResult(fail(ErrorCode.TOO_LONG)), fail(ErrorCode.TOO_LONG));
  });

  it("turns a broken answer into an internal error rather than throwing", () => {
    for (const response of [undefined, null, "ok", 1, {}]) {
      assert.deepEqual(asResult(response), fail(ErrorCode.INTERNAL));
    }
  });
});

describe("asPageRequest", () => {
  it("accepts the two questions a tab is asked", () => {
    assert.deepEqual(asPageRequest({ kind: Message.GRAB_PAGE }), { kind: Message.GRAB_PAGE });
    assert.deepEqual(asPageRequest({ kind: Message.PAGE_INFO }), { kind: Message.PAGE_INFO });
  });

  it("refuses everything addressed to the background", () => {
    // A content script that answered these would be answering questions meant
    // for the side that has the database and the engine.
    for (const kind of [
      Message.TRANSLATE,
      Message.READ_PAGE,
      Message.SAVE_PHRASE,
      Message.LIST_PHRASES,
      Message.IMPORT_PHRASES,
      Message.RESTORE_VOCABULARY,
      Message.OPEN_READER,
    ]) {
      assert.equal(asPageRequest({ kind, text: "word", translations: [] }), null, kind);
    }
  });

  it("refuses anything that is not a message", () => {
    for (const message of [null, undefined, 7, "grab-page", [], {}]) {
      assert.equal(asPageRequest(message), null);
    }
  });
});

describe("asPageInfo", () => {
  it("passes an ordinary page's answer through", () => {
    assert.deepEqual(asPageInfo({ hostname: "example.test" }), {
      hostname: "example.test",
      reader: false,
    });
  });

  it("answers for the reader without asking it for a hostname", () => {
    assert.deepEqual(asPageInfo({ reader: true }), { hostname: "", reader: true });
  });

  it("treats a page with no hostname like a page that never answered", () => {
    // `file:` mostly. There is no site to switch off, and the popup says so
    // the same way it does over `about:`.
    for (const value of [{ hostname: "" }, { hostname: 7 }, {}, null, undefined, "example.test", 7]) {
      assert.equal(asPageInfo(value), null, `should have refused ${JSON.stringify(value) ?? "undefined"}`);
    }
  });
});

describe("asPage", () => {
  const page = { url: "https://example.test/a", title: "A", html: "<html></html>" };

  it("passes a page through", () => {
    assert.deepEqual(asPage(page), page);
  });

  it("accepts a tab with no title, because the article carries its own", () => {
    assert.deepEqual(asPage({ ...page, title: undefined }), { ...page, title: "" });
  });

  it("refuses anything the reader could not parse", () => {
    for (const value of [
      null,
      undefined,
      "https://example.test/a",
      { ...page, url: 42 },
      { ...page, html: 42 },
      { ...page, html: "" },
      {},
    ]) {
      assert.equal(asPage(value), null, `should have refused ${JSON.stringify(value) ?? "undefined"}`);
    }
  });
});

describe("an import row's sentence (D212)", () => {
  it("rides along as a string and is dropped as anything else, the row itself kept", () => {
    assert.deepEqual(
      asRequest({ kind: Message.IMPORT_PHRASES, rows: [{ text: "bank", translations: ["brzeg"], context: "The bank was steep." }] }),
      { kind: Message.IMPORT_PHRASES, rows: [{ text: "bank", translations: ["brzeg"], context: "The bank was steep." }] },
    );
    for (const context of [7, null, [], "", { s: 1 }]) {
      assert.deepEqual(
        asRequest({ kind: Message.IMPORT_PHRASES, rows: [{ text: "bank", translations: ["brzeg"], context }] }),
        { kind: Message.IMPORT_PHRASES, rows: [{ text: "bank", translations: ["brzeg"] }] },
      );
    }
  });
});

describe("a row of the backup of everything (D213)", () => {
  it("knows a language code the way the registry spells one", () => {
    for (const code of ["en", "pl", "zh_hant", "ast"]) assert.equal(isLanguageCode(code), true, code);
    for (const code of ["EN", "english", "e", "en-US", "zh_Hant", "", 7, null]) assert.equal(isLanguageCode(code), false, String(code));
  });

  it("keeps the pair and the phrase, carries the rest when it is what it says it is, drops it otherwise", () => {
    const whole = {
      langFrom: "en",
      langTo: "pl",
      text: "bank",
      translations: ["brzeg"],
      createdAt: 5,
      context: "The bank was steep.",
      recallCount: 3,
      lastRecallAt: 100,
      readCount: 2,
      lastReadAt: 200,
    };
    assert.deepEqual(asRestoreRow(whole), whole);
    assert.deepEqual(
      asRestoreRow({ ...whole, createdAt: "5", context: 7, recallCount: 0, lastRecallAt: 1, readCount: 2.5, lastReadAt: 2 }),
      { langFrom: "en", langTo: "pl", text: "bank", translations: ["brzeg"] },
    );
    // A moment rides only with its count.
    assert.deepEqual(asRestoreRow({ ...whole, recallCount: 3, lastRecallAt: -1, readCount: undefined, lastReadAt: 9 }), {
      langFrom: "en",
      langTo: "pl",
      text: "bank",
      translations: ["brzeg"],
      createdAt: 5,
      context: "The bank was steep.",
      recallCount: 3,
    });
    for (const broken of [
      { ...whole, langFrom: "english" },
      { ...whole, langTo: "" },
      { ...whole, text: "" },
      { ...whole, translations: "brzeg" },
      { ...whole, translations: ["brzeg", 7] },
      null,
      "bank",
    ]) {
      assert.equal(asRestoreRow(broken), null);
    }
  });

  it("is carried by restore-vocabulary, one broken row refusing the whole message", () => {
    const row = { langFrom: "en", langTo: "pl", text: "bank", translations: ["brzeg"], recallCount: 1 };
    assert.deepEqual(asRequest({ kind: Message.RESTORE_VOCABULARY, rows: [row] }), {
      kind: Message.RESTORE_VOCABULARY,
      rows: [row],
    });
    assert.deepEqual(asRequest({ kind: Message.RESTORE_VOCABULARY, rows: [] }), { kind: Message.RESTORE_VOCABULARY, rows: [] });
    assert.equal(asRequest({ kind: Message.RESTORE_VOCABULARY, rows: [row, { text: "no pair" }] }), null);
    assert.equal(asRequest({ kind: Message.RESTORE_VOCABULARY }), null);
  });
});
