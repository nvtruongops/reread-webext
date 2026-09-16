import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * Every place the extension's own code may reach the network, and how many
 * times it does so there (D171). The README promises exactly two servers plus
 * the pictures a reader asks for, and the promise used to live in the
 * discipline of whoever wrote the next module. Now it lives here: a new
 * `fetch` anywhere else, or a second one in a file that has one, turns the
 * gate red until the README and this list say why.
 *
 * Counted per file rather than pinned to lines, so an honest edit above a
 * call does not have to touch this test. The vendored code is not walked -
 * `tools/check-vendor.sh` pins those files byte for byte.
 */
const NETWORK_SINKS = new Map([
  // The model files, from the bucket the packaged registry names.
  ["src/lib/models/download.js", 1],
  // Mozilla's index of models, from the same bucket, on the update button.
  ["src/lib/models/live.js", 1],
  // A dictionary archive, on the download button: the catalogue's from
  // WikDict, or one from an address the reader pasted (D187).
  ["src/lib/dict/download.js", 1],
  // WikDict's listing, on the update button.
  ["src/lib/dict/live.js", 1],
  // An article's pictures, from the addresses its text names, on the press.
  ["src/reader/pictures.js", 1],
  // The engine's glue, out of the package by `importScripts` - no network
  // at all. Its binary is read by the page that owns the worker (below).
  ["src/background/engine.worker.js", 1],
  // The engine's binary, out of the package, on the page - never in the
  // worker, whose `fetch` Firefox refuses while the link is down (D196).
  ["src/lib/translator/providers/bergamot/binary.js", 1],
  // Pre-bundled models and dictionary read out of the package - no network at all.
  ["src/lib/preload.js", 1],
]);

/** The reads out of the package: no server is asked, so no host to hold to. */
const PACKAGE_READS = new Set([
  "src/background/engine.worker.js",
  "src/lib/translator/providers/bergamot/binary.js",
  "src/lib/preload.js",
]);

/**
 * What reaching the network looks like in source: the global `fetch` - bare,
 * or off `globalThis`, which is how the download modules take it so a test
 * can hand in a stand-in (`options.fetch`, a property of something else, is
 * not the global and does not count; neither is `fetchImpl`) - and the older
 * doors beside it. `importScripts` is a worker's other way of loading code,
 * which here loads the engine's glue from the package.
 */
const SINK = /(?<![\w$.])fetch\b|\b(?:globalThis|window|self)\.fetch\b|\b(?:XMLHttpRequest|WebSocket|EventSource|importScripts)\b|\bsendBeacon\b/g;

/**
 * @param {string} dir
 * @returns {string[]} every .js file under it, repo-relative with forward slashes
 */
function sourcesUnder(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourcesUnder(path));
    else if (entry.name.endsWith(".js")) found.push(relative(ROOT, path).split("\\").join("/"));
  }
  return found.sort();
}

/**
 * The source with its comments taken out, so a sentence about fetching does
 * not count as a fetch. Strings are left in: a sink hidden in a string would
 * be a sink built at runtime, and that is exactly the kind of thing worth
 * a red gate.
 *
 * @param {string} source
 * @returns {string}
 */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
}

describe("the places the extension reaches the network", () => {
  it("are exactly the ones the README accounts for, and no more", () => {
    /** @type {Map<string, number>} */
    const found = new Map();
    for (const file of sourcesUnder(join(ROOT, "src"))) {
      const source = withoutComments(readFileSync(join(ROOT, file), "utf8"));
      const hits = source.match(SINK)?.length ?? 0;
      if (hits > 0) found.set(file, hits);
    }

    for (const [file, count] of NETWORK_SINKS) {
      assert.equal(found.get(file), count, `${file} should reach the network ${count} time(s)`);
    }
    for (const [file, count] of found) {
      assert.ok(NETWORK_SINKS.has(file), `${file} reaches the network ${count} time(s) and is not on the list`);
    }
  });

  it("all say that nothing of the reader's rides along, and which host may answer", () => {
    // The two-server promise is made of two things per download: no
    // credentials, and an answer from the host that was asked (`same-host.js`).
    // The engine's glue and binary come from the package and need neither.
    for (const file of NETWORK_SINKS.keys()) {
      if (PACKAGE_READS.has(file)) continue;
      const source = readFileSync(join(ROOT, file), "utf8");
      assert.match(source, /credentials:\s*"omit"/, `${file} should fetch with credentials: "omit"`);
      if (file === "src/reader/pictures.js") continue;
      assert.match(source, /answeredByHost\(/, `${file} should hold the answer to the host it asked`);
    }
  });
});
