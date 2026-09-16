import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * The promise `vendor/fflate/README.md` makes about what of the library is
 * ever called: the synchronous single-entry reads and the synchronous
 * streaming writer, never the asynchronous API - the path that spins up
 * Web Workers from Blob URLs, the one kind of dynamic code an auditor
 * should be able to rule out by reading `src/`. Checked here so the
 * promise cannot drift from the code quietly.
 */

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/**
 * @param {string} dir
 * @returns {string[]}
 */
function scripts(dir) {
  /** @type {string[]} */
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...scripts(path));
    else if (entry.name.endsWith(".js")) found.push(path);
  }
  return found;
}

describe("the vendored ZIP library's surface", () => {
  it("is touched only through the synchronous reads and the synchronous streaming writer", () => {
    for (const path of scripts(join(ROOT, "src"))) {
      const source = readFileSync(path, "utf8");
      assert.doesNotMatch(source, /\b(?:zip|unzip|zipSync)\(/, `${path} calls a whole-archive or asynchronous function`);
      assert.doesNotMatch(
        source,
        /\bAsync(?:Zip|Deflate|Inflate|Gzip|Gunzip|Zlib|Unzlib|Compress|Decompress)/,
        `${path} touches the asynchronous API`,
      );
    }
  });

  it("is loaded by the reader page's zip module alone", () => {
    for (const path of scripts(join(ROOT, "src"))) {
      if (path.endsWith(join("reader", "zip.js"))) continue;
      assert.doesNotMatch(readFileSync(path, "utf8"), /vendor\/fflate/, `${path} loads the library itself`);
    }
  });
});
