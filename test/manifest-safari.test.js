import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  MINIMUM_SAFARI_VERSION,
  TARGET_STATIC_FILES,
  forTarget,
} from "../tools/manifest-target.mjs";

/**
 * What the build hands Safari, asserted without running a build. The source
 * manifest is written for Firefox and `forTarget` is the whole difference;
 * a mistake here is not a red CI run but an extension the Xcode converter
 * warns about - or one Safari quietly loads with the wrong background
 * lifecycle on iOS.
 *
 * @returns {Promise<{ source: Record<string, any>, patched: Record<string, any> }>}
 */
async function manifests() {
  const source = JSON.parse(
    await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"),
  );
  return { source, patched: forTarget(source, "safari") };
}

describe("the manifest Safari gets", () => {
  it("swaps Gecko settings for Safari's own key", async () => {
    const { patched } = await manifests();
    const settings = patched["browser_specific_settings"];
    assert.equal(settings["gecko"], undefined);
    assert.equal(settings["gecko_android"], undefined);
    // 18.2 is `document.caretPositionFromPoint` - the same call the Chromium
    // floor stands on; everything else the port needs is older.
    assert.deepEqual(settings, { safari: { strict_min_version: MINIMUM_SAFARI_VERSION } });
  });

  it("keeps the event page and says non-persistent out loud", async () => {
    const { source, patched } = await manifests();
    // Same scripts as Firefox - a page may spawn the engine's worker, so the
    // Safari package rides the Firefox path of the engine (no offscreen
    // document). The explicit `persistent: false` is what iOS requires the
    // converter to see; Firefox's MV3 default is the same value, implicit.
    assert.deepEqual(patched["background"], {
      ...source["background"],
      persistent: false,
    });
  });

  it("adds no permission and no extra key", async () => {
    const { source, patched } = await manifests();
    // No offscreen, no minimum_chrome_version - a Safari manifest carrying
    // Chromium keys would be a port nobody proofread.
    assert.deepEqual(patched["permissions"], source["permissions"]);
    assert.deepEqual(patched["host_permissions"], source["host_permissions"]);
    assert.equal(patched["minimum_chrome_version"], undefined);
  });

  it("drops exactly the two keys the converter flags", async () => {
    const { source, patched } = await manifests();
    // `theme_icons` is Gecko-only; `open_in_tab` is unknown to Safari, which
    // opens the options page as a tab regardless (seen in the S0 spike).
    assert.equal(patched["action"]["theme_icons"], undefined);
    assert.equal(patched["options_ui"]["open_in_tab"], undefined);
    assert.equal(patched["options_ui"]["page"], source["options_ui"]["page"]);
    const action = { ...source["action"] };
    delete action["theme_icons"];
    assert.deepEqual(patched["action"], action);
  });

  it("keeps the SVG mark Safari renders", async () => {
    const { source, patched } = await manifests();
    // Unlike Chromium, Safari accepts SVG extension icons - the S0 spike
    // showed the mark in the iPadOS toolbar - so the package ships one
    // drawing, not four rasters.
    assert.deepEqual(patched["icons"], source["icons"]);
  });

  it("keeps the strict CSP", async () => {
    const { source, patched } = await manifests();
    // The Chromium loosening (D94) answers a Chromium-only reporting quirk;
    // nothing of the kind has been seen in Safari, so Safari keeps Firefox's
    // policy to the letter.
    assert.deepEqual(patched["content_security_policy"], source["content_security_policy"]);
  });

  it("keeps what the port does not touch", async () => {
    const { source, patched } = await manifests();
    for (const key of [
      "manifest_version",
      "name",
      "version",
      "description",
      "default_locale",
      "content_scripts",
      "commands",
    ]) {
      assert.deepEqual(patched[key], source[key], `"${key}" drifted between targets`);
    }
  });

  it("ships every icon the manifest names, and nothing unreferenced", async () => {
    const { patched } = await manifests();
    const shipped = TARGET_STATIC_FILES.safari;
    const named = [
      ...Object.values(patched["icons"]),
      String(patched["action"]["default_icon"]),
    ];
    for (const path of new Set(named)) {
      assert.ok(shipped.includes(String(path)), `"${path}" is named but not in the package list`);
    }
    // The other direction is the audit promise: with `theme_icons` gone, the
    // dark/light variants would be files nothing references.
    for (const path of shipped) {
      assert.ok(named.includes(path), `"${path}" ships with Safari but nothing names it`);
    }
  });

  it("names only files that exist in src", async () => {
    for (const path of TARGET_STATIC_FILES.safari) {
      await assert.doesNotReject(
        access(new URL(`../src/${path}`, import.meta.url)),
        `"${path}" is named for Safari but missing from src/`,
      );
    }
  });
});

describe("the Xcode wrapper project", () => {
  it("agrees with the manifest about the version", async () => {
    const { source } = await manifests();
    const pbxproj = await readFile(
      new URL("../safari/reread.xcodeproj/project.pbxproj", import.meta.url),
      "utf8",
    );
    const versions = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map((m) => m[1]);
    // Two targets, two build configurations each. Fewer means the project
    // lost a setting; a mismatch means the App Store would show a version
    // number no signed extension package carries.
    assert.equal(versions.length, 4, "expected MARKETING_VERSION in all four build configurations");
    for (const version of versions) {
      assert.equal(
        version,
        source["version"],
        "the Xcode project claims a different version than the manifest - bump both together",
      );
    }
  });

  it("bundles the extension resources from the synced directory", async () => {
    const pbxproj = await readFile(
      new URL("../safari/reread.xcodeproj/project.pbxproj", import.meta.url),
      "utf8",
    );
    // The Resources directory is gitignored and filled by `npm run
    // build:safari`; the project must keep pointing at it, or Xcode would
    // silently build an app with no extension inside.
    assert.match(pbxproj, /path = Resources\/manifest\.json/);
  });
});
