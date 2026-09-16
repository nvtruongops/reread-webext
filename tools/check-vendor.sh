#!/usr/bin/env bash
# The vendored code is what this package ships without having written it. That
# makes it the part most worth pinning: these are the bytes we said were here,
# and this is the check that says so on every run of the gate.
set -euo pipefail

cd "$(dirname "$0")/.."

# Every file in a vendored directory has to be named by its CHECKSUMS, and every
# sum has to match. The second half is the obvious one; the first is what stops
# a file from being dropped in next to the pinned ones and never accounted for.
# `README.md` is ours and says where the rest came from.
check_vendored() {
  local dir="$1"

  local unpinned
  unpinned=$(comm -23 \
    <(find "$dir" -maxdepth 1 -type f -not -name '.*' -exec basename {} \; |
      grep -vx -e CHECKSUMS -e README.md | sort) \
    <(awk '{ print $2 }' "$dir/CHECKSUMS" | sort))
  if [[ -n "$unpinned" ]]; then
    echo "check-vendor: $dir has files that CHECKSUMS does not name:" >&2
    echo "$unpinned" >&2
    echo "check-vendor: see $dir/README.md - vendoring is a deliberate act" >&2
    exit 1
  fi

  (cd "$dir" && shasum -a 256 --check --status CHECKSUMS) || {
    echo "check-vendor: $dir does not match its CHECKSUMS" >&2
    echo "check-vendor: see $dir/README.md - updating is a deliberate act" >&2
    (cd "$dir" && shasum -a 256 --check CHECKSUMS >&2) || true
    exit 1
  }
}

check_vendored vendor/bergamot
check_vendored vendor/readability
check_vendored vendor/fflate

# A file of the right length and hash could still be something WebAssembly
# refuses to load - a truncated Git LFS pointer, say, or a checkout that
# mangled line endings. Asking the runtime is cheap and answers that.
node --input-type=module -e '
  import { readFile } from "node:fs/promises";
  const wasm = await readFile("vendor/bergamot/bergamot-translator-worker.wasm");
  if (!WebAssembly.validate(wasm)) {
    console.error("check-vendor: bergamot-translator-worker.wasm is not a valid module");
    process.exit(1);
  }
'

echo "check-vendor: vendored files match their CHECKSUMS; the engine is a valid WebAssembly module"
