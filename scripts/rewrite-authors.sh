#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 --name <NAME> --email <EMAIL>

Rewrites the author and committer of every commit in this repository
to the given name and email. This is destructive — all commit hashes
will change and any remotes will need a force push.

Requires: git-filter-repo (pip install git-filter-repo)
EOF
  exit 1
}

NAME=""
EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --name) NAME="$2"; shift 2 ;;
    --email) EMAIL="$2"; shift 2 ;;
    -h|--help) usage ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

if [[ -z "$NAME" || -z "$EMAIL" ]]; then
  echo "Error: --name and --email are required."
  usage
fi

if ! git diff-index --quiet HEAD -- 2>/dev/null; then
  echo "Error: working tree is dirty. Commit or stash changes first."
  exit 1
fi

if ! command -v git-filter-repo &>/dev/null; then
  echo "Error: git-filter-repo not found. Install with: pip install git-filter-repo"
  exit 1
fi

BACKUP_REF="refs/original/refs/heads/$(git rev-parse --abbrev-ref HEAD)"

echo "Rewriting all commits to: $NAME <$EMAIL>"
echo "This is destructive. Proceed? [y/N]"
read -r confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

git filter-repo --force --commit-callback "
commit.author_name = b'$NAME'
commit.author_email = b'$EMAIL'
commit.committer_name = b'$NAME'
commit.committer_email = b'$EMAIL'
"

echo ""
echo "Done. All commits rewritten."
echo "Old refs backed up under $BACKUP_REF (if any)."
echo "Run: git push --force origin --all   to push to remote."
