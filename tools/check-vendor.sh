#!/usr/bin/env bash
# POSIX wrapper for the cross-platform vendored engine check.
set -euo pipefail

cd "$(dirname "$0")/.."
exec node tools/check-vendor.mjs "$@"
