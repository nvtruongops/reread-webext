// Builds the loadable extension from `src/` into `dist/<target>/`.
//
// There is a bundler here for exactly one reason: content scripts cannot be ES
// modules in either browser, so the imports have to be resolved before the
// browser sees the file. Everything else follows from keeping the output
// auditable - no minification, no transpiling down, one file per entry point,
// and a source map that carries its own sources so devtools can show the code
// as it was written.
//
// Usage:
//   node tools/build.mjs [--target=firefox|chromium|safari] [--watch]

import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { TARGETS, TARGET_STATIC_FILES, forTarget } from "./manifest-target.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

/** @typedef {import("./manifest-target.mjs").Target} Target */

/** Entry points, relative to `src/`. Each becomes one bundled file in `dist/`. */
const ENTRY_POINTS = [
  "background/index.js",
  "background/engine.worker.js",
  "content/index.js",
  "options/options.js",
  "popup/index.js",
  "reader/reader.js",
  "vocab/vocab.js",
];

/**
 * Chromium-only entry points. The offscreen page exists because a service
 * worker cannot spawn the engine's worker; Firefox's event page can, so its
 * package has no reason to carry a file nothing in it ever opens.
 */
const CHROMIUM_ENTRY_POINTS = ["offscreen/engine-host.js"];

/**
 * Copied through untouched, relative to `src/`. The highlight stylesheet is
 * here rather than in a bundle on purpose: it is what the extension does to
 * somebody else's page, and it should be readable as one short file.
 */
const STATIC_FILES = [
  "options/options.html",
  "options/options.css",
  "popup/index.html",
  "popup/popup.css",
  "reader/reader.html",
  "reader/reader.css",
  "vocab/vocab.html",
  "vocab/vocab.css",
  "content/highlight.css",
  "assets/page.css",
  "_locales",
];

/**
 * Third-party code, relative to the repository root, copied in rather than
 * bundled. The licence and the note about where each came from travel with
 * them: MPL-2.0 and Apache-2.0 both ask for the first, and an unexplained
 * five-megabyte blob inside an extension is exactly what the second answers.
 *
 * Copied, not bundled, for a reason that outlives convenience: the file that
 * ships has to have the same SHA-256 as the file the upstream project
 * published, and anything esbuild touches no longer does.
 */
const VENDOR_FILES = [
  "vendor/bergamot/bergamot-translator-worker.js",
  "vendor/bergamot/bergamot-translator-worker.wasm",
  "vendor/bergamot/LICENSE",
  "vendor/bergamot/README.md",
  "vendor/readability/Readability.js",
  "vendor/readability/LICENSE",
  "vendor/readability/README.md",
  "vendor/fflate/browser.js",
  "vendor/fflate/LICENSE",
  "vendor/fflate/README.md",
];

/**
 * @param {Target} target
 * @param {boolean} watch
 */
async function build(target, watch) {
  const out = join(ROOT, "dist", target);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const entryPoints = [
    ...ENTRY_POINTS,
    ...(target === "chromium" ? CHROMIUM_ENTRY_POINTS : []),
  ];

  /** @type {esbuild.BuildOptions} */
  const options = {
    entryPoints: entryPoints.map((entry) => join(SRC, entry)),
    outdir: out,
    outbase: SRC,
    bundle: true,
    format: "iife",
    platform: "browser",
    target:
      target === "firefox" ? ["firefox140"] : target === "safari" ? ["safari18"] : ["chrome128"],
    // The vendored ZIP reader is imported lazily by the reader page and must
    // stay the copied file, never a bundled copy of it (see VENDOR_FILES):
    // external keeps the `import()` in the output verbatim, and the specifier
    // is written for the built layout, where `vendor/` sits beside `reader/`.
    external: ["../vendor/fflate/browser.js"],
    // Readable output is a requirement, not a preference: an extension asking
    // for `<all_urls>` should be one anybody can read before trusting it.
    minify: false,
    sourcemap: true,
    sourcesContent: true,
    logLevel: "info",
    define: { "process.env.NODE_ENV": '"production"' },
  };

  const copyStatic = async () => {
    for (const file of [...STATIC_FILES, ...TARGET_STATIC_FILES[target]]) {
      await cp(join(SRC, file), join(out, file), { recursive: true });
    }
    for (const file of VENDOR_FILES) {
      await mkdir(dirname(join(out, file)), { recursive: true });
      await cp(join(ROOT, file), join(out, file));
    }
    // Pre-bundled models and dictionaries for zero-setup offline usage
    try {
      await mkdir(join(out, "assets", "models"), { recursive: true });
      await cp(join(ROOT, "models"), join(out, "assets", "models"), { recursive: true });
    } catch {
      // Models folder optional
    }
    try {
      await mkdir(join(out, "assets", "dictionaries"), { recursive: true });
      await cp(join(ROOT, "dictionaries"), join(out, "assets", "dictionaries"), { recursive: true });
    } catch {
      // Dictionaries folder optional
    }
    const manifest = JSON.parse(await readFile(join(SRC, "manifest.json"), "utf8"));
    await writeFile(
      join(out, "manifest.json"),
      JSON.stringify(forTarget(manifest, target), null, 2) + "\n",
    );
  };

  if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
    await copyStatic();
    console.log(`[build] watching, output in dist/${target}`);
    return;
  }

  await esbuild.build(options);
  await copyStatic();
  console.log(`[build] ${target} -> dist/${target}`);

  // The Safari package does not load from `dist/` the way the other two do:
  // Xcode bundles whatever sits in the wrapper project's Resources directory
  // into the app. Syncing it here - and nowhere else - keeps one source of
  // truth; the directory is gitignored, so the repository never carries a
  // second copy of the extension.
  if (target === "safari") {
    const resources = join(ROOT, "safari", "reread Extension", "Resources");
    await rm(resources, { recursive: true, force: true });
    await cp(out, resources, { recursive: true });
    console.log(`[build] safari resources -> safari/reread Extension/Resources`);
  }
}

const args = process.argv.slice(2);
const watch = args.includes("--watch");
const targetArg = args.find((arg) => arg.startsWith("--target="))?.split("=")[1] ?? "firefox";
if (!(/** @type {readonly string[]} */ (TARGETS).includes(targetArg))) {
  console.error(`[build] unknown target "${targetArg}" - expected one of: ${TARGETS.join(", ")}`);
  process.exit(2);
}

await build(/** @type {Target} */ (targetArg), watch);
