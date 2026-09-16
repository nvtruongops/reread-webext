// Writes `src/lib/models/registry.json` - the list of models this extension is
// willing to download, and the checksums it will hold them to.
//
// This is a development tool, not part of the build and not part of the gate:
// it needs the network and it downloads tens of megabytes. It is run by hand
// when a pair is added or when Mozilla retrains a model, and its output is
// committed.
//
// Why it exists at all: Mozilla's own registry publishes a checksum for exactly
// one of the three files of a model, and that one is the checksum of the file
// *after* unpacking, so the transferred bytes cannot be checked with Subresource
// Integrity. So we compute our own sums for all three, here, once, from files
// somebody downloaded and can inspect - and the extension then refuses anything
// that does not match. Where a sum does exist upstream, this tool compares its
// own against it and stops if they disagree.
//
// Usage:
//   node tools/models-registry.mjs                     # refresh the pairs already listed
//   node tools/models-registry.mjs --pairs=en-pl,pl-en
//   node tools/models-registry.mjs --all               # every pair released upstream
//   node tools/models-registry.mjs --refresh           # ignore the download cache
//
// Behind a proxy (the sandbox this repository is developed in is one), Node
// needs to be told: `NODE_USE_ENV_PROXY=1 node tools/models-registry.mjs`.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { UPSTREAM_ROLES, pickEntry } from "../src/lib/models/upstream.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(ROOT, "src", "lib", "models", "registry.json");
const CACHE = join(ROOT, "tmp", "models");

/**
 * Mozilla's index of every published model. The address is not from a README:
 * it is built in `db/updater.py` of `mozilla/translations` from `BUCKET_NAME`
 * and `GCS_OUTPUT_PATH`, and it is the only source of models left since the
 * GitHub repository was archived and its LFS objects removed.
 */
const UPSTREAM = "https://storage.googleapis.com/moz-fx-translations-data--303e-prod-translations-data/db/models.json";

/** The order the engine wants them in, and the order they are written out in. */
const ROLE_ORDER = ["model", "shortlist", "vocab"];

/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Downloads once and keeps the file in `tmp/`, because getting these sums right
 * usually takes more than one run of this tool and each run is 25 MB per pair.
 *
 * @param {string} url
 * @param {boolean} refresh
 * @returns {Promise<Buffer>}
 */
async function fetchCached(url, refresh) {
  const name = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const path = join(CACHE, `${name}-${url.split("/").pop() ?? "file"}`);

  if (!refresh) {
    try {
      const cached = await readFile(path);
      console.log(`  cached  ${mb(cached.length)}  ${url.split("/").pop()}`);
      return cached;
    } catch {
      // Not cached yet - the normal path on a first run.
    }
  }

  const bytes = await get(url);
  await mkdir(CACHE, { recursive: true });
  await writeFile(path, bytes);
  console.log(`  fetched ${mb(bytes.length)}  ${url.split("/").pop()}`);
  return bytes;
}

/**
 * @param {number} bytes
 * @returns {string}
 */
function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1).padStart(6)} MB`;
}

/**
 * @param {Buffer} bytes
 * @returns {string}
 */
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * @param {Buffer} bytes
 * @returns {Buffer} the content, unpacked if it arrived gzipped
 */
function unpack(bytes) {
  const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return gzipped ? gunzipSync(bytes) : bytes;
}

// Which entry a pair with several builds resolves to is `pickEntry` in
// `src/lib/models/upstream.js` - the settings page reads the live index by
// the same rule, and two copies of a preference are two preferences.

/**
 * @param {any} entry
 * @param {string} baseUrl
 * @param {string} pair
 * @param {boolean} refresh
 */
async function describeFiles(entry, baseUrl, pair, refresh) {
  /** @type {{ role: string, url: string, downloadBytes: number, bytes: number, sha256: string }[]} */
  const files = [];

  for (const [key, published] of Object.entries(entry.files ?? {})) {
    const role = /** @type {Record<string, string>} */ (UPSTREAM_ROLES)[key];
    if (role === undefined) throw new Error(`${pair}: unknown file "${key}" upstream`);

    const path = /** @type {any} */ (published).path;
    if (typeof path !== "string") throw new Error(`${pair}: "${key}" has no path`);

    const url = `${baseUrl}/${path}`;
    const downloaded = await fetchCached(url, refresh);
    const content = unpack(downloaded);
    const digest = sha256(content);

    // Where upstream states what the unpacked file should be, our own sum has
    // to agree with it. This is the one moment the two independent sources can
    // be compared at all, and a mismatch means one of them is not the model it
    // claims to be.
    const claimedHash = /** @type {any} */ (published).uncompressedHash;
    const claimedSize = /** @type {any} */ (published).uncompressedSize;
    if (typeof claimedHash === "string" && claimedHash !== digest) {
      throw new Error(`${pair}: ${key} unpacked to ${digest}, upstream says ${claimedHash}`);
    }
    if (typeof claimedSize === "number" && claimedSize !== content.length) {
      throw new Error(`${pair}: ${key} unpacked to ${content.length} bytes, upstream says ${claimedSize}`);
    }
    if (typeof claimedHash === "string") console.log(`  verified against upstream: ${key}`);

    files.push({
      role,
      url,
      downloadBytes: downloaded.length,
      bytes: content.length,
      sha256: digest,
    });
  }

  files.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || a.url.localeCompare(b.url));
  return files;
}

/**
 * @param {string[] | "all"} pairs `"all"` means every pair released upstream
 * @param {boolean} refresh
 */
async function generate(pairs, refresh) {
  console.log(`reading ${UPSTREAM}`);
  const upstream = JSON.parse((await get(UPSTREAM)).toString("utf8"));
  const baseUrl = String(upstream.baseUrl).replace(/\/$/, "");

  if (pairs === "all") {
    pairs = Object.entries(upstream.models ?? {})
      .filter(([, entries]) =>
        /** @type {any[]} */ (entries).some((entry) => String(entry.releaseStatus ?? "").startsWith("Release")),
      )
      .map(([pair]) => pair)
      .sort();
    console.log(`--all: ${pairs.length} released pairs upstream`);
  }

  const models = [];
  for (const pair of pairs) {
    const entries = upstream.models?.[pair];
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error(`${pair}: no such pair upstream`);
    }

    const picked = pickEntry(entries);
    if (!picked.ok) throw new Error(`${pair}: ${picked.problem}`);
    const entry = picked.value;
    const [from, to] = pair.split("-");
    console.log(`${pair}: ${entry.architecture}, trained as ${entry.files?.model?.path?.split("/")[2] ?? "?"}`);

    const files = await describeFiles(entry, baseUrl, pair, refresh);
    models.push({
      pair: `${from}${to}`,
      from,
      to,
      architecture: entry.architecture ?? null,
      downloadBytes: files.reduce((total, file) => total + file.downloadBytes, 0),
      bytes: files.reduce((total, file) => total + file.bytes, 0),
      files,
    });
  }

  models.sort((a, b) => a.pair.localeCompare(b.pair));

  const registry = {
    comment:
      "Generated by tools/models-registry.mjs - see that file for why the sums are ours. " +
      "sha256 is of the file after unpacking, which is what gets stored and handed to the engine; " +
      "downloadBytes is what comes over the wire, and is only used to say what a download costs.",
    source: UPSTREAM,
    checkedAt: new Date().toISOString().slice(0, 10),
    generated: upstream.generated ?? null,
    models,
  };

  await writeFile(OUT, JSON.stringify(registry, null, 2) + "\n");
  console.log(`\nwrote ${OUT}`);
  for (const model of models) {
    console.log(`  ${model.from} -> ${model.to}: ${mb(model.downloadBytes)} to download, ${mb(model.bytes)} stored`);
  }
}

/**
 * With no pairs given, the file rewrites itself: refreshing what is already
 * listed is the common case, adding a pair the rare one.
 *
 * @returns {Promise<string[]>}
 */
async function pairsFromExistingRegistry() {
  try {
    const current = JSON.parse(await readFile(OUT, "utf8"));
    const pairs = (current.models ?? []).map((/** @type {any} */ model) => `${model.from}-${model.to}`);
    if (pairs.length > 0) return pairs;
  } catch {
    // No registry yet: the first run has to say which pairs it is for.
  }
  throw new Error("no registry to refresh - say which pairs, e.g. --pairs=en-pl,pl-en");
}

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const asked = args.find((arg) => arg.startsWith("--pairs="))?.slice("--pairs=".length);
const pairs = args.includes("--all")
  ? "all"
  : asked
    ? asked.split(",").filter(Boolean)
    : await pairsFromExistingRegistry();

await generate(pairs, refresh);
