#!/usr/bin/env bash
#
# hamilton-isolate.sh — own the workspace-isolation question for the skills that ask it.
#
#   hamilton-isolate.sh --check [--change-dir <dir>]   report isolation state
#   hamilton-isolate.sh <title>                        create .worktrees/<title> + branch <title>
#   hamilton-isolate.sh --verify <title>               confirm a cd into the worktree took effect
#
# Isolated means what the skills mean by it: a linked worktree, or any branch that
# is not the repo's default branch. The last line of --check is the verdict; the
# last line of create mode is the absolute worktree path.
#
# Exit: 0 yes / success, 1 no, 2 usage or environment error.

set -uo pipefail

usage() {
  cat <<'EOF'
usage:
  hamilton-isolate.sh --check [--change-dir <dir>]   report isolation state
  hamilton-isolate.sh <title>                        create .worktrees/<title> + branch <title>
  hamilton-isolate.sh --verify <title>               confirm a cd into the worktree took effect

exit: 0 yes / success, 1 no, 2 usage or environment error
EOF
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

# Absolute, symlink-resolved path of an existing directory.
abs_dir() {
  (cd "$1" 2>/dev/null && pwd -P)
}

require_repo() {
  git rev-parse --show-toplevel >/dev/null 2>&1 || die "not inside a git repository"
}

repo_root() {
  abs_dir "$(git rev-parse --show-toplevel)"
}

default_branch() {
  local ref candidate
  ref=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null)
  if [ -n "$ref" ]; then
    printf '%s\n' "${ref#refs/remotes/origin/}"
    return 0
  fi
  for candidate in main master; do
    if git show-ref --verify --quiet "refs/heads/$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  printf 'main\n'
}

# True in a linked worktree. In the main worktree — and in a submodule, which is
# why this compares directories rather than looking for a "worktrees" path
# segment — the two git dirs are the same.
is_linked_worktree() {
  local git_dir common_dir
  git_dir=$(abs_dir "$(git rev-parse --git-dir)") || return 1
  common_dir=$(abs_dir "$(git rev-parse --git-common-dir)") || return 1
  [ "$git_dir" != "$common_dir" ]
}

cmd_check() {
  local change_dir="$1"
  local root branch default mode isolated reason

  require_repo
  root=$(repo_root)
  branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
  default=$(default_branch)

  if is_linked_worktree; then
    mode="linked-worktree"
    isolated="yes"
    reason=""
  elif [ "$branch" = "HEAD" ]; then
    # Detached HEAD is off the default branch but is not a place to accumulate
    # work. Fail closed and name it rather than reporting a false yes.
    mode="detached-head"
    isolated="no"
    reason="detached HEAD — check out a branch or create a worktree"
  elif [ "$branch" != "$default" ]; then
    mode="in-place-branch"
    isolated="yes"
    reason=""
  else
    mode="none"
    isolated="no"
    reason="on the default branch ($default) with no worktree"
  fi

  printf 'root: %s\n' "$root"
  printf 'branch: %s\n' "$branch"
  printf 'default-branch: %s\n' "$default"
  printf 'mode: %s\n' "$mode"

  if [ -n "$change_dir" ]; then
    local resolved
    if [ ! -d "$change_dir" ]; then
      printf 'change-dir: %s (does not exist)\n' "$change_dir"
      printf 'isolated: no (change dir does not exist: %s)\n' "$change_dir"
      return 1
    fi
    resolved=$(abs_dir "$change_dir")
    if [ "$resolved" = "$root" ] || [ "${resolved#"$root"/}" != "$resolved" ]; then
      printf 'change-dir: %s (under root)\n' "$resolved"
    else
      printf 'change-dir: %s (OUTSIDE root)\n' "$resolved"
      printf 'isolated: no (change dir does not resolve under the worktree root %s)\n' "$root"
      return 1
    fi
  fi

  if [ "$isolated" = "yes" ]; then
    printf 'isolated: yes\n'
    return 0
  fi
  printf 'isolated: no (%s)\n' "$reason"
  return 1
}

cmd_create() {
  local title="$1"
  local root exclude_file

  case "$title" in
    -*) die "unknown option: $title" ;;
  esac
  printf '%s' "$title" | grep -Eq '^[a-z0-9]+(-[a-z0-9]+)*$' \
    || die "title must be kebab-case (got: $title)"

  require_repo
  if is_linked_worktree; then
    printf 'already in a linked worktree: %s\n' "$(repo_root)" >&2
    printf 'run --check instead of creating a nested worktree\n' >&2
    return 1
  fi
  root=$(repo_root)
  cd "$root" || die "cannot enter repository root: $root"

  if [ -e ".worktrees/$title" ]; then
    printf 'error: .worktrees/%s already exists — stop and ask; never silently reuse it\n' "$title" >&2
    return 1
  fi
  if git show-ref --verify --quiet "refs/heads/$title"; then
    printf 'error: branch %s already exists — stop and ask; never silently reuse it\n' "$title" >&2
    return 1
  fi

  # Consumer projects may not ignore .worktrees/ the way Hamilton's own repo does.
  # info/exclude keeps the fix local: it never shows up as a change to review.
  # Ask about ".worktrees/" with the trailing slash — the directory does not exist
  # yet, and without it git cannot tell that a "dir/" pattern applies.
  if ! git check-ignore -q .worktrees/ 2>/dev/null; then
    exclude_file="$(git rev-parse --git-common-dir)/info/exclude"
    mkdir -p "$(dirname "$exclude_file")" || die "cannot create $(dirname "$exclude_file")"
    if ! { [ -f "$exclude_file" ] && grep -qxF '.worktrees/' "$exclude_file"; }; then
      printf '.worktrees/\n' >>"$exclude_file" || die "cannot write $exclude_file"
      printf 'ignored: added .worktrees/ to %s\n' "$exclude_file"
    fi
  fi

  git worktree add ".worktrees/$title" -b "$title" >/dev/null 2>&1 \
    || die "git worktree add .worktrees/$title -b $title failed"

  printf 'created worktree: .worktrees/%s\n' "$title"
  printf 'created branch: %s\n' "$title"
  printf '%s\n' "$root/.worktrees/$title"
}

cmd_verify() {
  local title="$1" root
  require_repo
  root=$(repo_root)
  case "$root" in
    */.worktrees/"$title")
      printf 'verified: %s\n' "$root"
      return 0
      ;;
  esac
  printf 'not in .worktrees/%s — current root is %s\n' "$title" "$root" >&2
  return 1
}

main() {
  [ $# -gt 0 ] || { usage >&2; exit 2; }

  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --check)
      shift
      local change_dir=""
      while [ $# -gt 0 ]; do
        case "$1" in
          --change-dir)
            [ $# -ge 2 ] || die "--change-dir requires a value"
            change_dir="$2"
            shift 2
            ;;
          *) die "unknown argument to --check: $1" ;;
        esac
      done
      cmd_check "$change_dir"
      ;;
    --verify)
      [ $# -eq 2 ] || die "--verify requires exactly one title"
      cmd_verify "$2"
      ;;
    *)
      [ $# -eq 1 ] || die "create mode takes exactly one title"
      cmd_create "$1"
      ;;
  esac
}

main "$@"
