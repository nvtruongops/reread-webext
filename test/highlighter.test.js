import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import { clear, refresh, unmark, unregister } from "../src/content/highlighter.js";
import { UNDERLINE_NAMES } from "../src/lib/underline.js";

/**
 * The paint on a page is taken back through one door, and this file holds it
 * shut. WebKit up to Safari 18 drops a registry entry on `delete` without
 * repainting its ranges (`HighlightRegistry::remove`), so a highlight deleted
 * straight from `CSS.highlights` stays on the screen until something else
 * repaints that spot - on the iPad that was the closing bubble's own patch and
 * nothing beside it, the stale wash of the Safari spike's P2. Emptying the set
 * first is repainted on every engine. The same engine anchors every highlight
 * to nothing while a modal dialog stands, and `refresh` is the reader's way
 * of asking for a fresh anchoring once it is down: the ranges out and back in,
 * same objects, same names, same order. No browser runs in CI: the registry
 * below is a stand-in that remembers the order of what was asked of it, and
 * the last test reads the sources for anyone deleting on their own.
 */

/**
 * A registry entry that remembers whether it was emptied while still
 * registered, and - as the set-like it stands in for - which ranges it holds
 * and in what order it was asked things.
 */
class FakeHighlight {
  /**
   * @param {() => boolean} registered whether the entry still stands in the registry
   * @param {string[]} [ranges] what the entry holds to begin with
   */
  constructor(registered, ranges = []) {
    this.registered = registered;
    this.cleared = false;
    this.clearedWhileRegistered = false;
    this.ranges = [...ranges];
    /** @type {string[]} */
    this.asked = [];
  }

  clear() {
    this.cleared = true;
    this.clearedWhileRegistered = this.registered();
    this.ranges = [];
    this.asked.push("clear");
  }

  /** @param {string} range */
  add(range) {
    this.ranges.push(range);
    this.asked.push(`add ${range}`);
  }

  [Symbol.iterator]() {
    return this.ranges[Symbol.iterator]();
  }
}

/**
 * Runs with `CSS.highlights` and `Highlight` standing in - the two things
 * `highlighter.js` asks for before it touches anything - and takes both away
 * afterwards, so no other test meets an engine that is not there.
 *
 * @param {(registry: Map<string, FakeHighlight>) => void} run
 */
function withRegistry(run) {
  /** @type {Map<string, FakeHighlight>} */
  const registry = new Map();
  Reflect.set(globalThis, "CSS", { highlights: registry });
  Reflect.set(globalThis, "Highlight", FakeHighlight);
  try {
    run(registry);
  } finally {
    Reflect.deleteProperty(globalThis, "CSS");
    Reflect.deleteProperty(globalThis, "Highlight");
  }
}

/**
 * @param {Map<string, FakeHighlight>} registry
 * @param {string} name
 * @param {string[]} [ranges]
 * @returns {FakeHighlight}
 */
function registered(registry, name, ranges = []) {
  const entry = new FakeHighlight(() => registry.has(name), ranges);
  registry.set(name, entry);
  return entry;
}

describe("taking a highlight back", () => {
  it("empties the registration before dropping it, so every engine repaints", () => {
    withRegistry((registry) => {
      const entry = registered(registry, "reread-something");
      unregister("reread-something");
      assert.equal(entry.cleared, true, "the set was not emptied");
      assert.equal(entry.clearedWhileRegistered, true, "emptied only after the delete - too late for WebKit");
      assert.equal(registry.has("reread-something"), false, "the entry is still registered");
    });
  });

  it("is quiet about a name nobody registered, and about an engine without the API", () => {
    withRegistry(() => {
      assert.doesNotThrow(() => unregister("reread-nobody"));
    });
    assert.equal(typeof globalThis.CSS, "undefined");
    assert.doesNotThrow(() => unregister("reread-something"));
  });

  it("is the door the module's own take-backs use", () => {
    withRegistry((registry) => {
      const active = registered(registry, "reread-active");
      const underlines = new Map(UNDERLINE_NAMES.map((name) => [name, registered(registry, name)]));

      unmark();
      assert.equal(active.clearedWhileRegistered, true, "the recall mark was dropped without being emptied");
      assert.equal(registry.has("reread-active"), false);

      clear();
      for (const [name, entry] of underlines) {
        assert.equal(entry.clearedWhileRegistered, true, `${name} was dropped without being emptied`);
        assert.equal(registry.has(name), false);
      }
    });
  });

  it("re-anchors every registration in place: ranges out and back, same objects, same order", () => {
    withRegistry((registry) => {
      const marks = registered(registry, "reread-marker-yellow", ["a", "b"]);
      const underline = registered(registry, "reread-underline", ["c"]);
      const empty = registered(registry, "reread-selection");

      refresh();

      assert.equal(registry.get("reread-marker-yellow"), marks, "the marks were re-registered as a new object");
      assert.deepEqual(marks.ranges, ["a", "b"], "the marks lost a range or their order");
      assert.deepEqual(marks.asked, ["clear", "add a", "add b"], "the ranges did not go out before coming back");
      assert.deepEqual(underline.asked, ["clear", "add c"]);
      assert.deepEqual(empty.asked, ["clear"], "an empty registration is emptied like any other, and nothing is invented");
      assert.equal(registry.size, 3);
    });
    assert.doesNotThrow(() => refresh(), "an engine without the API has nothing to settle");
  });

  it("is the only door: no module deletes from the registry on its own", async () => {
    const root = new URL("../src/", import.meta.url);
    const files = (await readdir(root, { recursive: true })).filter((path) => path.endsWith(".js"));
    assert.ok(files.length > 10, "the source tree was not walked");

    const highlighter = await readFile(new URL("content/highlighter.js", root), "utf8");
    // The one registry delete there is, inside `unregister` and nowhere else.
    const deletes = [...highlighter.matchAll(/\bapi\??\.delete\(|registry\(\)\??\.delete\(/g)];
    assert.equal(deletes.length, 1, "highlighter.js deletes from the registry in more than one place");
    const door = highlighter.indexOf("export function unregister(");
    const nextExport = highlighter.indexOf("\nexport function", door + 1);
    assert.ok(door !== -1 && deletes[0]?.index !== undefined);
    assert.ok(deletes[0].index > door && deletes[0].index < nextExport, "the registry delete has left `unregister`");

    for (const path of files) {
      const text = await readFile(new URL(path, root), "utf8");
      assert.equal(text.includes("highlights.delete("), false, `${path} deletes from CSS.highlights directly`);
    }
  });
});
