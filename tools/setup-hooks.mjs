// Installs and configures Git hooks for local CI verification.
import { copyFile, chmod, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hooksDir = path.join(rootDir, ".githooks");
const gitHooksDir = path.join(rootDir, ".git", "hooks");

console.log("Setting up local CI pre-push git hook...");

// 1. Point Git to .githooks directory via core.hooksPath
const configRes = spawnSync("git", ["config", "core.hooksPath", ".githooks"], {
  cwd: rootDir,
  stdio: "inherit",
});

if (configRes.status !== 0) {
  console.warn("⚠️  Failed to set git config core.hooksPath; falling back to direct .git/hooks copy.");
} else {
  console.log("✔ Git config core.hooksPath set to .githooks");
}

// 2. Fallback: Also copy to .git/hooks/pre-push directly if .git/hooks exists
if (existsSync(path.join(rootDir, ".git"))) {
  if (!existsSync(gitHooksDir)) {
    await mkdir(gitHooksDir, { recursive: true });
  }

  const srcHook = path.join(hooksDir, "pre-push");
  const destHook = path.join(gitHooksDir, "pre-push");

  if (existsSync(srcHook)) {
    await copyFile(srcHook, destHook);
    try {
      await chmod(destHook, 0o755);
      await chmod(srcHook, 0o755);
    } catch {
      // chmod may fail on certain Windows setups, which is fine
    }
    console.log("✔ Installed pre-push hook in .git/hooks/pre-push");
  }
}

console.log("✅ Git hooks installed successfully! Local CI will run before every 'git push'.");
