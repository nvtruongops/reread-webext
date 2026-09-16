import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MENU, installMenus, menuDoor, menuItems } from "../src/background/menus.js";

/**
 * As much of the menus API as `installMenus` talks to, recording the order of
 * what it was told.
 */
function fakeMenus() {
  /** @type {string[]} */
  const calls = [];
  /** @type {import("../src/background/menus.js").MenuItem[]} */
  const created = [];
  return {
    calls,
    created,
    async removeAll() {
      calls.push("removeAll");
    },
    /** @param {import("../src/background/menus.js").MenuItem} item */
    create(item) {
      calls.push(`create:${item.id}`);
      created.push(item);
      return item.id;
    },
  };
}

describe("the right-click rows", () => {
  it("are a parent named after the extension and two doors under it, worded from the catalogue", () => {
    const items = menuItems();
    assert.deepEqual(
      items.map((item) => [item.id, item.parentId ?? null, item.title]),
      [
        [MENU.parent, null, "re/read"],
        [MENU.read, MENU.parent, "Open in reading view"],
        [MENU.library, MENU.parent, "Offline reading list"],
      ],
    );
  });

  it("show over links, pictures and frames too, not only on bare page ground", () => {
    for (const item of menuItems()) {
      for (const context of ["page", "frame", "selection", "link", "image"]) {
        assert.ok(item.contexts.includes(context), `${item.id} should show in the ${context} context`);
      }
    }
  });

  it("offer the page only where there is a page to read; the list everywhere", () => {
    const [parent, read, library] = menuItems();
    assert.deepEqual(read?.documentUrlPatterns, ["http://*/*", "https://*/*", "file://*/*"]);
    assert.equal(library?.documentUrlPatterns, undefined);
    assert.equal(parent?.documentUrlPatterns, undefined);
  });

  it("are made after a wipe, parent first, so an update never trips over its own rows", async () => {
    const menus = fakeMenus();
    await installMenus(menus);
    assert.deepEqual(menus.calls, ["removeAll", `create:${MENU.parent}`, `create:${MENU.read}`, `create:${MENU.library}`]);
  });

  it("answer a click with a door, and a click on anything else with nothing", () => {
    assert.equal(menuDoor(MENU.read), "reader");
    assert.equal(menuDoor(MENU.library), "library");
    assert.equal(menuDoor(MENU.parent), null);
    assert.equal(menuDoor(42), null);
    assert.equal(menuDoor("somebody-elses-row"), null);
  });
});
