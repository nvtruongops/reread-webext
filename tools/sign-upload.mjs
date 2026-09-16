#!/usr/bin/env node
// The upload half of `npm run sign`, in a process of its own because Node
// decides at startup, from NODE_USE_ENV_PROXY, whether fetch honours the
// sandbox's HTTPS_PROXY - so the variable has to be set before this file even
// starts running. tools/sign.mjs is the half that decides whether an upload
// may happen at all; nothing here re-checks versions, credentials or the tree.
//
// It talks to web-ext through the JS API rather than the CLI for one reason:
// `web-ext sign` names its upload zip from the template "{name}-{version}.zip",
// and whenever the manifest declares default_locale it substitutes the
// (possibly localized) name into that template while skipping its own
// safeFileName step. Our name is "re/read", the slash makes the filename a
// path, and the CLI refuses to build it - with no --filename on sign to say
// otherwise. The JS API can hand sign a build with the name spelled out. The
// zip is only the envelope the upload travels in: what is inside is
// dist/firefox as built, manifest and name untouched.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import webExt from "web-ext";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const apiKey = process.env.WEB_EXT_API_KEY;
const apiSecret = process.env.WEB_EXT_API_SECRET;
if (!apiKey || !apiSecret) {
  console.error("[sign-upload] no AMO credentials in the environment - run this through tools/sign.mjs");
  process.exit(1);
}

// Only feeds the User-Agent header AMO sees; "web-ext/undefined" would be the
// alternative.
const { version: webextVersion } = JSON.parse(
  await readFile(join(ROOT, "node_modules", "web-ext", "package.json"), "utf8"),
);

try {
  await webExt.cmd.sign(
    {
      sourceDir: join(ROOT, "dist", "firefox"),
      artifactsDir: join(ROOT, "web-ext-artifacts"),
      channel: "unlisted",
      amoBaseUrl: "https://addons.mozilla.org/api/v5/",
      apiKey,
      apiSecret,
      webextVersion,
    },
    {
      build: (params, options) =>
        webExt.cmd.build({ ...params, filename: "re-read-{version}.zip" }, options),
    },
  );
} catch (error) {
  console.error(`[sign-upload] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
