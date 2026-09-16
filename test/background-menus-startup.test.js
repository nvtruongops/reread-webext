import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MENU } from "../src/background/menus.js";

/**
 * The right-click rows have to exist after the way the GitHub zip is updated:
 * files replaced in the extension's folder, browser restarted. Chromium loads
 * that without an install event, so rows made at install alone were gone after
 * such an update (Gormagon's report of 0.5.47, D189). This imports the real
 * background against a desktop-shaped browser whose events keep their
 * listeners, fires the browser start, and reads what the menu API was told.
 *
 * Only the start is fired here: the install handler also refreshes the
 * vocabulary and the model inventory, which need a database this process
 * does not have.
 */

/** @type {Map<string, Array<(...args: unknown[]) => void>>} */
const listeners = new Map();

/** @param {string} name */
function event(name) {
  return {
    /** @param {(...args: unknown[]) => void} fn */
    addListener(fn) {
      const list = listeners.get(name) ?? [];
      list.push(fn);
      listeners.set(name, list);
    },
  };
}

/** @type {string[]} */
const told = [];

const contextMenus = {
  onClicked: event("contextMenus.onClicked"),
  async removeAll() {
    told.push("removeAll");
  },
  /** @param {{ id: string }} item */
  create(item) {
    told.push(`create:${item.id}`);
    return item.id;
  },
};

globalThis.browser = /** @type {any} */ ({
  runtime: {
    id: "test@reread",
    onMessage: event("runtime.onMessage"),
    onInstalled: event("runtime.onInstalled"),
    onStartup: event("runtime.onStartup"),
    getURL: (/** @type {string} */ path) => `moz-extension://test/${path}`,
  },
  storage: {
    local: {
      async get() {
        return {};
      },
      async set() {},
    },
    session: {
      async get() {
        return {};
      },
      async set() {},
      async remove() {},
    },
    onChanged: event("storage.onChanged"),
  },
  commands: { onCommand: event("commands.onCommand") },
  contextMenus,
});

describe("the right-click rows on browser start", () => {
  it("are wiped and made again when the browser starts, not only at install", async () => {
    await import("../src/background/index.js");

    const starts = listeners.get("runtime.onStartup") ?? [];
    assert.ok(starts.length > 0, "onStartup must register");
    assert.ok((listeners.get("contextMenus.onClicked") ?? []).length > 0, "the click handler must register");

    told.length = 0;
    for (const start of starts) start();
    // The wipe is awaited before the rows are made; give the promise its turn.
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(told, ["removeAll", `create:${MENU.parent}`, `create:${MENU.read}`, `create:${MENU.library}`]);
  });
});
