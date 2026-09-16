// Runs addons-linter (the one AMO runs) and holds it to the rule the project
// actually has: nothing red, nothing yellow, nothing grey.
//
// `web-ext lint` on its own exits 0 for warnings and notices, so "green" used to
// mean "no errors" while the documented standard said 0/0/0. This script is that
// standard, enforced.
//
// One exception exists, and it is written down rather than tolerated: the
// vendored Readability assigns to `innerHTML` in two places. Vendored code is
// copied byte for byte or it is not vendored at all, so those two lines cannot
// be edited away - they are pinned below with the reason each one is harmless,
// and any warning that is not on that list fails the build.
//
// The pins name a line number on purpose. A vendored file cannot change without
// its CHECKSUMS changing, so a pin that stops matching means somebody bumped the
// library - exactly the moment these two lines deserve to be read again.
//
// Usage: node tools/lint.mjs [--source-dir dist/firefox]

import { spawnSync } from "node:child_process";

/**
 * @typedef {object} AllowedWarning
 * @property {string} file
 * @property {number} line
 * @property {string} code
 * @property {string} why
 */

/** @type {AllowedWarning[]} */
const ALLOWED_WARNINGS = [
  {
    file: "vendor/readability/Readability.js",
    line: 1549,
    code: "UNSAFE_VAR_ASSIGNMENT",
    why:
      "Readability restores the document it already saved: `pageCacheHtml` is " +
      "read out of the same element a few hundred lines earlier and put back " +
      "when an extraction attempt failed. Nothing new enters the tree, and the " +
      "tree is a DOMParser document with no browsing context, so nothing in it " +
      "runs either way.",
  },
  {
    file: "vendor/readability/Readability.js",
    line: 1928,
    code: "UNSAFE_VAR_ASSIGNMENT",
    why:
      "Unwrapping <noscript>, whose content is inert text until somebody moves " +
      "it: Readability copies it into a detached <div> to find lazily loaded " +
      "images. Same document, same DOMParser, and the reader rebuilds whatever " +
      "comes out of all this from an allowed list anyway.",
  },
];

/** @typedef {{ file?: string, line?: number, column?: number, code?: string, message?: string }} LintMessage */

/**
 * @param {LintMessage} message
 * @returns {string}
 */
function describe(message) {
  const where = `${message.file ?? "?"}:${message.line ?? "?"}`;
  return `${where}  ${message.code ?? "?"}  ${message.message ?? ""}`;
}

/**
 * @param {LintMessage} message
 * @param {AllowedWarning} allowed
 * @returns {boolean}
 */
function matches(message, allowed) {
  return (
    message.file === allowed.file && message.line === allowed.line && message.code === allowed.code
  );
}

const sourceDirIndex = process.argv.indexOf("--source-dir");
const sourceDir = sourceDirIndex === -1 ? "dist/firefox" : process.argv[sourceDirIndex + 1];
if (sourceDir === undefined) {
  console.error("lint: --source-dir needs a value");
  process.exit(2);
}

const isWin = process.platform === "win32";
const exe = isWin ? "cmd.exe" : "npx";
const args = isWin
  ? ["/d", "/s", "/c", "npx", "--no-install", "web-ext", "lint", "--source-dir", sourceDir, "--output", "json"]
  : ["--no-install", "web-ext", "lint", "--source-dir", sourceDir, "--output", "json"];

const linter = spawnSync(exe, args, {
  encoding: "utf8",
  env: { ...process.env, NO_UPDATE_NOTIFIER: "1" },
});

if (linter.error !== undefined) {
  console.error(`lint: could not run web-ext: ${linter.error.message}`);
  process.exit(2);
}

// The JSON starts at the first brace: anything before it is web-ext talking
// about itself, and anything after would be too.
const start = linter.stdout.indexOf("{");
if (start === -1) {
  console.error("lint: web-ext produced no report");
  console.error(linter.stdout || linter.stderr);
  process.exit(2);
}

/** @type {{ errors?: LintMessage[], warnings?: LintMessage[], notices?: LintMessage[] }} */
let report;
try {
  report = JSON.parse(linter.stdout.slice(start));
} catch (problem) {
  console.error(`lint: web-ext report is not JSON: ${String(problem)}`);
  process.exit(2);
}

const errors = report.errors ?? [];
const notices = report.notices ?? [];
const warnings = report.warnings ?? [];

const unpinned = warnings.filter((warning) => !ALLOWED_WARNINGS.some((one) => matches(warning, one)));
const stale = ALLOWED_WARNINGS.filter((one) => !warnings.some((warning) => matches(warning, one)));

for (const error of errors) console.error(`lint: error    ${describe(error)}`);
for (const notice of notices) console.error(`lint: notice   ${describe(notice)}`);
for (const warning of unpinned) console.error(`lint: warning  ${describe(warning)}`);

for (const one of stale) {
  console.error(
    `lint: pinned warning no longer reported: ${one.file}:${one.line} ${one.code}\n` +
      "lint: the vendored file changed - read those lines again and update tools/lint.mjs",
  );
}

if (errors.length + notices.length + unpinned.length + stale.length > 0) {
  console.error("lint: addons-linter is not clean - see above");
  process.exit(1);
}

const pinned = ALLOWED_WARNINGS.length;
console.log(
  `lint: 0 errors, 0 notices, 0 unexplained warnings` +
    (pinned === 0 ? "" : ` (${pinned} pinned in tools/lint.mjs, both in vendored code)`),
);
