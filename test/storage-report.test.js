import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ensurePersistent, isWebKit, persistenceNote, readStorage } from "../src/lib/storage-report.js";

/**
 * The storage manager stood in for: what it answers is scripted, what it was
 * asked is remembered. No browser runs in CI, and what matters here is the
 * order of the asking and the shape of the answer - the engines' own
 * behaviour is documented in the module and verified on devices.
 *
 * @param {{ persisted?: boolean | Error, persist?: boolean | Error, usage?: number | Error }} script
 */
function storageStandIn(script) {
  /** @type {string[]} */
  const asked = [];
  /**
   * @param {string} name
   * @param {boolean | Error | undefined} value
   * @returns {Promise<boolean>}
   */
  const flag = async (name, value) => {
    asked.push(name);
    if (value instanceof Error) throw value;
    return value === true;
  };
  return {
    asked,
    persisted: () => flag("persisted", script.persisted),
    persist: () => flag("persist", script.persist),
    estimate: async () => {
      asked.push("estimate");
      if (script.usage instanceof Error) throw script.usage;
      return { usage: script.usage };
    },
  };
}

describe("keeping the extension's storage", () => {
  it("asks for persistence once, and not at all when the origin already has it", async () => {
    const fresh = storageStandIn({ persisted: false, persist: true });
    assert.equal(await ensurePersistent(fresh), true);
    assert.deepEqual(fresh.asked, ["persisted", "persist"]);

    const kept = storageStandIn({ persisted: true, persist: true });
    assert.equal(await ensurePersistent(kept), true);
    assert.deepEqual(kept.asked, ["persisted"], "an origin already persisted was asked again");
  });

  it("reports a refusal as false and a broken engine as null, never as an exception", async () => {
    assert.equal(await ensurePersistent(storageStandIn({ persisted: false, persist: false })), false);
    assert.equal(await ensurePersistent(storageStandIn({ persisted: new Error("no"), persist: true })), null);
    assert.equal(await ensurePersistent(null), null, "an engine without the API is nothing to report");
    assert.equal(await ensurePersistent({}), null);
  });

  it("reads usage and standing, each on its own, and leaves null what the engine will not say", async () => {
    assert.deepEqual(await readStorage(storageStandIn({ usage: 150_000_000, persisted: true })), {
      usage: 150_000_000,
      persisted: true,
    });
    assert.deepEqual(await readStorage(storageStandIn({ usage: new Error("no"), persisted: false })), {
      usage: null,
      persisted: false,
    });
    assert.deepEqual(await readStorage(storageStandIn({ usage: 1, persisted: new Error("no") })), {
      usage: 1,
      persisted: null,
    });
    assert.deepEqual(await readStorage(null), { usage: null, persisted: null });
    assert.deepEqual(await readStorage({}), { usage: null, persisted: null });
  });

  it("owes the reader a sentence for a kept promise anywhere, and for a refusal only on WebKit", () => {
    assert.equal(persistenceNote({ persisted: true, webkit: false }), "granted");
    assert.equal(persistenceNote({ persisted: true, webkit: true }), "granted");
    assert.equal(persistenceNote({ persisted: false, webkit: true }), "at-risk");
    assert.equal(persistenceNote({ persisted: false, webkit: false }), null, "Chromium's refusal is not a risk");
    assert.equal(persistenceNote({ persisted: null, webkit: true }), null, "no answer is no sentence");
  });

  it("tells WebKit by the vendor string every WebKit browser reports", () => {
    assert.equal(isWebKit({ vendor: "Apple Computer, Inc." }), true);
    assert.equal(isWebKit({ vendor: "Google Inc." }), false);
    assert.equal(isWebKit({ vendor: "" }), false);
    assert.equal(isWebKit({}), false);
  });
});
