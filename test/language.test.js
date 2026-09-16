import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { languageName, pairLabel } from "../src/lib/language.js";

describe("languageName", () => {
  it("names the codes the registry actually contains", () => {
    assert.equal(languageName("en"), "English");
    assert.equal(languageName("pl"), "Polish");
    assert.equal(languageName("nb"), "Norwegian Bokmål");
  });

  it("reads the registry's underscore as BCP-47's hyphen", () => {
    assert.equal(languageName("zh_hant"), "Traditional Chinese");
  });

  it("answers the code itself when there is no name for it", () => {
    assert.equal(languageName("xx"), "xx");
  });

  it("answers the code itself when it is not a language tag at all", () => {
    // `Intl.DisplayNames` throws on these rather than answering; the caller
    // is a settings page mid-render, so here that becomes a plain string.
    assert.equal(languageName("not a code"), "not a code");
    assert.equal(languageName(""), "");
  });
});

describe("pairLabel", () => {
  it("writes a direction the way every page shows it", () => {
    assert.equal(pairLabel("en", "pl"), "English to Polish");
  });

  it("degrades one side at a time", () => {
    assert.equal(pairLabel("xx", "pl"), "xx to Polish");
  });
});
