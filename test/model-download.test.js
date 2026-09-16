import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { gzipSync } from "node:zlib";

import { describeDownloadProblem, downloadModel, sha256Hex } from "../src/lib/models/download.js";

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function sum(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Model files do not compress to nothing, and a fixture that did would arrive
 * in one chunk and quietly stop testing anything about reading a stream. These
 * bytes are deterministic and incompressible enough to behave like the real
 * thing.
 *
 * @param {number} seed
 * @param {number} length
 * @returns {Uint8Array}
 */
function noise(seed, length) {
  const bytes = new Uint8Array(length);
  let state = seed >>> 0;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    bytes[index] = (state >>> 24) & 0xff;
  }
  return bytes;
}

/**
 * @param {string} text
 * @param {number} times
 * @returns {Uint8Array}
 */
function content(text, times = 1) {
  return new TextEncoder().encode(text.repeat(times));
}

/**
 * A model as the registry describes it, next to the bytes a server would answer
 * with. Kept together because every test needs both halves to agree - or, in
 * the tests about refusing a download, to disagree in exactly one way.
 *
 * @param {{ gzip?: boolean, tamper?: boolean, truncate?: boolean }} [how]
 */
function fixture(how = {}) {
  const parts = [
    { role: "model", name: "model.enpl.intgemm.alphas.bin.gz", body: noise(1, 8192) },
    { role: "shortlist", name: "lex.50.50.enpl.s2t.bin.gz", body: noise(2, 1024) },
    { role: "vocab", name: "vocab.enpl.spm.gz", body: content("vocab ", 20) },
  ];

  /** @type {Record<string, Uint8Array>} */
  const served = {};
  const files = parts.map((part) => {
    const url = `https://example.test/${part.name}`;
    const stored = how.truncate && part.role === "model" ? part.body.slice(0, 10) : part.body;
    const wire = how.gzip === false ? stored : new Uint8Array(gzipSync(stored));
    served[url] = wire;
    return {
      role: part.role,
      url,
      downloadBytes: wire.byteLength,
      bytes: part.body.byteLength,
      sha256: how.tamper && part.role === "model" ? "0".repeat(64) : sum(part.body),
    };
  });

  /** @type {import("../src/lib/models/registry.js").RegistryModel} */
  const model = {
    pair: "enpl",
    from: "en",
    to: "pl",
    downloadBytes: files.reduce((total, file) => total + file.downloadBytes, 0),
    bytes: files.reduce((total, file) => total + file.bytes, 0),
    files: /** @type {import("../src/lib/models/registry.js").RegistryFile[]} */ (files),
  };

  return { served, model };
}

/**
 * The answers are shaped by hand rather than built as real `Response` objects,
 * because a real one hands its body over in whatever chunks it likes - and the
 * loop under test is the one that reads a body chunk by chunk while reporting
 * progress and watching for a cancel.
 *
 * @param {Record<string, Uint8Array>} served
 * @param {{ chunk?: number, fail?: "throw" }} [how]
 * @returns {typeof fetch}
 */
function server(served, how = {}) {
  const chunk = how.chunk ?? 4096;

  return /** @type {typeof fetch} */ (
    /** @type {unknown} */ (
      async (/** @type {any} */ url) => {
        if (how.fail === "throw") throw new TypeError("NetworkError when attempting to fetch resource.");

        const body = served[String(url)];
        if (body === undefined) {
          return { ok: false, status: 404, statusText: "Not Found", body: null, arrayBuffer: async () => new ArrayBuffer(0) };
        }

        let at = 0;
        const stream = new ReadableStream({
          pull(controller) {
            if (at >= body.byteLength) {
              controller.close();
              return;
            }
            controller.enqueue(body.slice(at, at + chunk));
            at += chunk;
          },
        });

        return { ok: true, status: 200, statusText: "OK", body: stream, arrayBuffer: async () => body.buffer };
      }
    )
  );
}

describe("sha256Hex", () => {
  it("agrees with a digest computed anywhere else", async () => {
    const bytes = content("the quick brown fox");
    assert.equal(await sha256Hex(/** @type {ArrayBuffer} */ (bytes.buffer)), sum(bytes));
  });
});

describe("downloadModel", () => {
  it("returns the three files, unpacked, ready to store", async () => {
    const { model, served } = fixture();
    const result = await downloadModel(model, { fetch: server(served) });

    assert.ok(result.ok, "download refused");
    assert.equal(result.value.pair, "enpl");
    assert.equal(result.value.model.byteLength, model.files[0]?.bytes);
    assert.equal(result.value.shortlist.byteLength, model.files[1]?.bytes);
    assert.equal(result.value.vocabs.length, 1);
    assert.equal(new TextDecoder().decode(result.value.vocabs[0]), "vocab ".repeat(20));
  });

  it("takes a file that was never gzipped, because the name is not the proof", async () => {
    const { model, served } = fixture({ gzip: false });
    const result = await downloadModel(model, { fetch: server(served) });
    assert.ok(result.ok);
    assert.equal(result.value.model.byteLength, model.files[0]?.bytes);
  });

  it("reports progress that only grows and ends at the announced total", async () => {
    const { model, served } = fixture();
    /** @type {import("../src/lib/models/download.js").DownloadProgress[]} */
    const seen = [];
    const result = await downloadModel(model, { fetch: server(served, { chunk: 512 }), onProgress: (p) => seen.push(p) });

    assert.ok(result.ok);
    assert.ok(seen.length > 3, "one call per file is not progress");
    for (const [index, progress] of seen.entries()) {
      assert.ok(progress.received > (seen[index - 1]?.received ?? 0), "progress went backwards");
      assert.ok(progress.received <= progress.total, "progress ran past its own total");
    }
    assert.equal(seen.at(-1)?.received, model.downloadBytes);
  });

  it("throws away a file whose checksum is not the one in the registry", async () => {
    const { model, served } = fixture({ tamper: true });
    const result = await downloadModel(model, { fetch: server(served) });

    assert.ok(!result.ok);
    assert.equal(result.problem, "checksum");
    assert.match(result.detail ?? "", /model\.enpl/);
  });

  it("throws away a file that arrived shorter than it should be", async () => {
    const { model, served } = fixture({ truncate: true });
    const result = await downloadModel(model, { fetch: server(served) });

    assert.ok(!result.ok);
    assert.equal(result.problem, "size");
  });

  it("stops unpacking a file that grows past the size the entry claims (D171)", async () => {
    const { model, served } = fixture();
    const file = model.files[0];
    assert.ok(file !== undefined);
    // A megabyte of zeros gzips to a kilobyte; the entry claims what a model
    // of this fixture's size claims, and the inflate stops at that claim.
    served[file.url] = new Uint8Array(gzipSync(new Uint8Array(1 << 20)));
    const result = await downloadModel(model, { fetch: server(served) });

    assert.ok(!result.ok);
    assert.equal(result.problem, "size");
    assert.match(result.detail ?? "", /unpacks to more than/);
  });

  it("refuses a file the host redirected elsewhere, before reading a byte of it (D171)", async () => {
    const { model } = fixture();
    // Only the answer's address is looked at before the refusal, so the
    // stand-in needs nothing else - a body read here would be the bug.
    const elsewhere = /** @type {typeof fetch} */ (
      /** @type {unknown} */ (async () => ({ url: "https://mirror.example/model.bin.gz", ok: true, status: 200 }))
    );
    const result = await downloadModel(model, { fetch: elsewhere });

    assert.ok(!result.ok);
    assert.equal(result.problem, "http");
    assert.match(result.detail ?? "", /another host/);
  });

  it("says what the server answered when it will not serve the file", async () => {
    const { model } = fixture();
    const result = await downloadModel(model, { fetch: server({}) });

    assert.ok(!result.ok);
    assert.equal(result.problem, "http");
    assert.match(result.detail ?? "", /404/);
  });

  it("calls a browser with no network exactly that, and stores nothing", async () => {
    const { model, served } = fixture();
    const result = await downloadModel(model, { fetch: server(served, { fail: "throw" }) });

    assert.ok(!result.ok);
    assert.equal(result.problem, "network");
  });

  it("refuses before opening a connection when the signal is already aborted", async () => {
    const { model, served } = fixture();
    let calls = 0;
    const counted = /** @type {typeof fetch} */ (
      (/** @type {any} */ url, /** @type {any} */ init) => {
        calls += 1;
        return server(served)(url, init);
      }
    );

    const result = await downloadModel(model, { fetch: counted, signal: AbortSignal.abort() });
    assert.ok(!result.ok);
    assert.equal(result.problem, "cancelled");
    assert.equal(calls, 0, "asked the server for a file it had already been told not to fetch");
  });

  it("stops mid-file when cancel is pressed, without waiting for the rest", async () => {
    const { model, served } = fixture();
    const controller = new AbortController();
    let chunks = 0;

    const result = await downloadModel(model, {
      fetch: server(served, { chunk: 256 }),
      signal: controller.signal,
      onProgress: () => {
        chunks += 1;
        if (chunks === 2) controller.abort();
      },
    });

    assert.ok(!result.ok);
    assert.equal(result.problem, "cancelled");
    assert.ok(chunks < 5, `read ${chunks} chunks after cancel`);
  });
});

describe("describeDownloadProblem", () => {
  it("has a sentence of its own for every way a download can fail", () => {
    const problems = /** @type {const} */ (["network", "http", "size", "checksum", "unpack", "cancelled"]);
    const sentences = new Set();

    for (const problem of problems) {
      const sentence = describeDownloadProblem(problem, "model.enpl.bin");
      assert.ok(sentence.length > 0, `${problem} has no sentence`);
      sentences.add(sentence);
    }

    assert.equal(sentences.size, problems.length, "two problems say the same thing");
  });

  it("says nothing was stored, whichever way it failed", () => {
    for (const problem of /** @type {const} */ (["network", "http", "size", "checksum", "unpack", "cancelled"])) {
      assert.match(describeDownloadProblem(problem), /stored|thrown away/);
    }
  });
});
