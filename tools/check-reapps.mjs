#!/usr/bin/env node
/**
 * Utility script to check upstream status, latest commits, and releases
 * of https://github.com/fundacja-reborn/reapps to ensure reread-webext
 * stays aligned with Fundacja Reborn's core ecosystem.
 *
 * Usage:
 *   node tools/check-reapps.mjs
 *   node tools/check-reapps.mjs --commits=10
 */

const REPO = "fundacja-reborn/reapps";
const API_BASE = "https://api.github.com/repos/" + REPO;

/**
 * @param {string} url
 * @returns {Promise<any>}
 */
async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "reread-webext-sync-checker",
        "Accept": "application/vnd.github+json",
      },
    });
    if (!res.ok) {
      console.warn(`[reapps] Warning: HTTP ${res.status} ${res.statusText} for ${url}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[reapps] Network error fetching ${url}:`, msg);
    return null;
  }
}

async function main() {
  console.log(`=======================================================`);
  console.log(` Fundacja Reborn Ecosystem Sync: ${REPO}`);
  console.log(`=======================================================\n`);

  // 1. Repo overview
  const repo = await fetchJson(API_BASE);
  if (repo) {
    console.log(`[Repository]`);
    console.log(`  Name:        ${repo.full_name}`);
    console.log(`  Description: ${repo.description}`);
    console.log(`  Default:     ${repo.default_branch}`);
    console.log(`  License:     ${repo.license ? repo.license.spdx_id : "None"}`);
    console.log(`  Updated At:  ${repo.updated_at}`);
    console.log(`  Pushed At:   ${repo.pushed_at}\n`);
  }

  // 2. Latest Release
  const releases = await fetchJson(`${API_BASE}/releases?per_page=3`);
  if (Array.isArray(releases) && releases.length > 0) {
    console.log(`[Latest Releases]`);
    for (const r of releases) {
      console.log(`  * ${r.tag_name} (${r.name || "No title"}) - published ${r.published_at}`);
    }
    console.log("");
  }

  // 3. Recent commits
  const commitCount = process.argv.find(a => a.startsWith("--commits="))?.split("=")[1] || 5;
  const commits = await fetchJson(`${API_BASE}/commits?per_page=${commitCount}`);
  if (Array.isArray(commits) && commits.length > 0) {
    console.log(`[Recent Commits on ${repo?.default_branch || "main"}]`);
    for (const c of commits) {
      const sha = c.sha.slice(0, 7);
      const date = c.commit?.committer?.date?.slice(0, 10) || "Unknown date";
      const author = c.commit?.author?.name || c.author?.login || "Unknown";
      const firstLine = (c.commit?.message || "").split("\n")[0];
      console.log(`  [${sha}] ${date} (${author}): ${firstLine}`);
    }
    console.log("");
  }

  console.log(`Check complete. Use this information to align protocols, storage models, and design tokens.`);
}

main().catch((err) => {
  console.error("Check failed:", err);
  process.exit(1);
});
