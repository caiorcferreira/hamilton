#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf 'Usage: %s <compiled-linux-x64-binary> [bundle-directory]\n' "$0" >&2
  exit 2
fi

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
repo_root=$(cd -- "$script_dir/.." && pwd -P)
bundle_source="${2:-$repo_root/bundle}"
if [[ "$bundle_source" != /* ]]; then
  bundle_source="$PWD/$bundle_source"
fi
lint_source="$repo_root/.kepler/specs/cli-distribution.md"
if [[ ! -f "$lint_source" ]]; then
  lint_source="$repo_root/.hamilton/specs/cli-distribution.md"
fi
binary_source=$1
if [[ "$binary_source" != /* ]]; then
  binary_source="$PWD/$binary_source"
fi

[[ -f "$binary_source" ]] || fail "binary not found: $binary_source"
[[ -d "$bundle_source" ]] || fail "bundle directory not found: $bundle_source"
[[ -f "$lint_source" ]] || fail "lint fixture not found: $lint_source"

expected_version=$(awk -F '"' '/^export const VERSION = / { print $2; exit }' "$repo_root/src/index.ts")
[[ -n "$expected_version" ]] || fail "could not read canonical VERSION from src/index.ts"

stage=$(mktemp -d "${TMPDIR:-/tmp}/kepler-standalone.XXXXXX")
stage_cleanup_path=$stage
cleanup() {
  rm -rf -- "$stage_cleanup_path"
}
trap cleanup EXIT

stage=$(cd -- "$stage_cleanup_path" && pwd -P) || fail 'could not resolve temporary stage path'
stage_cleanup_path=$stage

case "$stage/" in
  "$repo_root/"*) fail "temporary stage must be outside the source checkout" ;;
esac

mkdir -p "$stage/bin" "$stage/home" "$stage/runtime-path" "$stage/.kepler/specs"
cp -- "$binary_source" "$stage/bin/kepler"
chmod +x "$stage/bin/kepler"
cp -R -- "$bundle_source" "$stage/bundle"
cp -- "$lint_source" "$stage/.kepler/specs/cli-distribution.md"

if PATH="$stage/runtime-path" command -v bun >/dev/null 2>&1 || PATH="$stage/runtime-path" command -v node >/dev/null 2>&1; then
  fail "restricted runtime PATH unexpectedly exposes Bun or Node"
fi

run_cli() {
  (
    cd -- "$stage"
    env -i HOME="$stage/home" XDG_CONFIG_HOME="$stage/home/.config" PATH="$stage/runtime-path" "$stage/bin/kepler" "$@"
  )
}

capture_success() {
  local name=$1
  shift
  if ! run_cli "$@" >"$stage/$name.stdout" 2>"$stage/$name.stderr"; then
    printf 'FAIL: %s command failed\n' "$name" >&2
    cat "$stage/$name.stdout" "$stage/$name.stderr" >&2
    exit 1
  fi
  if [[ -s "$stage/$name.stderr" ]]; then
    printf 'FAIL: %s wrote to stderr\n' "$name" >&2
    cat "$stage/$name.stderr" >&2
    exit 1
  fi
}

capture_success version --version
printf '%s\n' "$expected_version" > "$stage/version.expected"
if ! cmp -s "$stage/version.expected" "$stage/version.stdout"; then
  printf 'FAIL: expected exact version %s; got:\n' "$expected_version" >&2
  cat "$stage/version.stdout" >&2
  exit 1
fi
printf 'PASS: exact version %s\n' "$expected_version"

[[ ! -e "$stage/bin/hamilton" ]] || fail 'legacy Hamilton executable alias exists'
capture_success root-help --help
grep -Fq 'Usage: kepler' "$stage/root-help.stdout" || fail 'root help usage missing'
grep -Fq 'workbench' "$stage/root-help.stdout" || fail 'root help workbench command missing'
printf 'PASS: root help\n'

capture_success workbench-help workbench --help
grep -Fq 'Usage: kepler workbench' "$stage/workbench-help.stdout" || fail 'workbench help usage missing'
grep -Fq 'lint' "$stage/workbench-help.stdout" || fail 'workbench help lint command missing'
printf 'PASS: workbench help\n'

capture_success setup setup
grep -Fq 'Kepler set up successfully.' "$stage/setup.stdout" || fail 'setup success message missing'
grep -Fq 'Installed guidelines.' "$stage/setup.stdout" || fail 'setup guidelines report missing'
[[ -f "$stage/home/.config/.vialactea-works/kepler/templates/task-progress.md" ]] || fail 'setup task-progress template missing'
[[ -f "$stage/home/.config/.vialactea-works/kepler/guidelines/typescript/02-code-style.md" ]] || fail 'setup TypeScript guideline missing'
printf 'PASS: setup assets\n'

capture_success lint workbench lint --file "$stage/.kepler/specs/cli-distribution.md"
grep -Fq "SUCCESS $stage/.kepler/specs/cli-distribution.md" "$stage/lint.stdout" || fail 'lint success result missing'
grep -Fq 'lint: success' "$stage/lint.stdout" || fail 'lint completion result missing'
printf 'PASS: representative lint operation\n'

rm -rf -- "$stage/bundle"
if run_cli setup >"$stage/missing-bundle.stdout" 2>"$stage/missing-bundle.stderr"; then
  fail 'setup succeeded after the staged bundle was removed'
else
  missing_status=$?
fi
[[ "$missing_status" -eq 2 ]] || fail "missing-bundle setup exited $missing_status instead of 2"
grep -Fq 'Could not locate the Kepler bundle directory' "$stage/missing-bundle.stderr" || fail 'missing-bundle error message missing'
grep -Fq "$stage/bundle" "$stage/missing-bundle.stderr" || fail 'missing-bundle checked path missing'
if grep -Fq "$bundle_source" "$stage/missing-bundle.stderr"; then
  fail 'missing-bundle error unexpectedly checked the source checkout bundle'
fi
printf 'PASS: missing bundle reports checked paths and exits 2 without checkout fallback\n'
printf 'PASS: all checks ran outside the checkout with Bun and Node absent from runtime PATH\n'
