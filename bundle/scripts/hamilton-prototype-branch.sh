#!/usr/bin/env bash
#
# hamilton-prototype-branch.sh — own the prototype-branch question for the wayfinder
# prototype procedure.
#
#   hamilton-prototype-branch.sh <map-name> <ticket-name>    create/resume prototype/<map-name>/<ticket-name>
#   hamilton-prototype-branch.sh --standalone <slug>         create/resume prototype/<slug>
#   hamilton-prototype-branch.sh --verify <expected-branch>  confirm the current branch matches
#
# The branch is the ticket's identity: rerunning create/resume mode on an existing
# prototype/... branch switches to it and reports mode: resumed rather than erroring.
# Uncommitted changes ride along via plain `git switch` / `git switch -c` behavior.
# The last line of create/resume mode is the branch name.
#
# Exit: 0 yes / success, 1 no (--verify mismatch), 2 usage or environment error.

set -uo pipefail

usage() {
  cat <<'EOF'
usage:
  hamilton-prototype-branch.sh <map-name> <ticket-name>    create/resume prototype/<map-name>/<ticket-name>
  hamilton-prototype-branch.sh --standalone <slug>         create/resume prototype/<slug>
  hamilton-prototype-branch.sh --verify <expected-branch>  confirm the current branch matches

exit: 0 yes / success, 1 no (--verify mismatch), 2 usage or environment error
EOF
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

require_repo() {
  git rev-parse --show-toplevel >/dev/null 2>&1 || die "not inside a git repository"
}

cmd_switch() {
  local branch="$1" mode
  require_repo
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git switch "$branch" >/dev/null || die "git switch $branch failed"
    mode="resumed"
  else
    git switch -c "$branch" >/dev/null || die "git switch -c $branch failed"
    mode="created"
  fi
  printf 'mode: %s\n' "$mode"
  printf '%s\n' "$branch"
}

cmd_verify() {
  local expected="$1" current
  require_repo
  current=$(git branch --show-current)
  if [ "$current" = "$expected" ]; then
    printf 'verified: %s\n' "$current"
    return 0
  fi
  printf 'not on %s — current branch is %s\n' "$expected" "$current" >&2
  return 1
}

main() {
  [ $# -gt 0 ] || { usage >&2; exit 2; }

  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    --standalone)
      [ $# -eq 2 ] || die "--standalone requires exactly one slug"
      cmd_switch "prototype/$2"
      ;;
    --verify)
      [ $# -eq 2 ] || die "--verify requires exactly one branch"
      cmd_verify "$2"
      ;;
    -*)
      die "unknown option: $1"
      ;;
    *)
      [ $# -eq 2 ] || die "create mode takes exactly two arguments: <map-name> <ticket-name>"
      cmd_switch "prototype/$1/$2"
      ;;
  esac
}

main "$@"
