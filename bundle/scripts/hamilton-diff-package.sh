#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P) || exit 2
. "$SCRIPT_DIR/hamilton-artifact-contracts.sh" || exit 2

usage() {
  cat <<'EOF'
usage:
  hamilton-diff-package.sh --record --task <N> [--change-dir <dir>]
  hamilton-diff-package.sh --task <N> [--change-dir <dir>] [--out <file>]
  hamilton-diff-package.sh --base <sha> [--change-dir <dir>] [--out <file>]
  hamilton-diff-package.sh --whole-change [--out <file>]

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
  local root
  root=$(git rev-parse --show-toplevel 2>/dev/null) || die "not inside a git repository"
  abs_dir "$root"
}

repo_root_for_change() {
  local change_dir="$1" root
  root=$(git -C "$change_dir" rev-parse --show-toplevel 2>/dev/null) || die "change dir is not inside a git repository: $change_dir"
  abs_dir "$root"
}

discover_change_dir() {
  local dir
  dir=$(pwd -P)
  while [ "$dir" != "/" ]; do
    case "$dir" in
      */.hamilton/changes/*)
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
  resolved=$(discover_change_dir) || die "not inside a change directory — pass --change-dir <dir>"
  printf '%s\n' "$resolved"
}

default_ref() {
  local root="$1" ref candidate
  ref=$(git -C "$root" symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)
  if [ -n "$ref" ]; then
    ref="origin/${ref#refs/remotes/origin/}"
    if git -C "$root" rev-parse --verify --quiet "$ref" >/dev/null 2>&1; then
      printf '%s\n' "$ref"
      return 0
    fi
  fi
  for candidate in main master; do
    if git -C "$root" rev-parse --verify --quiet "origin/$candidate" >/dev/null 2>&1; then
      printf 'origin/%s\n' "$candidate"
      return 0
    fi
    if git -C "$root" show-ref --verify --quiet "refs/heads/$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

ensure_base_ignored() {
  local base_file="$1" root="$2" rel common_dir exclude_file
  rel="${base_file#"$root"/}"
  git -C "$root" check-ignore -q -- "$base_file" 2>/dev/null && return 0
  common_dir=$(git -C "$root" rev-parse --git-common-dir) || die "cannot resolve Git common directory"
  case "$common_dir" in
    /*) exclude_file="$common_dir/info/exclude" ;;
    *) exclude_file="$root/$common_dir/info/exclude" ;;
  esac
  mkdir -p "$(dirname "$exclude_file")" || die "cannot create $(dirname "$exclude_file")"
  if [ -f "$exclude_file" ] && grep -qxF "$rel" "$exclude_file"; then
    return 0
  fi
  printf '%s\n' "$rel" >>"$exclude_file" || die "cannot write $exclude_file"
  printf 'ignored: added %s to %s\n' "$rel" "$exclude_file"
}

validate_task() {
  local change_dir="$1" task="$2" plan title status
  plan="$change_dir/plan.md"
  [ -f "$plan" ] || die "task $task has no plan at $plan"
  title=$(hamilton_resolve_active_task "$plan" "$task")
  status=$?
  case "$status" in
    0) ;;
    1) die "task $task is not active in $plan" ;;
    2) die "task must be an exact positive task number and the plan must declare each task once" ;;
    3) die "task $task is abandoned in $plan" ;;
    *) die "cannot resolve task $task in $plan" ;;
  esac
}

task_base_file() {
  printf '%s/tasks/task-%s/.base\n' "$1" "$2"
}

read_task_checkpoint() {
  local base_file="$1" root="$2" checkpoint canonical
  checkpoint=$(<"$base_file")
  if [[ ! "$checkpoint" =~ ^[0-9a-f]+$ ]]; then
    printf 'error: task checkpoint %s must contain exactly one full commit ID\n' "$base_file" >&2
    return 2
  fi
  canonical=$(git -C "$root" rev-parse --verify --quiet "$checkpoint^{commit}" 2>/dev/null) || {
    printf 'error: task checkpoint %s must contain exactly one full commit ID\n' "$base_file" >&2
    return 2
  }
  if [ "$checkpoint" != "$canonical" ]; then
    printf 'error: task checkpoint %s must contain exactly one full commit ID\n' "$base_file" >&2
    return 2
  fi
  printf '%s\n' "$checkpoint"
}

task_row_status() {
  local progress="$1" task="$2"
  awk -v task="$task" '
    BEGIN {
      link = "\\[details\\]\\(tasks/task-" task "/progress\\.md\\)"
      suffix = "[ \\t]*\\|[ \\t]*" link "[ \\t]*\\|[ \\t]*$"
    }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line !~ suffix) next
      prefix = line
      sub(suffix, "", prefix)
      if (prefix !~ ("^\\|[ \\t]*Task " task ":[ \\t]+")) invalid = 1
      status = prefix
      sub(/^.*\|[ \\t]*/, "", status)
      sub(/[ \\t]+$/, "", status)
      count++
      found = status
    }
    END {
      if (invalid || count != 1) exit 1
      print found
    }
  ' "$progress"
}

task_log_has_attempt() {
  awk '
    function normalize_atx(value) {
      if (substr(value, 1, 4) == "    ") return value
      if (substr(value, 1, 3) == "   ") return substr(value, 4)
      if (substr(value, 1, 2) == "  ") return substr(value, 3)
      if (substr(value, 1, 1) == " ") return substr(value, 2)
      return value
    }
    {
      remaining = $0
      visible = ""
      while (length(remaining) > 0) {
        if (in_comment) {
          marker = index(remaining, "-->")
          if (!marker) remaining = ""
          else {
            remaining = substr(remaining, marker + 3)
            in_comment = 0
          }
        } else {
          marker = index(remaining, "<!--")
          if (!marker) {
            visible = visible remaining
            remaining = ""
          } else {
            visible = visible substr(remaining, 1, marker - 1)
            remaining = substr(remaining, marker + 4)
            in_comment = 1
          }
        }
      }
      line = normalize_atx(visible)
      sub(/\r$/, "", line)
      if (line ~ /^##([ \\t]|$)/) found = 1
    }
    END { exit !found }
  ' "$1"
}

validate_first_checkpoint() {
  local change_dir="$1" task="$2" progress task_progress feedback status
  progress="$change_dir/progress.md"
  task_progress="$change_dir/tasks/task-$task/progress.md"
  feedback="$change_dir/tasks/task-$task/feedback.md"
  [ -f "$progress" ] || die "cannot create a checkpoint without the split root task ledger: $progress"
  [ -f "$task_progress" ] || die "cannot create a checkpoint without the task progress file: $task_progress"
  status=$(task_row_status "$progress" "$task") || die "cannot create a checkpoint without one exact split row for Task $task"
  if [ "$status" != "pending" ] || task_log_has_attempt "$task_progress" || [ -e "$feedback" ]; then
    die "cannot create missing checkpoint for Task $task after durable task evidence; historical recovery requires unambiguous durable git and task evidence or intervention"
  fi
}

write_package() {
  local root="$1" base="$2" head="$3" label="$4" out="$5"
  if [ -z "$out" ]; then
    out=$(mktemp "${TMPDIR:-/tmp}/hamilton-diff-${label}-XXXXXX") || die "cannot create a scratch file"
  elif [[ "$out" != /* ]]; then
    out="$root/$out"
  fi
  {
    printf '# Hamilton diff package\n'
    printf '# range: %s..%s\n' "$base" "$head"
    printf '\n## git diff --stat %s..%s\n\n' "$base" "$head"
    git -C "$root" diff --stat "$base..$head"
    printf '\n## git diff -U10 %s..%s\n\n' "$base" "$head"
    git -C "$root" diff -U10 "$base..$head"
  } >"$out" || die "cannot write $out"
  printf 'range: %s..%s\n' "$base" "$head"
  printf 'files-changed: %s\n' "$(git -C "$root" diff --name-only "$base..$head" | wc -l | tr -d ' ')"
  printf '%s\n' "$out"
}

cmd_record() {
  local change_dir="$1" task="$2" resolved root base_file base
  resolved=$(resolve_change_dir "$change_dir") || exit $?
  root=$(repo_root_for_change "$resolved") || exit $?
  validate_task "$resolved" "$task"
  base_file=$(task_base_file "$resolved" "$task")
  if [ -f "$base_file" ]; then
    base=$(read_task_checkpoint "$base_file" "$root") || return $?
    git -C "$root" merge-base --is-ancestor "$base" HEAD || die "task checkpoint is not an ancestor of HEAD: $base"
  else
    validate_first_checkpoint "$resolved" "$task"
    mkdir -p "$(dirname "$base_file")" || die "cannot create $(dirname "$base_file")"
    base=$(git -C "$root" rev-parse HEAD 2>/dev/null) || die "cannot resolve HEAD"
    printf '%s\n' "$base" >"$base_file" || die "cannot write $base_file"
  fi
  ensure_base_ignored "$base_file" "$root"
  printf 'base: %s\n' "$base"
  printf '%s\n' "$base_file"
}

cmd_package() {
  local base="$1" change_dir="$2" task="$3" out="$4"
  local resolved root base_file head label recorded="no"
  if [ -z "$base" ]; then
    resolved=$(resolve_change_dir "$change_dir") || exit $?
    root=$(repo_root_for_change "$resolved") || exit $?
    validate_task "$resolved" "$task"
    base_file=$(task_base_file "$resolved" "$task")
    if [ ! -f "$base_file" ]; then
      printf 'error: no BASE recorded for Task %s — run --record before dispatching an implementer\n' "$task" >&2
      return 1
    fi
    [ -n "$(tr -d '[:space:]' <"$base_file")" ] || {
      printf 'error: %s is empty — re-run --record\n' "$base_file" >&2
      return 1
    }
    base=$(read_task_checkpoint "$base_file" "$root") || return $?
    label="task-$task"
    recorded="yes"
  else
    if [ -n "$change_dir" ]; then
      resolved=$(resolve_change_dir "$change_dir") || exit $?
      root=$(repo_root_for_change "$resolved") || exit $?
    elif resolved=$(discover_change_dir); then
      root=$(repo_root_for_change "$resolved") || exit $?
    else
      root=$(repo_root) || exit $?
    fi
    label="explicit-base"
  fi
  git -C "$root" rev-parse --verify --quiet "$base^{commit}" >/dev/null 2>&1 || die "BASE is not a commit in this repository: $base"
  head=$(git -C "$root" rev-parse HEAD 2>/dev/null) || die "cannot resolve HEAD"
  if [ "$recorded" = "yes" ] && ! git -C "$root" merge-base --is-ancestor "$base" "$head"; then
    die "BASE is not an ancestor of HEAD: $base"
  fi
  if [ "$(git -C "$root" rev-parse "$base^{commit}")" = "$head" ]; then
    printf 'error: BASE equals HEAD (%s) — nothing has been committed since --record\n' "$base" >&2
    return 1
  fi
  write_package "$root" "$base" "$head" "$label" "$out"
}

cmd_whole_change() {
  local out="$1" root ref base head
  root=$(repo_root) || exit $?
  ref=$(default_ref "$root") || die "cannot determine the default branch (no origin/HEAD, main, or master)"
  base=$(git -C "$root" merge-base "$ref" HEAD 2>/dev/null) || die "cannot compute merge-base against $ref"
  head=$(git -C "$root" rev-parse HEAD 2>/dev/null) || die "cannot resolve HEAD"
  if [ "$base" = "$head" ]; then
    printf 'error: HEAD is at the merge-base with %s — this branch has no commits to review\n' "$ref" >&2
    return 1
  fi
  printf 'default-branch: %s\n' "$ref"
  write_package "$root" "$base" "$head" "whole-change" "$out"
}

main() {
  [ $# -gt 0 ] || { usage >&2; exit 2; }
  local mode="package" base="" change_dir="" task="" out=""
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
      --task)
        [ $# -ge 2 ] || die "--task requires a value"
        task="$2"; shift 2 ;;
      --out)
        [ $# -ge 2 ] || die "--out requires a value"
        out="$2"; shift 2 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  case "$mode" in
    record)
      [ -z "$base" ] || die "--base is meaningless with --record"
      [ -n "$task" ] || die "--task is required with --record"
      cmd_record "$change_dir" "$task"
      ;;
    whole-change)
      [ -z "$base" ] || die "--base is meaningless with --whole-change"
      [ -z "$change_dir" ] || die "--change-dir is meaningless with --whole-change"
      [ -z "$task" ] || die "--task is meaningless with --whole-change"
      cmd_whole_change "$out"
      ;;
    package)
      if [ -n "$base" ]; then
        [ -z "$task" ] || die "--task is meaningless with --base"
      else
        [ -n "$task" ] || die "--task is required when --base is not given"
      fi
      cmd_package "$base" "$change_dir" "$task" "$out"
      ;;
  esac
}

main "$@"
