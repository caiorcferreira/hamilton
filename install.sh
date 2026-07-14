#!/usr/bin/env bash
# Installs the Hamilton CLI and bootstraps ~/.hamilton/.
#
# Usage: ./install.sh

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is required but was not found on PATH." >&2
  echo "       install it from https://bun.sh and re-run this script." >&2
  exit 1
fi

echo "==> Installing dependencies"
bun install

echo "==> Building and linking the hamilton CLI"
bun run install-local

echo "==> Running hamilton setup (assisted mode)"
hamilton setup --mode assisted
