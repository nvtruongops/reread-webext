#!/usr/bin/env node
// Builds the archives the two add-on stores ask for, from the current commit.
//
// Usage:
//   node tools/package.mjs [all|firefox|chromium|source] [--allow-dirty]
//
// Three artefacts, written next to the signed .xpi in web-ext-artifacts/:
//
//   re-read-<version>-firefox.zip    dist/firefox  -> AMO ("Submit a New Version")
//   re-read-<version>-chromium.zip   dist/chromium -> Chrome Web Store
//   re-read-<version>-source.zip     the commit    -> AMO's "Source code" step
//
// AMO asks for sources whenever the submitted files are not the files in the
// repository, and bundling counts even though nothing here is minified. The
// source archive is `git archive HEAD`: tracked files only, so nothing
// untracked, ignored or private can end up in it, and it describes a commit
// rather than a working tree - which is why a dirty tree stops the run. A
// reviewer who runs the two commands in the build note it carries gets
// dist/firefox back.
//
// The store packages are always rebuilt first. Zipping whatever an experiment
// left in dist/ is the one mistake that would be discovered by a stranger.

import { spawnSync } from "node:child_process";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT_DIR = join(ROOT, "web-ext-artifacts");

/** The slash in "re/read" is a path separator; every artefact spells it out. */
const BASENAME = "re-read";

const KINDS = /** @type {const} */ (["firefox", "chromium", "source"]);

/**
 * @param {string} message
 * @param {string} [hint]
 * @returns {never}
 */
function stop(message, hint) {
  console.error(`[package] ${message}`);
  if (hint) console.error(`          ${hint}`);
  process.exit(1);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ capture?: boolean, cwd?: string }} [options]
 * @returns {string}
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
  if (result.error) stop(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) stop(`${command} failed (exit ${result.status})`);
  return (result.stdout ?? "").trim();
}

/**
 * @param {string} file
 * @returns {Promise<string>}
 */
async function versionOf(file) {
  const json = JSON.parse(await readFile(join(ROOT, file), "utf8"));
  return String(json.version);
}

/**
 * What a reviewer opening the source archive should read first. Generated
 * rather than committed because it names the commit it was cut from.
 *
 * @param {string} version
 * @param {string} commit
 */
function buildNote(version, commit) {
  const title = `Building re/read ${version} from these sources`;
  return `${title}
${"=".repeat(title.length)}

This archive is commit ${commit} of
https://github.com/fundacja-reborn/reread-webext - the whole repository, not an
extract. The submitted package was built from it with the two commands below.

Requirements
------------
Node 24 (the exact version is in .nvmrc) and the npm that comes with it. Nothing
else: no global tools, no compiler, no network beyond the npm registry.

Build
-----
  npm ci
  npm run build            # -> dist/firefox   (the package submitted to AMO)
  npm run build:chromium   # -> dist/chromium  (the Chrome Web Store package)

dist/firefox is the directory the submitted zip was made from, manifest.json at
its root. \`tools/check.sh\` runs the full quality gate (vendored checksums,
typecheck, tests, both builds, addons-linter); it is also exactly what CI runs.

What the build does
-------------------
esbuild bundles the entry points listed in tools/build.mjs, for one reason: a
content script cannot be an ES module in either browser, so its imports have to
be resolved before the browser sees the file. Nothing is minified, nothing is
transpiled down, and every bundle ships with a source map carrying its own
sources - the package therefore contains the code as it was written. HTML, CSS,
_locales and icons are copied unchanged; tools/manifest-target.mjs patches
src/manifest.json for the target browser (the differences are listed in one
function there).

Third-party code
----------------
vendor/ holds three components, copied in rather than bundled, each with its
licence, its upstream provenance and a SHA-256 checksum that
tools/check-vendor.sh verifies on every run of the quality gate:

  bergamot     MPL-2.0      the translation engine (WebAssembly)
  readability  Apache-2.0   the article extractor behind reader mode
  fflate       MIT          the ZIP reader behind EPUB import

Each has a README.md next to it with the release it came from and how to verify
it. Translation models are data, not code: they are downloaded from Mozilla's
published bucket when the user asks for one, and are part of neither this
archive nor the package.
`;
}

/**
 * @param {string} kind
 * @param {string} version
 */
function artifactPath(kind, version) {
  return join(OUT_DIR, `${BASENAME}-${version}-${kind}.zip`);
}

/** @param {string} path */
async function sizeOf(path) {
  const { size } = await stat(path);
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * `zip` appends to an existing archive, so yesterday's files would ride along
 * in today's package unnoticed. Every artefact is removed before it is written.
 *
 * @param {string} kind
 * @param {string} version
 */
async function packageBuild(kind, version) {
  const target = kind === "chromium" ? "build:chromium" : "build";
  run("npm", ["run", "--silent", target]);

  const path = artifactPath(kind, version);
  await rm(path, { force: true });
  // -r recurse, -X drop macOS extended attributes, -q quiet. Run from inside
  // the build so the manifest sits at the root of the archive, where both
  // stores insist on finding it.
  run("zip", ["-r", "-X", "-q", path, ".", "-x", "*.DS_Store"], {
    cwd: join(ROOT, "dist", kind),
  });
  return path;
}

/**
 * @param {string} version
 * @param {string} commit
 */
async function packageSource(version, commit) {
  const path = artifactPath("source", version);
  await rm(path, { force: true });
  await mkdir(join(ROOT, "tmp"), { recursive: true });
  const note = join(ROOT, "tmp", "BUILDING.txt");
  await writeFile(note, buildNote(version, commit));
  run("git", [
    "archive",
    "--format=zip",
    `--prefix=${BASENAME}-${version}/`,
    `--add-file=${note}`,
    "-o",
    path,
    "HEAD",
  ]);
  return path;
}

const args = process.argv.slice(2);
const allowDirty = args.includes("--allow-dirty");
const selection = args.filter((arg) => !arg.startsWith("--"));
const unknownFlag = args.filter((arg) => arg.startsWith("--") && arg !== "--allow-dirty");
if (unknownFlag.length > 0) {
  stop(`unknown option ${unknownFlag[0]}`, "usage: node tools/package.mjs [all|firefox|chromium|source] [--allow-dirty]");
}
const unknownKind = selection.filter(
  (kind) => kind !== "all" && !(/** @type {readonly string[]} */ (KINDS).includes(kind)),
);
if (unknownKind.length > 0) {
  stop(`unknown kind "${unknownKind[0]}"`, `expected one of: all, ${KINDS.join(", ")}`);
}
const kinds =
  selection.length === 0 || selection.includes("all")
    ? [...KINDS]
    : KINDS.filter((kind) => selection.includes(kind));

// Same rule as tools/sign.mjs: the two version fields have to agree before
// anything is built that carries a version number in its name. AMO remembers
// every number it has ever seen, on both channels.
const [manifestVersion, packageVersion] = await Promise.all([
  versionOf("src/manifest.json"),
  versionOf("package.json"),
]);
if (manifestVersion !== packageVersion) {
  stop(
    `version mismatch: src/manifest.json says ${manifestVersion}, package.json says ${packageVersion}`,
    "Both have to say the same thing before a package is built.",
  );
}

const dirty = run("git", ["status", "--porcelain"], { capture: true });
if (dirty && !allowDirty && kinds.includes("source")) {
  stop(
    "the working tree has uncommitted changes",
    "The source archive is the commit, so it would not describe the package built beside it.\n" +
      "          Commit first, or pass --allow-dirty if you know what you are doing.",
  );
}
const commit = run("git", ["rev-parse", "HEAD"], { capture: true });

await mkdir(OUT_DIR, { recursive: true });
console.log(`[package] re/read ${manifestVersion} from ${commit.slice(0, 8)}${dirty ? " (dirty)" : ""}`);

/** @type {string[]} */
const written = [];
for (const kind of kinds) {
  const path = kind === "source" ? await packageSource(manifestVersion, commit) : await packageBuild(kind, manifestVersion);
  written.push(`  ${path.slice(ROOT.length + 1)}  ${await sizeOf(path)}`);
}

console.log(`\n[package] written:\n${written.join("\n")}`);
