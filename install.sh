#!/usr/bin/env bash
# Installs the Hamilton CLI and bootstraps ~/.hamilton/ (assisted mode).
#
# Run it either way:
#
#   # from a clone
#   ./install.sh
#
#   # remotely (clones the repo for you)
#   curl -fsSL https://raw.githubusercontent.com/caiorcferreira/hamilton/main/install.sh | bash
#
# Environment overrides:
#   HAMILTON_REPO  git URL to clone            (default: https://github.com/caiorcferreira/hamilton)
#   HAMILTON_REF   branch/tag/commit to check out (default: main)
#   HAMILTON_DIR   where to keep the checkout   (default: ~/.hamilton-src)

set -euo pipefail

HAMILTON_REPO="${HAMILTON_REPO:-https://github.com/caiorcferreira/hamilton}"
HAMILTON_REF="${HAMILTON_REF:-main}"
HAMILTON_DIR="${HAMILTON_DIR:-$HOME/.hamilton-src}"

require() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "error: $1 is required but was not found on PATH." >&2
    [ -n "${2:-}" ] && echo "       $2" >&2
    exit 1
  }
}

require bun "install it from https://bun.sh and re-run this script."

# Determine the repo root. If this script lives inside a checkout (normal
# `./install.sh`), build from there. If it was piped over stdin (curl | bash),
# BASH_SOURCE[0] is not a real file, so clone the repo first.
script="${BASH_SOURCE[0]:-}"
if [ -n "$script" ] && [ -f "$script" ] && [ -f "$(dirname "$script")/package.json" ]; then
  repo_root="$(cd "$(dirname "$script")" && pwd)"
else
  require git "install it from https://git-scm.com and re-run this script."
  echo "==> Fetching Hamilton ($HAMILTON_REF) into $HAMILTON_DIR"
  if [ -d "$HAMILTON_DIR/.git" ]; then
    git -C "$HAMILTON_DIR" fetch --depth 1 origin "$HAMILTON_REF"
    git -C "$HAMILTON_DIR" reset --hard FETCH_HEAD
  else
    git clone --depth 1 --branch "$HAMILTON_REF" "$HAMILTON_REPO" "$HAMILTON_DIR"
  fi
  repo_root="$HAMILTON_DIR"
fi

cd "$repo_root"

echo "==> Installing dependencies"
bun install

echo "==> Building and linking the hamilton CLI"
bun run install-local

echo "==> Running hamilton setup (assisted mode)"
hamilton setup --mode assisted
