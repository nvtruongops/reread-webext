import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ENGINE_BINARY, readEngineBinary } from "../src/lib/translator/providers/bergamot/binary.js";

beforeEach(() => {
  globalThis.browser = /** @type {any} */ ({
    runtime: { id: "reread@test", getURL: (/** @type {string} */ path) => `moz-extension://test/${path}` },
  });
});

afterEach(() => {
  globalThis.browser = undefined;
});

describe("readEngineBinary", () => {
  it("reads the engine's binary out of the package, on the page (D196)", async () => {
    const bytes = new ArrayBuffer(16);
    /** @type {string[]} */
    const asked = [];
    const fetchImpl = /** @type {any} */ (
      async (/** @type {unknown} */ url) => {
        asked.push(String(url));
        return { ok: true, status: 200, arrayBuffer: async () => bytes };
      }
    );

    assert.equal(await readEngineBinary(fetchImpl), bytes);
    assert.deepEqual(asked, [`moz-extension://test/${ENGINE_BINARY}`]);
    // The path the package really carries - `tools/check-vendor.sh` pins the file itself.
    assert.equal(ENGINE_BINARY, "vendor/bergamot/bergamot-translator-worker.wasm");
  });

  it("says that the binary is missing from the package, with the status", async () => {
    const fetchImpl = /** @type {any} */ (async () => ({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) }));
    await assert.rejects(readEngineBinary(fetchImpl), /missing from the package \(HTTP 404\)/);
  });

  it("passes a read that failed outright through as the error it was", async () => {
    const fetchImpl = /** @type {any} */ (
      async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      }
    );
    await assert.rejects(readEngineBinary(fetchImpl), TypeError);
  });
});
