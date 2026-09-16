import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { catalogSource } from "../src/lib/dict/catalog.js";
import {
  LIVE_DICTIONARIES_KEY,
  convertListing,
  readLiveDictionaries,
  refreshLiveDictionaries,
} from "../src/lib/dict/live.js";

/** The real packaged source - the guard in live.js is derived from it. */
const SOURCE = catalogSource().source;

/**
 * @param {Record<string, unknown>} [initial]
 * @returns {Record<string, unknown>} the store behind the fake
 */
function installFakeBrowser(initial = {}) {
  /** @type {Record<string, unknown>} */
  const store = { ...initial };
  globalThis.browser = /** @type {any} */ ({
    runtime: { id: "reread@test" },
    storage: {
      local: {
        /** @param {string} key */
        async get(key) {
          return key in store ? { [key]: store[key] } : {};
        },
        /** @param {Record<string, unknown>} items */
        async set(items) {
          Object.assign(store, items);
        },
      },
    },
  });
  return store;
}

afterEach(() => {
  globalThis.browser = undefined;
});

/**
 * A slice of the nginx autoindex the listing really is: anchors for the
 * archives, plus the family of neighbours the pattern must leave alone.
 *
 * @param {string[]} names
 */
function listing(names) {
  const rows = names.map((name) => `<a href="${name}">${name}</a> 12-Aug-2026 03:14 4711`);
  return `<html><body><h1>Index of /dictionaries/stardict/</h1><pre><a href="../">../</a>\n${rows.join("\n")}\n</pre></body></html>`;
}

/**
 * @param {Array<{ status: number, body?: string, etag?: string }>} answers
 * @returns {{ fetch: typeof fetch, seen: Array<Record<string, string>> }}
 */
function fetchScript(answers) {
  /** @type {Array<Record<string, string>>} */
  const seen = [];
  let at = 0;
  /** @type {typeof fetch} */
  const impl = /** @type {any} */ (
    async (/** @type {string} */ url, /** @type {RequestInit} */ options) => {
      assert.equal(url, SOURCE);
      seen.push(/** @type {Record<string, string>} */ (options?.headers ?? {}));
      const answer = answers[at++] ?? { status: 500 };
      if (answer.status === 304) return new Response(null, { status: 304 });
      return new Response(answer.body ?? "", {
        status: answer.status,
        headers: answer.etag === undefined ? {} : { ETag: answer.etag },
      });
    }
  );
  return { fetch: impl, seen };
}

describe("convertListing", () => {
  it("reads the archives out of the listing and builds every address itself", () => {
    const entries = convertListing(listing(["wikdict-en-pl.zip", "wikdict-de-en.zip"]), SOURCE);
    assert.deepEqual(entries, [
      { from: "de", to: "en", url: `${SOURCE}wikdict-de-en.zip` },
      { from: "en", to: "pl", url: `${SOURCE}wikdict-en-pl.zip` },
    ]);
  });

  it("leaves everything that is not a dictionary archive where it is", () => {
    const html = listing([
      "wikdict-en-pl.zip",
      "wikdict-en-pl.zip", // listed twice - kept once
      "wikdict-en-en.zip", // a language to itself
      "wikdict-EN-pl.zip", // upper case is not a WikDict name
      "wikdict-english-pl.zip", // not a code
      "readme.txt",
      "wikdict-en-pl.tar.gz",
    ]);
    assert.deepEqual(
      convertListing(html, SOURCE).map((one) => `${one.from}-${one.to}`),
      ["en-pl"],
    );
  });

  it("matches nothing on a page of some other shape", () => {
    assert.deepEqual(convertListing("<html><body>It moved.</body></html>", SOURCE), []);
  });
});

describe("refreshLiveDictionaries", () => {
  it("stores a converted listing with its date and etag, and reads it back", async () => {
    installFakeBrowser();
    const { fetch } = fetchScript([{ status: 200, body: listing(["wikdict-en-pl.zip"]), etag: '"v1"' }]);

    const result = await refreshLiveDictionaries({ fetch, today: "2026-08-13" });
    assert.ok(result.ok);
    assert.equal(result.changed, true);

    const read = await readLiveDictionaries();
    assert.equal(read?.fetchedAt, "2026-08-13");
    assert.deepEqual(read?.dictionaries, [{ from: "en", to: "pl", url: `${SOURCE}wikdict-en-pl.zip` }]);
  });

  it("sends the stored etag back and treats 304 as a confirmed, re-dated list", async () => {
    installFakeBrowser();
    const { fetch, seen } = fetchScript([
      { status: 200, body: listing(["wikdict-en-pl.zip"]), etag: '"v1"' },
      { status: 304 },
    ]);

    await refreshLiveDictionaries({ fetch, today: "2026-08-13" });
    const second = await refreshLiveDictionaries({ fetch, today: "2026-08-14" });
    assert.ok(second.ok);
    assert.equal(second.changed, false);
    assert.equal(seen[1]?.["If-None-Match"], '"v1"');
    assert.equal((await readLiveDictionaries())?.fetchedAt, "2026-08-14");
  });

  it("keeps the cache through refusals, empty listings and a fetch that throws", async () => {
    installFakeBrowser();
    const good = fetchScript([{ status: 200, body: listing(["wikdict-en-pl.zip"]), etag: '"v1"' }]);
    await refreshLiveDictionaries({ fetch: good.fetch, today: "2026-08-13" });

    const bad = fetchScript([{ status: 503 }, { status: 200, body: "<html>It moved.</html>" }]);
    assert.equal((await refreshLiveDictionaries({ fetch: bad.fetch, today: "2026-08-14" })).ok, false);
    assert.equal((await refreshLiveDictionaries({ fetch: bad.fetch, today: "2026-08-14" })).ok, false);
    /** @type {typeof fetch} */
    const dead = /** @type {any} */ (async () => {
      throw new Error("offline");
    });
    assert.equal((await refreshLiveDictionaries({ fetch: dead, today: "2026-08-14" })).ok, false);
    // A listing the host redirected elsewhere is nobody's listing (D171) -
    // refused before its body is read, so the stand-in has no body.
    /** @type {typeof fetch} */
    const elsewhere = /** @type {any} */ (async () => ({ url: "https://mirror.example/stardict/", ok: true, status: 200 }));
    const redirected = await refreshLiveDictionaries({ fetch: elsewhere, today: "2026-08-14" });
    assert.equal(redirected.ok, false);
    assert.match(redirected.ok ? "" : redirected.detail, /another host/);

    const read = await readLiveDictionaries();
    assert.equal(read?.fetchedAt, "2026-08-13", "a failure must not move the date");
    assert.equal(read?.dictionaries.length, 1);
  });

  it("refuses a cache whose addresses left the packaged listing", async () => {
    installFakeBrowser({
      [LIVE_DICTIONARIES_KEY]: {
        fetchedAt: "2026-08-13",
        etag: null,
        dictionaries: [{ from: "en", to: "pl", url: "https://elsewhere.example/wikdict-en-pl.zip" }],
      },
    });
    assert.equal(await readLiveDictionaries(), null);
  });

  it("reads a missing or unreadable cache as no cache at all", async () => {
    installFakeBrowser({ [LIVE_DICTIONARIES_KEY]: { fetchedAt: "not a date", dictionaries: [] } });
    assert.equal(await readLiveDictionaries(), null);
    globalThis.browser = undefined;
    assert.equal(await readLiveDictionaries(), null);
  });
});
