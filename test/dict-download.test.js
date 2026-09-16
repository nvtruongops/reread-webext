import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_ARCHIVE_BYTES, describeDictDownloadProblem, downloadArchive } from "../src/lib/dict/download.js";

const URL_UNDER_TEST = "https://download.wikdict.com/dictionaries/stardict/wikdict-en-pl.zip";

/**
 * @param {Uint8Array[]} chunks
 * @param {Record<string, string>} [headers]
 * @returns {typeof fetch}
 */
function fetchOf(chunks, headers = {}) {
  return async () => {
    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers });
  };
}

describe("downloadArchive", () => {
  it("hands the bytes back whole, with progress against Content-Length", async () => {
    /** @type {{ received: number, total: number }[]} */
    const seen = [];
    const result = await downloadArchive(URL_UNDER_TEST, {
      fetch: fetchOf([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])], { "content-length": "5" }),
      onProgress: (progress) => seen.push(progress),
    });

    assert.ok(result.ok);
    assert.deepEqual([...new Uint8Array(result.value)], [1, 2, 3, 4, 5]);
    assert.deepEqual(seen.at(-1), { received: 5, total: 5 });
  });

  it("reports a total of zero when the server names none, rather than inventing one", async () => {
    /** @type {{ received: number, total: number }[]} */
    const seen = [];
    const result = await downloadArchive(URL_UNDER_TEST, {
      fetch: fetchOf([new Uint8Array([1, 2, 3])]),
      onProgress: (progress) => seen.push(progress),
    });

    assert.ok(result.ok);
    assert.deepEqual(seen.at(-1), { received: 3, total: 0 });
  });

  it("turns an HTTP refusal into a sentence-sized problem", async () => {
    const result = await downloadArchive(URL_UNDER_TEST, {
      fetch: async () => new Response(null, { status: 404, statusText: "Not Found" }),
    });
    assert.ok(!result.ok);
    assert.equal(result.problem, "http");
    assert.match(result.detail ?? "", /404/);
  });

  it("refuses an archive the host redirected elsewhere, before reading a byte of it (D171)", async () => {
    const result = await downloadArchive(URL_UNDER_TEST, {
      // Only the answer's address is looked at before the refusal.
      fetch: /** @type {typeof fetch} */ (
        /** @type {unknown} */ (async () => ({ url: "https://mirror.example/wikdict-en-pl.zip", ok: true, status: 200 }))
      ),
    });
    assert.ok(!result.ok);
    assert.equal(result.problem, "http");
    assert.match(result.detail ?? "", /another host/);
  });

  it("follows the host's redirect when the address is the reader's own, and says which host answered", async () => {
    const result = await downloadArchive(URL_UNDER_TEST, {
      anyHost: true,
      fetch: /** @type {typeof fetch} */ (
        /** @type {unknown} */ (
          async () => ({
            url: "https://mirror.example/wikdict-en-pl.zip",
            ok: true,
            status: 200,
            headers: new Headers({ "content-length": "3" }),
            body: null,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          })
        )
      ),
    });
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.host, "mirror.example");
    assert.deepEqual([...new Uint8Array(result.value)], [1, 2, 3]);
  });

  it("names the host it asked when the answer carries no address of its own", async () => {
    const result = await downloadArchive(URL_UNDER_TEST, { fetch: fetchOf([new Uint8Array([1])]) });
    assert.ok(result.ok);
    assert.equal(result.host, "download.wikdict.com");
  });

  it("turns a dead network into a problem, not an exception", async () => {
    const result = await downloadArchive(URL_UNDER_TEST, {
      fetch: async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    });
    assert.ok(!result.ok);
    assert.equal(result.problem, "network");
  });

  it("refuses on the header alone when the server announces too much", async () => {
    const result = await downloadArchive(URL_UNDER_TEST, {
      fetch: fetchOf([new Uint8Array(1)], { "content-length": String(MAX_ARCHIVE_BYTES + 1) }),
    });
    assert.ok(!result.ok);
    assert.equal(result.problem, "too_big");
  });

  it("stops on the bytes themselves when the header lied small", async () => {
    const result = await downloadArchive(URL_UNDER_TEST, {
      fetch: fetchOf([new Uint8Array(MAX_ARCHIVE_BYTES + 1)], { "content-length": "10" }),
    });
    assert.ok(!result.ok);
    assert.equal(result.problem, "too_big");
  });

  it("answers cancelled the moment the signal says so, even mid-body", async () => {
    const controller = new AbortController();
    const result = await downloadArchive(URL_UNDER_TEST, {
      signal: controller.signal,
      fetch: fetchOf([new Uint8Array([1]), new Uint8Array([2])]),
      onProgress: () => controller.abort(),
    });
    assert.ok(!result.ok);
    assert.equal(result.problem, "cancelled");
  });

  it("answers cancelled without a request when the signal was already pulled", async () => {
    const controller = new AbortController();
    controller.abort();
    let asked = false;
    const result = await downloadArchive(URL_UNDER_TEST, {
      signal: controller.signal,
      fetch: async () => {
        asked = true;
        return new Response(null);
      },
    });
    assert.ok(!result.ok);
    assert.equal(result.problem, "cancelled");
    assert.equal(asked, false);
  });

  it("has a sentence for every problem, each ending in what was stored - nothing", () => {
    for (const problem of /** @type {const} */ (["network", "http", "too_big", "cancelled"])) {
      assert.match(describeDictDownloadProblem(problem, "detail"), /[Nn]othing was stored/);
    }
  });
});
