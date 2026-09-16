// Cross-platform vendor integrity check (Node.js native).
// Verifies SHA-256 checksums and validates WebAssembly modules.
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Computes the SHA-256 hash of a file.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
async function sha256(filePath) {
  const content = await readFile(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Checks all files in a vendor directory against its CHECKSUMS file.
 * @param {string} relDir
 * @returns {Promise<void>}
 */
async function checkVendored(relDir) {
  const dir = path.join(rootDir, relDir);
  const checksumFile = path.join(dir, "CHECKSUMS");
  const checksumContent = await readFile(checksumFile, "utf-8");

  /** @type {Map<string, string>} */
  const expected = new Map();
  for (const line of checksumContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split(/\s+/);
    const hash = parts[0];
    const file = parts[1];
    if (hash && file) {
      expected.set(file, hash);
    }
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const actualFiles = entries
    .filter((e) => e.isFile() && !e.name.startsWith(".") && e.name !== "CHECKSUMS" && e.name !== "README.md")
    .map((e) => e.name);

  // 1. Check for unpinned files
  const unpinned = actualFiles.filter((f) => !expected.has(f));
  if (unpinned.length > 0) {
    console.error(`check-vendor: ${relDir} has files that CHECKSUMS does not name:`);
    for (const f of unpinned) console.error(`  ${f}`);
    console.error(`check-vendor: see ${relDir}/README.md - vendoring is a deliberate act`);
    process.exit(1);
  }

  // 2. Check checksums
  for (const [file, expectedHash] of expected.entries()) {
    const filePath = path.join(dir, file);
    try {
      const actualHash = await sha256(filePath);
      if (actualHash !== expectedHash) {
        console.error(`check-vendor: ${relDir}/${file} does not match its CHECKSUMS`);
        console.error(`  expected: ${expectedHash}`);
        console.error(`  actual:   ${actualHash}`);
        process.exit(1);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`check-vendor: missing file ${relDir}/${file} listed in CHECKSUMS: ${msg}`);
      process.exit(1);
    }
  }
}

await checkVendored("vendor/bergamot");
await checkVendored("vendor/readability");
await checkVendored("vendor/fflate");

// Validate WASM
const wasmPath = path.join(rootDir, "vendor/bergamot/bergamot-translator-worker.wasm");
const wasm = await readFile(wasmPath);
if (!WebAssembly.validate(wasm)) {
  console.error("check-vendor: bergamot-translator-worker.wasm is not a valid WebAssembly module");
  process.exit(1);
}

console.log("check-vendor: vendored files match their CHECKSUMS; the engine is a valid WebAssembly module");
