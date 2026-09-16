import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { TOOLBAR_ICONS, toolbarIconFor } from "../src/lib/theme-icon.js";

/**
 * The one lesson this file exists to keep: `action.setIcon` resolves a bare
 * relative path against the calling document, and every caller in this
 * extension lives in a subdirectory - so what reaches the API must be an
 * absolute extension URL, whatever `TOOLBAR_ICONS` says. Found on a Chromium
 * smoke test as "Could not load action icon" for a file that was in the
 * package all along.
 */

const ROOT = "chrome-extension://test-id/";

function stubBrowser() {
  /** @type {Record<string, unknown>} */ (globalThis)["browser"] = {
    runtime: {
      id: "test-id",
      /** @param {string} path */
      getURL: (path) => ROOT + path,
    },
  };
}

afterEach(() => {
  delete (/** @type {Record<string, unknown>} */ (globalThis)["browser"]);
});

describe("toolbarIconFor", () => {
  it("hands setIcon absolute URLs, never document-relative paths", () => {
    stubBrowser();
    for (const dark of [true, false]) {
      for (const url of Object.values(toolbarIconFor(dark))) {
        assert.ok(
          url.startsWith(ROOT),
          `"${url}" is relative - setIcon would resolve it against the calling page`,
        );
      }
    }
  });

  it("picks each scheme's own set, sizes intact", () => {
    stubBrowser();
    for (const [dark, set] of /** @type {Array<[boolean, Record<number, string>]>} */ ([
      [false, TOOLBAR_ICONS.light],
      [true, TOOLBAR_ICONS.dark],
    ])) {
      assert.deepEqual(
        toolbarIconFor(dark),
        Object.fromEntries(Object.entries(set).map(([size, path]) => [size, ROOT + path])),
      );
    }
  });
});
