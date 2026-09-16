// How the one manifest becomes each browser's manifest.
//
// The manifest is written for Firefox, because Firefox is what the MVP targets.
// Chromium and Safari differ in a handful of places each, and all of them are
// worth seeing side by side in one function rather than hidden in second and
// third copies of the file that would drift. Its own module rather than a
// corner of `build.mjs` so the test suite can assert on the patched shape
// without running a build.

export const TARGETS = /** @type {const} */ (["firefox", "chromium", "safari"]);

/** @typedef {(typeof TARGETS)[number]} Target */

/**
 * The raster icons Chromium gets. Firefox reads the SVG mark and follows the
 * toolbar theme with it; Chromium has never accepted SVG for extension icons,
 * so it gets these, generated from the same drawing by
 * `tools/icon/make-icons.mjs`.
 */
export const CHROMIUM_ICONS = Object.freeze({
  16: "assets/icons/icon-16.png",
  32: "assets/icons/icon-32.png",
  48: "assets/icons/icon-48.png",
  128: "assets/icons/icon-128.png",
});

/**
 * The floor is set by `document.caretPositionFromPoint` (Chrome 128) - the one
 * call underline and touch hit-testing stand on. Everything else this
 * extension needs is older: promises from `chrome.*` (121), `offscreen` (109),
 * `runtime.getContexts` (116), nested workers are not used on Chromium at all.
 */
export const MINIMUM_CHROME_VERSION = "128";

/**
 * The floor is set by the same call as on Chromium:
 * `document.caretPositionFromPoint` arrived in Safari 18.2. Everything else
 * this extension needs is older - the CSS Custom Highlight API since 17.2,
 * WASM SIMD since 16.4 - and the code degrades softly where either is
 * missing, so the floor is a promise about full function, not about loading.
 */
export const MINIMUM_SAFARI_VERSION = "18.2";

/**
 * The one loosened directive of the Chromium package (D94). The reader parses
 * other people's pages with `DOMParser`, the parsed document inherits the
 * pages' policy, and Chromium files a violation report for every inline style
 * it meets there - styles that never apply, because the document has no
 * rendering context and the article builder strips `style` before anything
 * reaches a live page. An unpacked extension - the only way this package is
 * installed - collects those reports into a red "Errors" button on the
 * extensions page: an alarm on the card of an extension whose whole pitch is
 * trust. Letting inline styles through ends the reports; scripts stay locked
 * (MV3 would not have it otherwise), the exfiltration channels (`img-src`,
 * `font-src`, `connect-src`, `default-src`) stay shut, and Firefox, which
 * files no such reports, keeps the strict directive.
 */
export const CHROMIUM_STYLE_SRC = "style-src 'self' 'unsafe-inline'";

/** What the source manifest says, and what `forTarget` swaps out for Chromium. */
const FIREFOX_STYLE_SRC = "style-src 'self'";

/**
 * What each package carries beyond the shared files - exactly the icons its
 * manifest, its code or its pages name, because an unreferenced file in a
 * package anyone may audit is a question with no good answer, and a referenced
 * file missing from it is a console full of ERR_FILE_NOT_FOUND. Firefox reads
 * the SVG mark and its theme variants; Chromium gets the rasters, including
 * the dark-toolbar pair that only `action.setIcon` ever names (see
 * `src/lib/theme-icon.js` - the test suite holds the two lists together),
 * and the SVG mark as well, because the pages name it as their tab icon
 * (`test/tab-icon.test.js`).
 *
 * Lives here rather than in `build.mjs` so tests can assert on it: importing
 * the build script would run a build.
 *
 * @type {Record<Target, string[]>}
 */
export const TARGET_STATIC_FILES = {
  firefox: [
    "assets/icons/icon.svg",
    "assets/icons/icon-dark.svg",
    "assets/icons/icon-light.svg",
  ],
  chromium: [
    "assets/icons/icon-16.png",
    "assets/icons/icon-32.png",
    "assets/icons/icon-48.png",
    "assets/icons/icon-128.png",
    "assets/icons/icon-light-16.png",
    "assets/icons/icon-light-32.png",
    // The tab icon the pages name in <link rel="icon">, one HTML for every
    // target. Chrome would give a page of an extension the manifest's icon on
    // its own; the link is there for Firefox, which has no such rule - and a
    // link to a file the package does not carry is ERR_FILE_NOT_FOUND in the
    // extension's error panel.
    "assets/icons/icon.svg",
    "offscreen/engine-host.html",
  ],
  // Safari reads the SVG mark (the S0 spike showed it rendered in the iPadOS
  // toolbar), but `theme_icons` is Gecko-only and gone from its manifest, so
  // the theme variants would be unreferenced files - and those do not ship.
  safari: ["assets/icons/icon.svg"],
};

/**
 * @param {Record<string, unknown>} manifest
 * @param {Target} target
 * @returns {Record<string, unknown>}
 */
export function forTarget(manifest, target) {
  if (target === "firefox") return manifest;

  if (target === "safari") {
    const patched = { ...manifest };
    // Gecko-only settings out; Safari reads its own key of the same shape.
    patched["browser_specific_settings"] = {
      safari: { strict_min_version: MINIMUM_SAFARI_VERSION },
    };
    // Safari runs the same non-persistent background page as Firefox, but
    // wants it said out loud: without an explicit `persistent: false` the
    // Xcode converter warns that iOS supports only non-persistent pages
    // (Firefox's MV3 default is the same value, left implicit). Spelling it
    // out is also what routes Safari down the Firefox path of the engine -
    // a page may spawn the engine's worker, so no offscreen document and no
    // extra permission.
    patched["background"] = {
      .../** @type {Record<string, unknown>} */ (manifest["background"]),
      persistent: false,
    };
    // Gecko-only: theme-aware toolbar icon variants. The converter flags it.
    const action = { .../** @type {Record<string, unknown>} */ (patched["action"]) };
    delete action["theme_icons"];
    patched["action"] = action;
    // Safari does not know `open_in_tab` (the converter flags it) and opens
    // the options page its own way regardless - as a tab, the S0 spike
    // showed. The page itself stays.
    const options = { .../** @type {Record<string, unknown>} */ (patched["options_ui"]) };
    delete options["open_in_tab"];
    patched["options_ui"] = options;
    return patched;
  }

  const patched = { ...manifest };
  // Gecko-only: extension id, minimum version, data collection disclosure.
  delete patched["browser_specific_settings"];
  patched["minimum_chrome_version"] = MINIMUM_CHROME_VERSION;
  // Firefox MV3 runs an event page; Chromium runs a service worker. A service
  // worker cannot spawn the engine's worker (the spec forbids nested workers),
  // so on Chromium the engine lives in an offscreen document - which is what
  // the one extra permission is for.
  patched["background"] = { service_worker: "background/index.js" };
  patched["permissions"] = [
    .../** @type {string[]} */ (manifest["permissions"] ?? []),
    "offscreen",
  ];
  patched["icons"] = { ...CHROMIUM_ICONS };
  // Gecko-only: theme-aware toolbar icon variants. Chromium flags the key.
  const action = { .../** @type {Record<string, unknown>} */ (patched["action"]) };
  delete action["theme_icons"];
  action["default_icon"] = { 16: CHROMIUM_ICONS[16], 32: CHROMIUM_ICONS[32] };
  patched["action"] = action;
  // Inline styles allowed on the extension's own pages, Chromium only - the
  // why lives on CHROMIUM_STYLE_SRC. Loud on a missing marker: a silently
  // unpatched policy would bring the "Errors" button back with no red build.
  const csp = { .../** @type {Record<string, string>} */ (patched["content_security_policy"]) };
  const pages = String(csp["extension_pages"] ?? "");
  if (!pages.includes(FIREFOX_STYLE_SRC)) {
    throw new Error(`manifest CSP lost its "${FIREFOX_STYLE_SRC}" directive - forTarget cannot patch it`);
  }
  csp["extension_pages"] = pages.replace(FIREFOX_STYLE_SRC, CHROMIUM_STYLE_SRC);
  patched["content_security_policy"] = csp;
  return patched;
}
