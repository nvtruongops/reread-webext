#!/usr/bin/env node
// Sends the built package to AMO to be signed. A signed .xpi is the only kind
// Firefox installs for good; everything loaded through `about:debugging` or
// `web-ext run` is gone by the next restart, and so is the database behind it.
//
// Unlisted, and that is not the same thing as unpublished-for-now. Signing and
// listing are two separate acts: this one uploads the package, has it validated
// automatically, gets it signed and downloads it back. Nothing appears in the
// add-on directory, no human review starts, nobody else can find or install it.
// What leaves this machine is `dist/firefox` and nothing else - no vocabulary,
// no profile, no page anybody read.
//
// Usage:
//   node tools/sign.mjs [--allow-dirty] [--skip-check]
//
// The API key and secret are read from the environment - `WEB_EXT_API_KEY` and
// `WEB_EXT_API_SECRET`, the names web-ext itself looks for. They are never
// passed as arguments, because argv is readable by every process on the machine
// through `ps`. Keep them in `.env` (gitignored); this script loads it.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const KEY_URL = "https://addons.mozilla.org/developers/addon/api/key/";

/**
 * @param {string} message
 * @param {string} [hint]
 * @returns {never}
 */
function stop(message, hint) {
  console.error(`[sign] ${message}`);
  if (hint) console.error(`       ${hint}`);
  process.exit(1);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ capture?: boolean, env?: NodeJS.ProcessEnv, amoHint?: boolean }} [options]
 * @returns {string}
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
    env: options.env ?? process.env,
  });
  if (result.error) stop(`could not run ${command}: ${result.error.message}`);
  if (result.status !== 0) {
    if (options.amoHint) {
      stop(
        `web-ext sign failed (exit ${result.status})`,
        "If AMO says this version already exists, raise `version` in src/manifest.json and\n" +
          `       package.json. If it says 401, the key or the secret is wrong - ${KEY_URL}`,
      );
    }
    stop(`${command} failed (exit ${result.status}) - nothing was uploaded`);
  }
  return (result.stdout ?? "").trim();
}

/** @param {string} file */
async function versionOf(file) {
  const json = JSON.parse(await readFile(join(ROOT, file), "utf8"));
  return String(json.version);
}

const args = process.argv.slice(2);
const allowDirty = args.includes("--allow-dirty");
const skipCheck = args.includes("--skip-check");
const unknown = args.filter((arg) => !["--allow-dirty", "--skip-check"].includes(arg));
if (unknown.length > 0) {
  stop(`unknown option ${unknown[0]}`, "usage: node tools/sign.mjs [--allow-dirty] [--skip-check]");
}

// The version is the one decision here that cannot be taken back: AMO keeps
// every version number ever uploaded and refuses anything that is not higher
// than the last one. Signing a package whose two version fields disagree would
// burn a number on a build nobody can identify afterwards.
const [manifestVersion, packageVersion] = await Promise.all([
  versionOf("src/manifest.json"),
  versionOf("package.json"),
]);
if (manifestVersion !== packageVersion) {
  stop(
    `version mismatch: src/manifest.json says ${manifestVersion}, package.json says ${packageVersion}`,
    "Both have to say the same thing before anything is uploaded.",
  );
}

const envFile = join(ROOT, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!process.env.WEB_EXT_API_KEY || !process.env.WEB_EXT_API_SECRET) {
  stop(
    "no AMO credentials in the environment",
    `Generate a key at ${KEY_URL} and put it in .env (gitignored):\n` +
      "         WEB_EXT_API_KEY=user:12345678:123\n" +
      "         WEB_EXT_API_SECRET=...",
  );
}

// A signed package that no commit corresponds to is a package nobody can go
// back to when it turns out to misbehave three weeks later.
const dirty = run("git", ["status", "--porcelain"], { capture: true });
if (dirty && !allowDirty) {
  stop(
    "the working tree has uncommitted changes",
    "Commit them, or pass --allow-dirty if you are knowingly signing a build that no commit describes.",
  );
}
const commit = run("git", ["rev-parse", "--short", "HEAD"], { capture: true });

console.log(`[sign] re/read ${manifestVersion} from ${commit}${dirty ? " (dirty)" : ""}`);

// Always build, whether or not the gate runs: signing whatever happened to be
// left in dist/ from an experiment is exactly the mistake worth ruling out.
if (skipCheck) {
  console.log("[sign] skipping the quality gate - building only");
  run("npm", ["run", "--silent", "build"]);
} else {
  run("tools/check.sh", []);
}

// The upload lives in a child process of its own: Node reads
// NODE_USE_ENV_PROXY once, at startup, so it has to be in the environment
// before the uploading process exists. tools/sign-upload.mjs is also where
// the workaround for web-ext's filename handling of "re/read" is explained.
run(process.execPath, ["tools/sign-upload.mjs"], {
  amoHint: true,
  env: {
    ...process.env,
    // Node's fetch ignores HTTPS_PROXY unless told; the upload goes through it.
    NODE_USE_ENV_PROXY: "1",
  },
});

console.log(
  `\n[sign] ${manifestVersion} signed. The .xpi is in web-ext-artifacts/ - open it in Firefox,\n` +
    "       or about:addons -> gear -> Install Add-on From File. It survives restarts, and\n" +
    "       installing a later build over it keeps the vocabulary: same extension id.",
);
