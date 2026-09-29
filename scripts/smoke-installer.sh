#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/.." && pwd -P)
stage=$(mktemp -d "${TMPDIR:-/tmp}/kepler-installer.XXXXXX")
trap 'rm -rf -- "$stage"' EXIT

assets="$stage/assets"
bad_assets="$stage/bad-assets"
fake_bin="$stage/bin"
home="$stage/home"
bad_home="$stage/bad-home"
mkdir -p "$assets/bundle" "$fake_bin" "$home" "$bad_home"
printf 'installer smoke fixture\n' > "$assets/bundle/fixture.md"
cat > "$assets/kepler-linux-x64" <<'EOF'
#!/bin/sh
[ "${1:-}" = setup ] || exit 2
printf 'installer smoke setup\n'
EOF
chmod +x "$assets/kepler-linux-x64"
tar czf "$assets/kepler-bundle.tar.gz" -C "$assets" bundle/
(
  cd "$assets"
  sha256sum kepler-linux-x64 kepler-bundle.tar.gz > SHA256SUMS
)

cat > "$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
output=
url=
while (($#)); do
  case "$1" in
    -o)
      output=$2
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url=$1
      shift
      ;;
  esac
done
[[ -n "$output" && -n "$url" ]]
cp -- "$KEPLER_FAKE_ASSETS/${url##*/}" "$output"
EOF
cat > "$fake_bin/uname" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  -s) printf 'Linux\n' ;;
  -m) printf 'x86_64\n' ;;
  *) exec /usr/bin/uname "$@" ;;
esac
EOF
chmod +x "$fake_bin/curl" "$fake_bin/uname"

run_installer() {
  local target_home=$1
  local target_assets=$2
  HOME="$target_home" \
    PATH="$fake_bin:$PATH" \
    KEPLER_FAKE_ASSETS="$target_assets" \
    KEPLER_VERSION="vsmoke" \
    KEPLER_REPO_SLUG="vialactea-works/kepler" \
    bash "$repo_root/install.sh"
}

if ! output=$(run_installer "$home" "$assets" 2>&1); then
  printf '%s\n' "$output" >&2
  fail 'installer rejected valid release assets'
fi
[[ "$output" == *'installer smoke setup'* ]] ||
  fail 'installer did not run kepler setup'
[[ -L "$home/.local/bin/kepler" ]] ||
  fail 'kepler symlink was not installed'
[[ -x "$home/.kepler-dist/bin/kepler" ]] ||
  fail 'kepler binary was not installed'
[[ -f "$home/.kepler-dist/bundle/fixture.md" ]] ||
  fail 'release bundle was not extracted'
printf 'PASS: install, checksum verification, setup, and bundle extraction\n'

mkdir -p "$bad_assets"
cp -- "$assets/kepler-linux-x64" "$bad_assets/kepler-linux-x64"
cp -- "$assets/kepler-bundle.tar.gz" "$bad_assets/kepler-bundle.tar.gz"
cp -- "$assets/SHA256SUMS" "$bad_assets/SHA256SUMS"
printf 'corruption\n' >> "$bad_assets/kepler-linux-x64"
if run_installer "$bad_home" "$bad_assets" > "$stage/bad-install.log" 2>&1; then
  fail 'installer accepted a binary with an invalid checksum'
fi
grep -Fq 'FAILED' "$stage/bad-install.log" || fail 'checksum failure was not reported'
[[ ! -e "$bad_home/.kepler-dist/bin/kepler" ]] ||
  fail 'installer installed a binary before checksum verification'
printf 'PASS: invalid checksums stop installation before writing the binary\n'
