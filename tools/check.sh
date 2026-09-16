#!/usr/bin/env bash
# POSIX wrapper for the cross-platform quality gate.
set -euo pipefail

cd "$(dirname "$0")/.."
exec node tools/check.mjs "$@"
