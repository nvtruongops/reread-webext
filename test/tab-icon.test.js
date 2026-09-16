import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { posix } from "node:path";
import { describe, it } from "node:test";
import { ROOM_PAGES } from "../src/background/single-tab.js";
import { TARGET_STATIC_FILES } from "../tools/manifest-target.mjs";

/**
 * The pages that open in a tab name their own tab icon, and every package
 * carries the file they name.
 *
 * Chrome gives a chrome-extension:// page the manifest's icon as its tab icon
 * on its own (`chrome_favicon_client.cc` counts the scheme as a "native
 * application URL", and the WebUI factory answers with the manifest's icons).
 * Firefox has no such rule: a tab's icon is what the page's `<link rel="icon">`
 * says or, for http(s) pages only, a guessed /favicon.ico
 * (`LinkHandlerChild.sys.mjs`) - so a moz-extension:// page without the link
 * shows the generic globe, which is what Michał's screenshot showed next to
 * Chrome's mark (2026-08-30). The pages are one HTML for every target, so the
 * file the link names has to be in every package: a link to a file a package
 * does not carry is a failed request in the error panel of the one browser
 * that needed no link at all.
 */

/**
 * @param {string} page a path under src/, e.g. "reader/reader.html"
 * @returns {Promise<string[]>} what the page's icon links name, as paths under src/
 */
async function iconsNamedBy(page) {
  const source = await readFile(new URL(`../src/${page}`, import.meta.url), "utf8");
  /** @type {string[]} */
  const named = [];
  for (const tag of source.matchAll(/<link\b[^>]*>/g)) {
    /** @type {Map<string, string>} */
    const attributes = new Map();
    for (const pair of String(tag[0]).matchAll(/([a-z][-a-z0-9]*)="([^"]*)"/g)) {
      attributes.set(String(pair[1]), String(pair[2]));
    }
    if (attributes.get("rel") !== "icon") continue;
    const href = attributes.get("href");
    assert.ok(href, `${page}: an icon link without an href`);
    named.push(posix.normalize(posix.join(posix.dirname(page), href)));
  }
  return named;
}

describe("the tab icon of the pages that open in a tab", () => {
  for (const page of ROOM_PAGES) {
    describe(page, () => {
      it("names the manifest's mark as its icon", async () => {
        const manifest = /** @type {{ icons: Record<string, string> }} */ (
          JSON.parse(await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"))
        );
        // One file behind every size the manifest names - the SVG mark; the
        // tab shows the same drawing as the toolbar and about:addons.
        const mark = new Set(Object.values(manifest.icons));
        assert.equal(mark.size, 1, "the manifest names more than one file as its icon");

        const named = await iconsNamedBy(page);
        assert.ok(named.length > 0, `${page} names no tab icon - Firefox would show the globe`);
        assert.ok(
          named.some((path) => mark.has(path)),
          `${page} names ${named.join(", ")}, not the manifest's mark ${[...mark].join()}`,
        );
      });

      it("names only files that exist and that every package carries", async () => {
        for (const path of await iconsNamedBy(page)) {
          await assert.doesNotReject(
            access(new URL(`../src/${path}`, import.meta.url)),
            `${page} names "${path}", which is not in src/`,
          );
          for (const [target, shipped] of Object.entries(TARGET_STATIC_FILES)) {
            assert.ok(
              shipped.includes(path),
              `${page} names "${path}", which the ${target} package does not carry`,
            );
          }
        }
      });
    });
  }
});
