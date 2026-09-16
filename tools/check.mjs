// Cross-platform quality gate / local CI runner (Node.js native).
// Runs all verification checks in sequence and exits non-zero if any check fails.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const steps = [
  {
    name: "vendored engine",
    command: process.execPath,
    args: ["tools/check-vendor.mjs"],
  },
  {
    name: "typecheck",
    command: process.execPath,
    args: ["node_modules/typescript/bin/tsc", "--noEmit"],
  },
  {
    name: "tests",
    command: process.execPath,
    args: [
      "--test",
      "--import",
      "./test/i18n-en.js",
      "test/**/*.test.js",
    ],
  },
  {
    name: "build (firefox)",
    command: process.execPath,
    args: ["tools/build.mjs"],
  },
  {
    name: "build (chromium)",
    command: process.execPath,
    args: ["tools/build.mjs", "--target=chromium"],
  },
  {
    name: "build (safari)",
    command: process.execPath,
    args: ["tools/build.mjs", "--target=safari"],
  },
  {
    name: "web-ext lint (addons-linter, the one AMO runs)",
    command: process.execPath,
    args: ["tools/lint.mjs", "--source-dir", "dist/firefox"],
  },
  {
    name: "reapps ecosystem sync",
    command: process.execPath,
    args: ["tools/check-reapps.mjs"],
  },
];

console.log("=======================================================");
console.log(" Reread WebExt Local CI Quality Gate");
console.log("=======================================================");

for (const step of steps) {
  console.log(`\n==> ${step.name}`);
  const startTime = Date.now();
  const result = spawnSync(step.command, step.args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: false,
    env: { ...process.env, FORCE_COLOR: "1" },
  });

  if (result.status !== 0) {
    console.error(`\n❌ Step failed: ${step.name} (exit code ${result.status})`);
    process.exit(result.status ?? 1);
  }
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`✔ ${step.name} completed in ${duration}s`);
}

console.log("\n=======================================================");
console.log(" ✅ ALL GREEN: Local CI quality gate passed!");
console.log("=======================================================\n");
