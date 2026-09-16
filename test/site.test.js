import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isSwitchedOff, sameSite, siteOf } from "../src/lib/site.js";

describe("siteOf", () => {
  it("drops a leading www. and nothing else", () => {
    assert.equal(siteOf("www.example.org"), "example.org");
    assert.equal(siteOf("example.org"), "example.org");
    assert.equal(siteOf("WWW.Example.ORG"), "example.org");
    assert.equal(siteOf("news.example.org"), "news.example.org");
    assert.equal(siteOf("www.news.example.org"), "news.example.org");
    // Only a www. that is a label of its own, not the start of a name.
    assert.equal(siteOf("wwwexample.org"), "wwwexample.org");
  });
});

describe("sameSite", () => {
  it("treats www. and the bare name as one site, and a subdomain as another", () => {
    assert.ok(sameSite("www.reapps.eu", "reapps.eu"));
    assert.ok(sameSite("reapps.eu", "www.reapps.eu"));
    assert.ok(sameSite("Example.org", "example.org"));
    assert.ok(!sameSite("news.example.org", "example.org"));
    assert.ok(!sameSite("example.org", "example.com"));
  });
});

describe("isSwitchedOff", () => {
  it("finds a page under an entry stored either way", () => {
    assert.ok(isSwitchedOff(["www.reapps.eu"], "reapps.eu"));
    assert.ok(isSwitchedOff(["reapps.eu"], "www.reapps.eu"));
    assert.ok(!isSwitchedOff(["reapps.eu"], "blog.reapps.eu"));
    assert.ok(!isSwitchedOff([], "reapps.eu"));
  });
});
