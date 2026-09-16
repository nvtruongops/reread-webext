import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeHostProblem, parseHostname } from "../src/lib/host.js";

describe("parseHostname", () => {
  it("keeps the site part of whatever was pasted, in the browser's own form, without a leading www.", () => {
    for (const [typed, host] of /** @type {[string, string][]} */ ([
      ["www.example.org", "example.org"],
      ["  www.example.org  ", "example.org"],
      ["https://www.example.org/some/page?x=1#top", "example.org"],
      ["http://example.org:8080/", "example.org"],
      ["WWW.Example.ORG", "example.org"],
      ["example.org/path", "example.org"],
      ["news.example.org", "news.example.org"],
      ["localhost", "localhost"],
      ["192.168.1.10", "192.168.1.10"],
    ])) {
      const result = parseHostname(typed);
      assert.ok(result.ok, typed);
      assert.equal(result.value, host, typed);
    }
  });

  it("writes an international name the way the page's own hostname reads", () => {
    const result = parseHostname("www.przykład.pl");
    assert.ok(result.ok);
    assert.equal(result.value, new URL("https://przykład.pl/").hostname);
  });

  it("tells an empty field from one holding no address at all", () => {
    for (const typed of ["", "   ", "\n"]) {
      const result = parseHostname(typed);
      assert.ok(!result.ok);
      assert.equal(result.problem, "empty", JSON.stringify(typed));
    }
    for (const typed of ["https://", "just a few words", "exa mple.org"]) {
      const result = parseHostname(typed);
      assert.ok(!result.ok, typed);
      assert.equal(result.problem, "invalid", typed);
    }
  });

  it("has a sentence for every problem", () => {
    assert.match(describeHostProblem("empty"), /address/);
    assert.match(describeHostProblem("invalid"), /address/);
  });
});
