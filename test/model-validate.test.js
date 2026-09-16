import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { testLoadModel } from "../src/lib/models/validate.js";

/**
 * The trial load on the settings page, against a stand-in worker: what it
 * is handed and in which order (the engine's binary first, transferred; the
 * files after it, cloned - D196), and that nothing is waved through when
 * there was nothing to check with.
 */

/** @type {FakeWorker[]} */
let spawned = [];

/**
 * A call name -> the sentence the fake worker fails that call with.
 * @type {Map<string, string>}
 */
const failures = new Map();

class FakeWorker {
  /** @param {string} url */
  constructor(url) {
    this.url = url;
    /** @type {Array<{ message: any, transfer: Transferable[] }>} */
    this.posted = [];
    /** @type {Map<string, Array<(event: any) => void>>} */
    this.listeners = new Map();
    this.terminated = false;
    spawned.push(this);
  }

  /**
   * @param {string} type
   * @param {(event: any) => void} listener
   */
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  /**
   * @param {string} type
   * @param {unknown} event
   */
  fire(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  /**
   * @param {any} message
   * @param {Transferable[]} [transfer]
   */
  postMessage(message, transfer = []) {
    this.posted.push({ message, transfer });
    queueMicrotask(() => {
      if (this.terminated) return;
      const failure = failures.get(message.name);
      const reply =
        failure === undefined ? { id: message.id, result: true } : { id: message.id, error: { message: failure } };
      this.fire("message", { data: reply });
    });
  }

  terminate() {
    this.terminated = true;
  }
}

/** @param {number} index */
function spawnedAt(index) {
  const worker = spawned[index];
  assert.ok(worker !== undefined, `no worker #${index} was spawned`);
  return worker;
}

/**
 * @param {FakeWorker} worker
 * @param {number} index
 */
function postedTo(worker, index) {
  const post = worker.posted[index];
  assert.ok(post !== undefined, `nothing was posted to the worker as #${index}`);
  return post;
}

const PAIR = { from: "en", to: "pl" };
const FILES = {
  pair: "enpl",
  model: new ArrayBuffer(4),
  shortlist: new ArrayBuffer(3),
  vocabs: [new ArrayBuffer(2)],
  config: { a: 1 },
};
const BINARY = new ArrayBuffer(16);
const readBinary = async () => BINARY;

const ORIGINAL = { Worker: globalThis.Worker, browser: globalThis.browser };

beforeEach(() => {
  spawned = [];
  failures.clear();
  globalThis.browser = /** @type {any} */ ({
    runtime: { id: "reread@test", getURL: (/** @type {string} */ path) => `moz-extension://test/${path}` },
  });
  globalThis.Worker = /** @type {any} */ (FakeWorker);
});

afterEach(() => {
  Object.assign(globalThis, ORIGINAL);
});

describe("testLoadModel", () => {
  it("hands the worker the engine's binary first, transferred, then the files, cloned (D196)", async () => {
    assert.deepEqual(await testLoadModel(PAIR, FILES, readBinary), { ok: true });

    const worker = spawnedAt(0);
    assert.equal(worker.url, "moz-extension://test/background/engine.worker.js");
    assert.deepEqual(
      worker.posted.map((post) => post.message.name),
      ["start", "load"],
    );
    assert.equal(postedTo(worker, 0).message.args[0], BINARY);
    assert.deepEqual(postedTo(worker, 0).transfer, [BINARY]);
    // The files are about to be stored: cloned, never transferred.
    assert.deepEqual(postedTo(worker, 1).transfer, []);
    assert.deepEqual(postedTo(worker, 1).message.args, [
      PAIR,
      { model: FILES.model, shortlist: FILES.shortlist, vocabs: FILES.vocabs, config: { a: 1 } },
    ]);
    // Thrown away once it has answered.
    assert.equal(worker.terminated, true);
  });

  it("checks nothing when the binary could not be read, and says why", async () => {
    const verdict = await testLoadModel(PAIR, FILES, async () => {
      throw new Error("engine binary is missing from the package (HTTP 404)");
    });
    assert.deepEqual(verdict, { ok: false, detail: "engine binary is missing from the package (HTTP 404)" });
    assert.equal(spawnedAt(0).terminated, true);
    assert.deepEqual(spawnedAt(0).posted, []);
  });

  it("refuses a model on an engine that did not come up, with the engine's sentence", async () => {
    failures.set("start", "CompileError: wasm validation error");
    assert.deepEqual(await testLoadModel(PAIR, FILES, readBinary), {
      ok: false,
      detail: "CompileError: wasm validation error",
    });
    assert.equal(spawnedAt(0).terminated, true);
  });

  it("refuses a model the engine refused", async () => {
    failures.set("load", "vocabulary is not a SentencePiece model");
    assert.deepEqual(await testLoadModel(PAIR, FILES, readBinary), {
      ok: false,
      detail: "vocabulary is not a SentencePiece model",
    });
  });

  it("checks nothing when no worker can be made", async () => {
    globalThis.Worker = /** @type {any} */ (
      class {
        constructor() {
          throw new Error("no workers here");
        }
      }
    );
    assert.deepEqual(await testLoadModel(PAIR, FILES, readBinary), { ok: false, detail: "no workers here" });
  });
});
