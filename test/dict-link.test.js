import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeLinkProblem, parseDictionaryLink } from "../src/lib/dict/link.js";

describe("parseDictionaryLink", () => {
  it("takes an https address as it is, without its fragment", () => {
    const result = parseDictionaryLink("https://www.reader-dict.com/file/en/dict-en-en.zip#stardict");
    assert.ok(result.ok);
    assert.equal(result.value, "https://www.reader-dict.com/file/en/dict-en-en.zip");
  });

  it("supplies the scheme an address copied off a page lacks, and trims around it", () => {
    for (const pasted of ["www.reader-dict.com/file/pl/dict-pl-pl.zip", "  www.reader-dict.com/file/pl/dict-pl-pl.zip \n"]) {
      const result = parseDictionaryLink(pasted);
      assert.ok(result.ok, pasted);
      assert.equal(result.value, "https://www.reader-dict.com/file/pl/dict-pl-pl.zip");
    }
  });

  it("refuses every scheme but https, by name", () => {
    for (const pasted of [
      "http://tovotu.de/data/stardict/gcide.zip",
      "ftp://example.org/dict.zip",
      "file:///Users/someone/dict.zip",
      "javascript:alert(1)",
    ]) {
      const result = parseDictionaryLink(pasted);
      assert.ok(!result.ok, pasted);
      assert.equal(result.problem, "not_https", pasted);
    }
  });

  it("refuses an address carrying a user name or a password", () => {
    for (const pasted of ["https://user:secret@example.org/dict.zip", "https://user@example.org/dict.zip"]) {
      const result = parseDictionaryLink(pasted);
      assert.ok(!result.ok, pasted);
      assert.equal(result.problem, "credentials", pasted);
    }
  });

  it("tells an empty field from one holding no address at all", () => {
    for (const pasted of ["", "   ", "\n"]) {
      const result = parseDictionaryLink(pasted);
      assert.ok(!result.ok);
      assert.equal(result.problem, "empty", JSON.stringify(pasted));
    }
    for (const pasted of ["https://", "just a few words", "https://exa mple.org/dict.zip"]) {
      const result = parseDictionaryLink(pasted);
      assert.ok(!result.ok, pasted);
      assert.equal(result.problem, "invalid", pasted);
    }
  });

  it("has a sentence for every problem, each ending in what was stored - nothing", () => {
    for (const problem of /** @type {const} */ (["empty", "invalid", "not_https", "credentials"])) {
      assert.match(describeLinkProblem(problem), /[Nn]othing was stored/);
    }
  });
});
