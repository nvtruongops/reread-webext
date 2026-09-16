import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dictionarySourcesLink } from "../src/lib/sources.js";

describe("dictionarySourcesLink", () => {
  it("sends a Polish interface to the Polish page, and every other to the English one", () => {
    assert.deepEqual(dictionarySourcesLink("pl"), {
      href: "https://reapps.eu/pl/read#faq-dictionary-sources",
      label: "reapps.eu/pl/read",
    });
    assert.deepEqual(dictionarySourcesLink("pl-PL"), dictionarySourcesLink("pl"));
    for (const locale of ["en", "en-US", "de", "fr", "es", "uk", ""]) {
      assert.deepEqual(dictionarySourcesLink(locale), {
        href: "https://reapps.eu/read#faq-dictionary-sources",
        label: "reapps.eu/read",
      });
    }
  });

  it("names the page the way the reader sees it, with the anchor in the address alone", () => {
    for (const locale of ["pl", "en"]) {
      const { href, label } = dictionarySourcesLink(locale);
      assert.ok(href.startsWith("https://"), "the address is not https");
      assert.ok(href.endsWith("#faq-dictionary-sources"), "the address lost the answer's anchor");
      assert.ok(href.includes(label), "the words do not name the page they open");
      assert.doesNotMatch(label, /#|https?:/, "the words carry more than the page's name");
    }
  });
});
