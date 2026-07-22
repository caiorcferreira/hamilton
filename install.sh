#!/usr/bin/env bash
# Installs the Hamilton CLI from published release binaries and bootstraps ~/.hamilton/ (assisted mode).
#
# Run it remotely:
#   curl -fsSL https://raw.githubusercontent.com/caiorcferreira/hamilton/main/install.sh | bash
#
# Environment variables:
#   HAMILTON_VERSION    specific version tag to install (default: latest)
#   HAMILTON_REPO_SLUG  GitHub repo slug (default: caiorcferreira/hamilton)

set -euo pipefail

HAMILTON_REPO_SLUG="${HAMILTON_REPO_SLUG:-caiorcferreira/hamilton}"

detect_platform() {
  local os_name
  local arch_name
  local os
  local arch

  os_name="$(uname -s)"
  arch_name="$(uname -m)"

  case "$os_name" in
    Darwin)
      os="darwin"
      ;;
    Linux)
      os="linux"
      ;;
    *)
      echo "error: unsupported OS: $os_name" >&2
      echo "       supported: Darwin, Linux" >&2
      exit 1
      ;;
  esac

  case "$arch_name" in
    x86_64)
      arch="x64"
      ;;
    arm64 | aarch64)
      arch="arm64"
      ;;
    *)
      echo "error: unsupported architecture: $arch_name" >&2
      echo "       supported: x86_64, arm64, aarch64" >&2
      exit 1
      ;;
  esac

  echo "$os-$arch"
}

resolve_version() {
  if [ -n "${HAMILTON_VERSION:-}" ]; then
    echo "$HAMILTON_VERSION"
  else
    curl -fsSL "https://api.github.com/repos/$HAMILTON_REPO_SLUG/releases/latest" | \
      grep -o '"tag_name": "[^"]*"' | \
      head -1 | \
      cut -d'"' -f4
  fi
}

verify_checksums() {
  local work_dir="$1"
  local checksums_file="SHA256SUMS"

  cd "$work_dir"

  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$checksums_file" --ignore-missing
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -c "$checksums_file" --ignore-missing
  else
    echo "error: neither sha256sum nor shasum found on PATH" >&2
    exit 1
  fi
}

install_hamilton() {
  local platform="$1"
  local version="$2"
  local work_dir="$3"

  local binary_name="hamilton-$platform"
  local bundle_name="hamilton-bundle.tar.gz"
  local checksums_file="SHA256SUMS"
  local download_url_base="https://github.com/$HAMILTON_REPO_SLUG/releases/download/$version"

  echo "==> Detected platform: $platform"
  echo "==> Installing Hamilton $version"

  mkdir -p "$work_dir"
  cd "$work_dir"

  trap 'rm -rf "$work_dir"' EXIT

  echo "==> Downloading release assets"
  curl -fsSL -o "$binary_name" "$download_url_base/$binary_name"
  curl -fsSL -o "$bundle_name" "$download_url_base/$bundle_name"
  curl -fsSL -o "$checksums_file" "$download_url_base/$checksums_file"

  echo "==> Verifying checksums"
  verify_checksums "$work_dir"

  echo "==> Installing binary"
  mkdir -p ~/.hamilton-dist/bin
  mv "$binary_name" ~/.hamilton-dist/bin/hamilton
  chmod +x ~/.hamilton-dist/bin/hamilton

  echo "==> Creating symlink"
  mkdir -p ~/.local/bin
  ln -sf ~/.hamilton-dist/bin/hamilton ~/.local/bin/hamilton

  echo "==> Extracting bundle"
  mkdir -p ~/.hamilton-dist
  tar xzf "$bundle_name" -C ~/.hamilton-dist

  trap - EXIT
  rm -rf "$work_dir"
}

main() {
  local platform
  local version
  local work_dir

  platform="$(detect_platform)"
  version="$(resolve_version)"
  work_dir="$(mktemp -d)"

  install_hamilton "$platform" "$version" "$work_dir"

  echo "==> Running hamilton setup (assisted mode)"
  ~/.local/bin/hamilton setup --mode assisted

  if [ "$(uname -s)" = "Darwin" ]; then
    cat << 'EOF'

Note: On first run, macOS may show an "unidentified developer" warning.
To bypass Gatekeeper, run:
  xattr -d com.apple.quarantine ~/.hamilton-dist/bin/hamilton

EOF
  fi
}

main "$@"
