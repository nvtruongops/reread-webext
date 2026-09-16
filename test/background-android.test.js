import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { commandsApi, contextMenusApi } from "../src/lib/browser.js";

/**
 * The background module registers its listeners at the top level, one after
 * another - so one line throwing does not cost one feature, it costs every
 * registration below it. That is how reader-only mode broke on fresh Android
 * installs: Firefox on Android has no `commands` API, the unguarded access
 * threw, and `onInstalled` below it never registered, so the platform was
 * never published for content scripts and pages fell back to the desktop
 * default. This file imports the real background module against a browser
 * shaped like Android - `commands` and `windows` absent - and asserts that
 * every `runtime` registration still happens.
 *
 * A named counter per event rather than a spy framework: what the test needs
 * to know is exactly which listeners were reached.
 */

/** @type {string[]} */
const registered = [];

/** @param {string} name */
function event(name) {
  return {
    /** @param {unknown} _fn */
    addListener(_fn) {
      registered.push(name);
    },
  };
}

/**
 * The Android shape of the API: everything the background touches at the top
 * level except `commands` and `windows`, which Firefox on Android does not
 * have. Deliberately partial the way `config.test.js`'s fake is - a module
 * reaching further than this should fail here, in Node, not on a phone.
 */
function installAndroidBrowser() {
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
  });
}

afterEach(() => {
  globalThis.browser = undefined;
});

describe("commandsApi", () => {
  it("answers null on a browser without the API, the way Android is", () => {
    installAndroidBrowser();
    assert.equal(commandsApi(), null);
  });

  it("answers the API where there is one", () => {
    installAndroidBrowser();
    const commands = { onCommand: event("commands.onCommand") };
    /** @type {any} */ (globalThis.browser).commands = commands;
    assert.equal(commandsApi(), commands);
  });
});

describe("contextMenusApi", () => {
  it("answers null on a browser without the API, the way Android is", () => {
    installAndroidBrowser();
    assert.equal(contextMenusApi(), null);
  });

  it("answers the API where there is one", () => {
    installAndroidBrowser();
    const contextMenus = { onClicked: event("contextMenus.onClicked"), create() {}, async removeAll() {} };
    /** @type {any} */ (globalThis.browser).contextMenus = contextMenus;
    assert.equal(contextMenusApi(), contextMenus);
  });
});

describe("background on Android", () => {
  it("registers every runtime listener although commands is absent", async () => {
    installAndroidBrowser();
    registered.length = 0;

    // The real module, not an extract: the bug was the order of its top level,
    // and only importing it exercises that order. A second import of an ES
    // module is a cache hit, so this asserts on the first and only run.
    await import("../src/background/index.js");

    assert.ok(
      registered.includes("runtime.onMessage"),
      "the message router must register",
    );
    assert.ok(
      registered.includes("runtime.onInstalled"),
      "onInstalled must register - publishing the platform for content scripts depends on it",
    );
    assert.ok(
      registered.includes("runtime.onStartup"),
      "onStartup must register",
    );
  });
});
