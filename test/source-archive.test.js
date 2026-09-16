import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

/**
 * The source archive AMO asks for is `git archive HEAD` (tools/package.mjs), so
 * its contents are the tracked files and nothing else. That makes this test the
 * only guard on what a stranger receives: a reviewer reads the archive, and a
 * secret committed by accident would be read by them first, on a day nobody is
 * looking at the diff any more.
 *
 * The other half is the opposite failure - an archive that cannot be built,
 * which comes back as a rejected submission days later.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** @returns {string[]} */
function trackedFiles() {
  // The index rather than HEAD on purpose: a file staged now is a file in the
  // next commit, and this should fail before it is one.
  const out = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

describe("the sources that go to the reviewer", () => {
  it("carries nothing private, local or built", () => {
    const forbidden = [
      // Credentials for `npm run sign`. `.env.example` is committed on purpose;
      // it holds names, not values.
      /^\.env$/,
      /^\.web-ext-config\.mjs$/,
      // Instructions and settings for the assistant, and its local permissions.
      /^CLAUDE\.md$/,
      /^\.claude\//,
      // Build output, packages and scratch: none of it describes the extension,
      // and dist/ in particular would let an archive disagree with itself.
      /^dist\//,
      /^web-ext-artifacts\//,
      /^tmp\//,
      /^node_modules\//,
      /\.(xpi|zip)$/,
      /(^|\/)\.DS_Store$/,
    ];
    const tracked = trackedFiles();
    for (const pattern of forbidden) {
      const hits = tracked.filter((file) => pattern.test(file));
      assert.deepEqual(hits, [], `tracked files match ${pattern} - they would ship in the source archive`);
    }
  });

  it("carries everything the two build commands need", () => {
    const tracked = new Set(trackedFiles());
    for (const file of [
      "package.json",
      // Without the lockfile `npm ci` refuses to run, and the reviewer cannot
      // reproduce the exact dependency tree the package was built with.
      "package-lock.json",
      ".nvmrc",
      "src/manifest.json",
      "tools/build.mjs",
      "tools/manifest-target.mjs",
      "tools/check.sh",
      // The engine is not downloadable at build time by design: it is in the
      // repository, checksums beside it.
      "vendor/bergamot/bergamot-translator-worker.wasm",
      "vendor/bergamot/CHECKSUMS",
      "vendor/readability/Readability.js",
      "vendor/fflate/browser.js",
      "LICENSE",
    ]) {
      assert.ok(tracked.has(file), `${file} is not tracked - the source archive would not build`);
    }
  });
});
