import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { storageDeps as libraryStorage } from "../src/lib/store/library-backup.js";
import { MARKS_BACKUP_KEY, storageDeps as marksStorage } from "../src/lib/store/marks-backup.js";
import { copiesWritable } from "../src/lib/store/private-copies.js";

const original = /** @type {any} */ (globalThis).browser;

afterEach(() => {
  /** @type {any} */ (globalThis).browser = original;
});

/**
 * The extension API as a page sees it: a `storage.local` that remembers, so
 * a test can read back what a private window was and was not allowed to
 * leave in it.
 *
 * @param {Record<string, unknown>} [initial]
 */
function install(initial = {}) {
  /** @type {Record<string, unknown>} */
  const area = { ...initial };
  /** @type {any} */ (globalThis).browser = {
    runtime: { id: "test" },
    i18n: original?.i18n,
    storage: {
      local: {
        /** @param {string | string[] | null} keys */
        async get(keys) {
          if (keys === null || keys === undefined) return { ...area };
          const wanted = typeof keys === "string" ? [keys] : keys;
          return Object.fromEntries(wanted.filter((key) => key in area).map((key) => [key, area[key]]));
        },
        /** @param {Record<string, unknown>} items */
        async set(items) {
          Object.assign(area, items);
        },
        /** @param {string | string[]} keys */
        async remove(keys) {
          for (const key of typeof keys === "string" ? [keys] : keys) delete area[key];
        },
      },
    },
  };
  return area;
}

/**
 * The copies in `storage.local` under private browsing (D171): the area is
 * one for private and normal windows, so a private session may read the
 * copies and must leave them exactly as they were - no row added, no row
 * taken away - while a normal window goes on writing them as before.
 */
describe("the copies in a private window", () => {
  it("are writable exactly when the context is not private", () => {
    assert.equal(copiesWritable(() => false), true);
    assert.equal(copiesWritable(() => true), false);
  });

  it("keep the reading list's copy as it was: nothing written, nothing removed", async () => {
    const area = install({ "libraryCopy:index": { version: 1, articles: {}, books: {}, pictures: {} } });
    const deps = libraryStorage(() => true);

    await deps.write({ "libraryCopy:article:https://a.example/": { meta: {} } });
    await deps.remove(["libraryCopy:index"]);

    assert.deepEqual(Object.keys(area), ["libraryCopy:index"]);
    // Reading is the private window's whole business with the copy.
    assert.deepEqual(await deps.read("libraryCopy:index"), area["libraryCopy:index"]);
    assert.deepEqual(Object.keys(await deps.readMany(["libraryCopy:index"])), ["libraryCopy:index"]);
    assert.deepEqual(Object.keys(await deps.readAll()), ["libraryCopy:index"]);
  });

  it("let a normal window write and remove as before", async () => {
    const area = install({ stale: 1 });
    const deps = libraryStorage(() => false);

    await deps.write({ "libraryCopy:index": { version: 1 } });
    await deps.remove(["stale"]);

    assert.deepEqual(Object.keys(area), ["libraryCopy:index"]);
  });

  it("keep the highlights' copy as it was", async () => {
    const before = { version: 1, writtenAt: 1, docs: [] };
    const area = install({ [MARKS_BACKUP_KEY]: before });

    await marksStorage(() => true).write({ version: 1, writtenAt: 2, docs: [] });
    assert.deepEqual(area[MARKS_BACKUP_KEY], before);
    assert.deepEqual(await marksStorage(() => true).read(), before);

    await marksStorage(() => false).write({ version: 1, writtenAt: 2, docs: [] });
    assert.deepEqual(area[MARKS_BACKUP_KEY], { version: 1, writtenAt: 2, docs: [] });
  });
});
