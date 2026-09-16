import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { LIVE_MODELS_KEY, readLiveModels, refreshLiveModels } from "../src/lib/models/live.js";
import { registrySource } from "../src/lib/models/registry.js";

/** The real packaged source - the guard in live.js is derived from it. */
const SOURCE = registrySource().source;
const PREFIX = new URL(SOURCE).origin + "/" + (new URL(SOURCE).pathname.split("/").filter(Boolean)[0] ?? "") + "/";

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
 * An upstream index answering with one released pair whose files sit under the
 * packaged bucket - the only kind of address the guard lets through.
 *
 * @param {string} run
 */
function index(run) {
  return {
    baseUrl: `${PREFIX}models`,
    models: {
      "en-pl": [
        {
          architecture: "base-memory",
          releaseStatus: "Release",
          files: {
            model: { path: `en-pl/${run}/exported/model.enpl.intgemm.alphas.bin.gz`, uncompressedHash: "b".repeat(64) },
            lexicalShortlist: { path: `en-pl/${run}/exported/lex.50.50.enpl.s2t.bin.gz` },
            vocab: { path: `en-pl/${run}/exported/vocab.enpl.spm.gz` },
          },
        },
      ],
    },
  };
}

/**
 * @param {Array<{ status: number, body?: unknown, etag?: string }>} answers
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
      return new Response(JSON.stringify(answer.body ?? {}), {
        status: answer.status,
        headers: answer.etag === undefined ? {} : { ETag: answer.etag },
      });
    }
  );
  return { fetch: impl, seen };
}

describe("refreshLiveModels", () => {
  it("stores a converted index with its date and etag, and reads it back", async () => {
    installFakeBrowser();
    const { fetch } = fetchScript([{ status: 200, body: index("run1"), etag: '"v1"' }]);

    const result = await refreshLiveModels({ fetch, today: "2026-08-13" });
    assert.ok(result.ok);
    assert.equal(result.changed, true);
    assert.equal(result.value.models[0]?.pair, "enpl");

    const read = await readLiveModels();
    assert.equal(read?.fetchedAt, "2026-08-13");
    assert.equal(read?.models[0]?.files[0]?.sha256, "b".repeat(64));
  });

  it("sends the stored etag back and treats 304 as a confirmed, re-dated list", async () => {
    installFakeBrowser();
    const { fetch, seen } = fetchScript([
      { status: 200, body: index("run1"), etag: '"v1"' },
      { status: 304 },
    ]);

    await refreshLiveModels({ fetch, today: "2026-08-13" });
    const second = await refreshLiveModels({ fetch, today: "2026-08-14" });
    assert.ok(second.ok);
    assert.equal(second.changed, false);
    assert.equal(seen[1]?.["If-None-Match"], '"v1"');
    assert.equal((await readLiveModels())?.fetchedAt, "2026-08-14");
  });

  it("keeps the cache through refusals, empty indexes and a fetch that throws", async () => {
    installFakeBrowser();
    const good = fetchScript([{ status: 200, body: index("run1"), etag: '"v1"' }]);
    await refreshLiveModels({ fetch: good.fetch, today: "2026-08-13" });

    const bad = fetchScript([
      { status: 503 },
      { status: 200, body: { baseUrl: `${PREFIX}models`, models: {} } },
    ]);
    assert.equal((await refreshLiveModels({ fetch: bad.fetch, today: "2026-08-14" })).ok, false);
    assert.equal((await refreshLiveModels({ fetch: bad.fetch, today: "2026-08-14" })).ok, false);
    /** @type {typeof fetch} */
    const dead = /** @type {any} */ (async () => {
      throw new Error("offline");
    });
    assert.equal((await refreshLiveModels({ fetch: dead, today: "2026-08-14" })).ok, false);
    // An index the host redirected elsewhere is nobody's index (D171) - and
    // it is refused before its body is read, so the stand-in has no body.
    /** @type {typeof fetch} */
    const elsewhere = /** @type {any} */ (async () => ({ url: "https://mirror.example/models.json", ok: true, status: 200 }));
    const redirected = await refreshLiveModels({ fetch: elsewhere, today: "2026-08-14" });
    assert.equal(redirected.ok, false);
    assert.match(redirected.ok ? "" : redirected.detail, /another host/);

    const read = await readLiveModels();
    assert.equal(read?.fetchedAt, "2026-08-13", "a failure must not move the date");
    assert.equal(read?.models.length, 1);
  });

  it("refuses a cache whose addresses left the packaged bucket", async () => {
    installFakeBrowser({
      [LIVE_MODELS_KEY]: {
        fetchedAt: "2026-08-13",
        etag: null,
        models: [
          {
            pair: "enpl",
            from: "en",
            to: "pl",
            files: [
              { role: "model", url: "https://elsewhere.example/m.bin.gz", downloadBytes: 0, bytes: 0, sha256: null },
              { role: "shortlist", url: "https://elsewhere.example/l.bin.gz", downloadBytes: 0, bytes: 0, sha256: null },
              { role: "vocab", url: "https://elsewhere.example/v.spm.gz", downloadBytes: 0, bytes: 0, sha256: null },
            ],
          },
        ],
      },
    });
    assert.equal(await readLiveModels(), null);
  });

  it("reads a missing or unreadable cache as no cache at all", async () => {
    installFakeBrowser({ [LIVE_MODELS_KEY]: { fetchedAt: "not a date", models: [] } });
    assert.equal(await readLiveModels(), null);
    globalThis.browser = undefined;
    assert.equal(await readLiveModels(), null);
  });
});
