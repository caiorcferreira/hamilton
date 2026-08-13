#!/usr/bin/env bash
#
# hamilton-diff-package.sh — own per-task BASE bookkeeping and build the diff
# packages a reviewer dispatch carries.
#
#   hamilton-diff-package.sh --record [--change-dir <dir>]        store BASE = current HEAD
#   hamilton-diff-package.sh [--base <sha>] [--change-dir <dir>] [--out <file>]
#   hamilton-diff-package.sh --whole-change [--out <file>]        merge-base <default>..HEAD
#
# BASE lives on disk, so it survives a compacted context — the failure the
# "never HEAD~1" warning exists to prevent. Package mode never guesses a BASE:
# with nothing recorded it fails and tells you to --record first.
#
# The last line of every mode is the load-bearing path.
#
# Exit: 0 success, 1 nothing recorded / empty range, 2 usage or environment error.

set -uo pipefail

usage() {
  cat <<'EOF'
usage:
  hamilton-diff-package.sh --record [--change-dir <dir>]        store BASE = current HEAD
  hamilton-diff-package.sh [--base <sha>] [--change-dir <dir>] [--out <file>]
  hamilton-diff-package.sh --whole-change [--out <file>]        merge-base <default>..HEAD

exit: 0 success, 1 nothing recorded / empty range, 2 usage or environment error
EOF
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

abs_dir() {
  (cd "$1" 2>/dev/null && pwd -P)
}

repo_root() {
  git rev-parse --show-toplevel >/dev/null 2>&1 || die "not inside a git repository"
  abs_dir "$(git rev-parse --show-toplevel)"
}

# Walk up from CWD looking for a .hamilton/changes/<slug> directory. Never
# guesses beyond that: with no match, the caller must pass --change-dir.
discover_change_dir() {
  local dir
  dir=$(pwd -P)
  while [ "$dir" != "/" ]; do
    case "$dir" in
      */.hamilton/changes/*)
        # Climb to the slug directory itself, not a subdirectory of it.
        while [ "$(basename "$(dirname "$dir")")" != "changes" ]; do
          dir=$(dirname "$dir")
        done
        printf '%s\n' "$dir"
        return 0
        ;;
    esac
    dir=$(dirname "$dir")
  done
  return 1
}

resolve_change_dir() {
  local given="$1" resolved
  if [ -n "$given" ]; then
    [ -d "$given" ] || die "change dir does not exist: $given"
    abs_dir "$given"
    return 0
  fi
  resolved=$(discover_change_dir) \
    || die "not inside a change directory — pass --change-dir <dir>"
  printf '%s\n' "$resolved"
}

# Prefer the remote's default branch: a long-lived local branch can lag behind
# what the change will actually merge into.
default_ref() {
  local ref candidate
  ref=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)
  if [ -n "$ref" ]; then
    ref="origin/${ref#refs/remotes/origin/}"
    if git rev-parse --verify --quiet "$ref" >/dev/null 2>&1; then
      printf '%s\n' "$ref"
      return 0
    fi
  fi
  for candidate in main master; do
    if git rev-parse --verify --quiet "origin/$candidate" >/dev/null 2>&1; then
      printf 'origin/%s\n' "$candidate"
      return 0
    fi
    if git show-ref --verify --quiet "refs/heads/$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

# Keep .base out of `git status`: it sits inside a change directory whose
# artifacts are tracked, and an untracked file there would fail the finish gate.
ensure_base_ignored() {
  local base_file="$1" root rel exclude_file
  root=$(repo_root)
  rel="${base_file#"$root"/}"

  git check-ignore -q "$base_file" 2>/dev/null && return 0

  exclude_file="$(git rev-parse --git-common-dir)/info/exclude"
  mkdir -p "$(dirname "$exclude_file")" || die "cannot create $(dirname "$exclude_file")"
  if [ -f "$exclude_file" ] && grep -qxF "$rel" "$exclude_file"; then
    return 0
  fi
  printf '%s\n' "$rel" >>"$exclude_file" || die "cannot write $exclude_file"
  printf 'ignored: added %s to %s\n' "$rel" "$exclude_file"
}

write_package() {
  local base="$1" head="$2" label="$3" out="$4"

  if [ -z "$out" ]; then
    out=$(mktemp "${TMPDIR:-/tmp}/hamilton-diff-${label}-XXXXXX") \
      || die "cannot create a scratch file"
  fi

  {
    printf '# Hamilton diff package\n'
    printf '# range: %s..%s\n' "$base" "$head"
    printf '\n## git diff --stat %s..%s\n\n' "$base" "$head"
    git diff --stat "$base..$head"
    printf '\n## git diff -U10 %s..%s\n\n' "$base" "$head"
    git diff -U10 "$base..$head"
  } >"$out" || die "cannot write $out"

  printf 'range: %s..%s\n' "$base" "$head"
  printf 'files-changed: %s\n' "$(git diff --name-only "$base..$head" | wc -l | tr -d ' ')"
  printf '%s\n' "$out"
}

cmd_record() {
  local change_dir="$1" resolved head base_file
  resolved=$(resolve_change_dir "$change_dir") || exit $?
  head=$(git rev-parse HEAD 2>/dev/null) || die "cannot resolve HEAD"
  base_file="$resolved/.base"

  printf '%s\n' "$head" >"$base_file" || die "cannot write $base_file"
  ensure_base_ignored "$base_file"

  printf 'base: %s\n' "$head"
  printf '%s\n' "$base_file"
}

cmd_package() {
  local base="$1" change_dir="$2" out="$3"
  local resolved base_file head label

  if [ -z "$base" ]; then
    resolved=$(resolve_change_dir "$change_dir") || exit $?
    base_file="$resolved/.base"
    if [ ! -f "$base_file" ]; then
      printf 'error: no BASE recorded for %s — run --record before dispatching an implementer\n' \
        "$resolved" >&2
      return 1
    fi
    base=$(tr -d '[:space:]' <"$base_file")
    [ -n "$base" ] || { printf 'error: %s is empty — re-run --record\n' "$base_file" >&2; return 1; }
    label=$(basename "$resolved")
  else
    label="explicit-base"
  fi

  git rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1 \
    || die "BASE is not a commit in this repository: $base"
  head=$(git rev-parse HEAD 2>/dev/null) || die "cannot resolve HEAD"

  if [ "$(git rev-parse "$base^{commit}")" = "$head" ]; then
    printf 'error: BASE equals HEAD (%s) — nothing has been committed since --record\n' "$base" >&2
    return 1
  fi

  write_package "$base" "$head" "$label" "$out"
}

cmd_whole_change() {
  local out="$1" ref base head
  ref=$(default_ref) || die "cannot determine the default branch (no origin/HEAD, main, or master)"
  base=$(git merge-base "$ref" HEAD 2>/dev/null) \
    || die "cannot compute merge-base against $ref"
  head=$(git rev-parse HEAD 2>/dev/null) || die "cannot resolve HEAD"

  if [ "$base" = "$head" ]; then
    printf 'error: HEAD is at the merge-base with %s — this branch has no commits to review\n' \
      "$ref" >&2
    return 1
  fi

  printf 'default-branch: %s\n' "$ref"
  write_package "$base" "$head" "whole-change" "$out"
}

main() {
  [ $# -gt 0 ] || { usage >&2; exit 2; }

  local mode="package" base="" change_dir="" out=""

  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      --record) mode="record"; shift ;;
      --whole-change) mode="whole-change"; shift ;;
      --base)
        [ $# -ge 2 ] || die "--base requires a value"
        base="$2"; shift 2 ;;
      --change-dir)
        [ $# -ge 2 ] || die "--change-dir requires a value"
        change_dir="$2"; shift 2 ;;
      --out)
        [ $# -ge 2 ] || die "--out requires a value"
        out="$2"; shift 2 ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  repo_root >/dev/null

  case "$mode" in
    record)
      [ -z "$base" ] || die "--base is meaningless with --record"
      cmd_record "$change_dir"
      ;;
    whole-change)
      [ -z "$base" ] || die "--base is meaningless with --whole-change"
      [ -z "$change_dir" ] || die "--change-dir is meaningless with --whole-change"
      cmd_whole_change "$out"
      ;;
    package)
      cmd_package "$base" "$change_dir" "$out"
      ;;
  esac
}

main "$@"
