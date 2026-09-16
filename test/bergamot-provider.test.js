import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ErrorCode, fail, ok } from "../src/lib/protocol.js";
import { ENGINE_BINARY } from "../src/lib/translator/providers/bergamot/binary.js";
import { bergamot } from "../src/lib/translator/providers/bergamot/index.js";

/**
 * The provider against stand-ins for the three things it reaches: the
 * worker, the page's `fetch` for the engine's binary, and the model
 * database. What these tests pin is the first conversation with a fresh
 * worker - the binary handed over, transferred, before any model - and what
 * becomes of a worker whose engine never came up (D196). The engine itself
 * is not here: the worker answers the way the real one does once its engine
 * and model are in, and fails the way it is told to.
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
    /** @type {Set<string>} */
    this.models = new Set();
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
        failure === undefined
          ? { id: message.id, result: this.answer(message) }
          : { id: message.id, error: { message: failure } };
      this.fire("message", { data: reply });
    });
  }

  /** @param {{ name: string, args: any[] }} message */
  answer({ name, args }) {
    const key = () => `${args[0].from}${args[0].to}`;
    switch (name) {
      case "start":
        return true;
      case "load":
        this.models.add(key());
        return true;
      case "loaded":
        return this.models.has(key());
      case "unload":
        return this.models.delete(key());
      case "translate":
        return args[1].map((/** @type {string} */ text) => `<${text}>`);
      default:
        throw new Error(`unknown call: ${name}`);
    }
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

/**
 * As much of IndexedDB as `models/store.js` reads through: open, one
 * transaction over a store, `get` by key, `close`. Requests and the
 * transaction settle on their own turn, after the code has had its chance to
 * attach the handlers - the order the real database keeps.
 *
 * @param {Record<string, Record<string, unknown>>} tables store name -> key -> record
 */
function fakeIndexedDB(tables) {
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore() {},
    close() {},
    transaction() {
      let pending = 0;
      let done = false;
      /** @type {(() => void) | null} */
      let onComplete = null;
      const finish = () => {
        done = true;
        onComplete?.();
      };
      return {
        error: null,
        /** @param {string} name */
        objectStore: (name) => ({
          /** @param {string} key */
          get: (key) => {
            pending += 1;
            /** @type {{ result: unknown, error: null, onsuccess: (() => void) | null, onerror: (() => void) | null }} */
            const request = { result: undefined, error: null, onsuccess: null, onerror: null };
            queueMicrotask(() => {
              request.result = tables[name]?.[key];
              request.onsuccess?.();
              pending -= 1;
              if (pending === 0) queueMicrotask(finish);
            });
            return request;
          },
        }),
        /** @param {() => void} fn */
        set oncomplete(fn) {
          onComplete = fn;
          if (done) queueMicrotask(fn);
        },
        /** @param {() => void} _fn */
        set onerror(_fn) {},
        /** @param {() => void} _fn */
        set onabort(_fn) {},
      };
    },
  };
  return {
    open() {
      /** @type {{ result: unknown, onupgradeneeded: null, onsuccess: (() => void) | null, onerror: null, onblocked: null }} */
      const request = { result: db, onupgradeneeded: null, onsuccess: null, onerror: null, onblocked: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  };
}

/** @returns {{ promise: Promise<void>, resolve: () => void }} */
function deferred() {
  /** @type {() => void} */
  let resolve = () => {};
  /** @type {Promise<void>} */
  const promise = new Promise((done) => {
    resolve = () => done(undefined);
  });
  return { promise, resolve };
}

/**
 * The page's `fetch`, answering the engine's binary - or holding it back
 * until told, or failing it. A fresh buffer per call, so a test can tell
 * which read a worker was handed.
 *
 * @param {{ fail?: boolean, hold?: boolean }} [options]
 */
function installFetch(options = {}) {
  /** @type {string[]} */
  const asked = [];
  /** @type {ArrayBuffer[]} */
  const handed = [];
  const held = deferred();
  const askedOnce = deferred();
  globalThis.fetch = /** @type {any} */ (
    async (/** @type {unknown} */ url) => {
      asked.push(String(url));
      askedOnce.resolve();
      if (options.hold) await held.promise;
      if (options.fail) throw new TypeError("NetworkError when attempting to fetch resource.");
      const bytes = new ArrayBuffer(8 + asked.length);
      handed.push(bytes);
      return { ok: true, status: 200, arrayBuffer: async () => bytes };
    }
  );
  return { asked, handed, release: held.resolve, askedOnce: askedOnce.promise };
}

/** @param {boolean} [withModel] */
function installModels(withModel = true) {
  const vocab = new ArrayBuffer(2);
  const tables = withModel
    ? {
        meta: { enpl: { pair: "enpl", from: "en", to: "pl", bytes: 9, addedAt: 1 } },
        files: { enpl: { pair: "enpl", model: new ArrayBuffer(4), shortlist: new ArrayBuffer(3), vocabs: [vocab, vocab] } },
      }
    : { meta: {}, files: {} };
  globalThis.indexedDB = /** @type {any} */ (fakeIndexedDB(tables));
}

const ORIGINAL = {
  fetch: globalThis.fetch,
  Worker: globalThis.Worker,
  indexedDB: globalThis.indexedDB,
  browser: globalThis.browser,
};

/** One macrotask, by which every microtask in flight - the fake database's included - has run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  spawned = [];
  failures.clear();
  globalThis.browser = /** @type {any} */ ({
    runtime: { id: "reread@test", getURL: (/** @type {string} */ path) => `moz-extension://test/${path}` },
  });
  globalThis.Worker = /** @type {any} */ (FakeWorker);
  installModels();
});

afterEach(() => {
  // The provider keeps its worker between phrases, as it should. A test
  // leaves none behind for the next one by crashing it - the one door the
  // provider offers, and the one it takes on a real crash.
  spawned.find((worker) => !worker.terminated)?.fire("error", { message: "end of test" });
  Object.assign(globalThis, ORIGINAL);
});

describe("the Bergamot provider and its worker", () => {
  it("hands a fresh worker the engine's binary first, transferred, then the model, then the phrase (D196)", async () => {
    const { asked, handed } = installFetch();

    const result = await bergamot.translate({ text: "morbid", context: "He was morbid at times.", from: "en", to: "pl" });
    assert.deepEqual(result, ok({ gloss: "<morbid>", sentence: "<He was morbid at times.>" }));

    assert.equal(spawned.length, 1);
    const worker = spawnedAt(0);
    assert.equal(worker.url, "moz-extension://test/background/engine.worker.js");
    assert.deepEqual(
      worker.posted.map((post) => post.message.name),
      ["start", "load", "translate"],
    );
    const start = postedTo(worker, 0);
    assert.equal(start.message.args[0], handed[0]);
    assert.deepEqual(start.transfer, [handed[0]]);
    // Read on the page, out of the package; the worker asked for nothing.
    assert.deepEqual(asked, [`moz-extension://test/${ENGINE_BINARY}`]);
  });

  it("keeps the worker and its engine between phrases: one read, one start", async () => {
    const { asked } = installFetch();

    await bergamot.translate({ text: "morbid", from: "en", to: "pl" });
    assert.deepEqual(await bergamot.translate({ text: "sister", from: "en", to: "pl" }), ok({ gloss: "<sister>", sentence: null }));

    assert.equal(spawned.length, 1);
    assert.equal(asked.length, 1);
    assert.deepEqual(
      spawnedAt(0).posted.map((post) => post.message.name),
      ["start", "load", "translate", "loaded", "translate"],
    );
  });

  it("answers model_missing without a worker and without a read", async () => {
    installModels(false);
    const { asked } = installFetch();

    assert.deepEqual(await bergamot.translate({ text: "morbid", from: "en", to: "pl" }), fail(ErrorCode.MODEL_MISSING));
    assert.equal(spawned.length, 0);
    assert.equal(asked.length, 0);
  });

  it("drops a worker whose binary could not be read, and starts over on the next phrase", async () => {
    installFetch({ fail: true });

    assert.deepEqual(await bergamot.translate({ text: "morbid", from: "en", to: "pl" }), fail(ErrorCode.INTERNAL));
    assert.equal(spawned.length, 1);
    assert.equal(spawnedAt(0).terminated, true);
    // Nothing was ever posted to it: no binary, so no model either.
    assert.deepEqual(spawnedAt(0).posted, []);

    const { handed } = installFetch();
    assert.deepEqual(await bergamot.translate({ text: "morbid", from: "en", to: "pl" }), ok({ gloss: "<morbid>", sentence: null }));
    assert.equal(spawned.length, 2);
    assert.equal(postedTo(spawnedAt(1), 0).message.args[0], handed[0]);
  });

  it("drops a worker whose engine refused the binary, and starts over on the next phrase", async () => {
    installFetch();
    failures.set("start", "CompileError: wasm validation error");

    assert.deepEqual(await bergamot.translate({ text: "morbid", from: "en", to: "pl" }), fail(ErrorCode.INTERNAL));
    assert.equal(spawnedAt(0).terminated, true);
    // The start failed before any model was sent.
    assert.deepEqual(
      spawnedAt(0).posted.map((post) => post.message.name),
      ["start"],
    );

    failures.clear();
    assert.deepEqual(await bergamot.translate({ text: "morbid", from: "en", to: "pl" }), ok({ gloss: "<morbid>", sentence: null }));
    assert.equal(spawned.length, 2);
  });

  it("never revives a dropped worker with a binary that arrived late", async () => {
    const { askedOnce, release, handed } = installFetch({ hold: true });

    const first = bergamot.translate({ text: "morbid", from: "en", to: "pl" });
    await askedOnce;
    await settled();
    // The worker dies while its binary is still being read...
    spawnedAt(0).fire("error", { message: "crashed on start" });
    // ...and the read completes afterwards.
    release();

    assert.deepEqual(await first, fail(ErrorCode.INTERNAL));
    assert.equal(spawned.length, 1);
    assert.deepEqual(spawnedAt(0).posted, []);

    assert.deepEqual(await bergamot.translate({ text: "morbid", from: "en", to: "pl" }), ok({ gloss: "<morbid>", sentence: null }));
    assert.equal(spawned.length, 2);
    // The second worker was handed its own read, not the first one's.
    assert.equal(postedTo(spawnedAt(1), 0).message.args[0], handed[1]);
  });
});
