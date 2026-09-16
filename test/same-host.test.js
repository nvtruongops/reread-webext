import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answeredByHost } from "../src/lib/same-host.js";

const ASKED = "https://download.wikdict.com/dictionaries/stardict/wikdict-en-pl.zip";

/**
 * The other half of "exactly two servers" (D171): `fetch` follows redirects
 * by itself, so the answer's own address is held to the request's origin.
 */
describe("answeredByHost", () => {
  it("takes an answer from the host that was asked, moved within it or not", () => {
    assert.equal(answeredByHost({ url: ASKED }, ASKED), true);
    assert.equal(answeredByHost({ url: "https://download.wikdict.com/moved/wikdict-en-pl.zip" }, ASKED), true);
  });

  it("refuses an answer from anywhere else, however close the name", () => {
    for (const url of [
      "https://mirror.example/wikdict-en-pl.zip",
      "https://cdn.download.wikdict.com/wikdict-en-pl.zip",
      "http://download.wikdict.com/dictionaries/stardict/wikdict-en-pl.zip",
      "https://download.wikdict.com:8443/x.zip",
    ]) {
      assert.equal(answeredByHost({ url }, ASKED), false, `should refuse ${url}`);
    }
  });

  it("stands aside for an answer with no address to judge - a stand-in, an old shim", () => {
    assert.equal(answeredByHost({ url: "" }, ASKED), true);
    assert.equal(answeredByHost({}, ASKED), true);
  });

  it("refuses what is not an address at all", () => {
    assert.equal(answeredByHost({ url: "not a url" }, ASKED), false);
  });
});
