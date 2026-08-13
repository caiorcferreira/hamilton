#!/usr/bin/env bash
#
# hamilton-change-context.sh — orient in a change directory, or across all of them.
#
#   hamilton-change-context.sh [<change-dir>]   summarise one change (default: discover from CWD)
#   hamilton-change-context.sh --all            one line per change under .hamilton/changes/
#
# Read-only in every mode. It reports on artifacts and never writes or transforms one,
# so the answer to "where am I" costs one call instead of four speculative full reads —
# then read in full only what the summary says matters.
#
# Exit: 0 success, 1 nothing to report, 2 usage or environment error.

set -uo pipefail

usage() {
  cat <<'EOF'
usage:
  hamilton-change-context.sh [<change-dir>]   summarise one change (default: discover from CWD)
  hamilton-change-context.sh --all            one line per change under .hamilton/changes/

exit: 0 success, 1 nothing to report, 2 usage or environment error
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

strip_comments() {
  awk '
    /<!--/ { in_comment = 1 }
    !in_comment { print }
    /-->/ { in_comment = 0 }
  ' "$1"
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

mtime_epoch() {
  stat -f %m "$1" 2>/dev/null || stat -c %Y "$1" 2>/dev/null || printf '0'
}

fmt_date() {
  date -r "$1" +%Y-%m-%d 2>/dev/null || date -d "@$1" +%Y-%m-%d 2>/dev/null || printf 'unknown'
}

first_header() {
  strip_comments "$1" | grep -m1 '^#' | sed 's/^#\{1,\} *//'
}

# "Task 3<TAB>abandoned|active" per plan task.
plan_tasks() {
  strip_comments "$1" | awk '
    /^### Task [0-9]+:/ {
      match($0, /Task [0-9]+/)
      id = substr($0, RSTART, RLENGTH)
      state = (index(tolower($0), "(abandoned") > 0) ? "abandoned" : "active"
      printf "%s\t%s\n", id, state
    }
  '
}

# Latest outcome per task; progress appends newest at the bottom.
progress_outcomes() {
  strip_comments "$1" | awk '
    /^## Task [0-9]+:/ {
      match($0, /Task [0-9]+/)
      current = substr($0, RSTART, RLENGTH)
      next
    }
    current != "" && /^[ \t]*-?[ \t]*Outcome:/ {
      value = $0
      sub(/^[ \t]*-?[ \t]*Outcome:[ \t]*/, "", value)
      gsub(/[ \t\r]+$/, "", value)
      outcome[current] = value
      next
    }
    END { for (t in outcome) printf "%s\t%s\n", t, outcome[t] }
  '
}

# "<scope><TAB><verdict>" for the latest pass per scope, in first-seen order.
# Same scope-aware parse the finish gate uses.
review_verdicts() {
  strip_comments "$1" | awk '
    /^## / {
      line = $0
      sub(/^## /, "", line); sub(/\r$/, "", line)
      idx = index(line, " \342\200\224 ")
      if (idx == 0) idx = index(line, " - ")
      scope = (idx > 0) ? substr(line, 1, idx - 1) : line
      gsub(/^[ \t]+|[ \t]+$/, "", scope)
      if (!(scope in seen)) { seen[scope] = ++n; order[n] = scope }
      current = scope
      next
    }
    current != "" && tolower($0) ~ /^verdict:/ {
      value = $0
      sub(/^[Vv]erdict:[ \t]*/, "", value)
      gsub(/[ \t\r]+$/, "", value)
      verdict[current] = tolower(value)
      next
    }
    END { for (i = 1; i <= n; i++) printf "%s\t%s\n", order[i], (order[i] in verdict ? verdict[order[i]] : "?") }
  '
}

task_counts() {
  local dir="$1" total=0 done_count=0 abandoned=0 outcomes id state outcome
  [ -f "$dir/plan.md" ] || { printf '0\t0\t0\n'; return; }
  outcomes=""
  [ -f "$dir/progress.md" ] && outcomes=$(progress_outcomes "$dir/progress.md")

  while IFS=$'\t' read -r id state; do
    [ -n "$id" ] || continue
    if [ "$state" = "abandoned" ]; then
      abandoned=$((abandoned + 1))
      continue
    fi
    total=$((total + 1))
    outcome=$(printf '%s\n' "$outcomes" | awk -F'\t' -v t="$id" '$1 == t { print $2 }' | tail -1)
    [ "$outcome" = "done" ] && done_count=$((done_count + 1))
  done <<EOF
$(plan_tasks "$dir/plan.md")
EOF

  printf '%s\t%s\t%s\n' "$done_count" "$total" "$abandoned"
}

route_unit() {
  local dir="$1" line=""
  if [ -f "$dir/proposal.md" ]; then
    line=$(strip_comments "$dir/proposal.md" | grep -m1 '^| *Route unit *|' \
      | sed 's/^| *Route unit *| *//; s/ *|$//')
  fi
  if [ -z "$line" ] && [ -f "$dir/plan.md" ]; then
    line=$(strip_comments "$dir/plan.md" | grep -m1 '^- *Route unit:' \
      | sed 's/^- *Route unit: *//')
  fi
  # An unfilled template placeholder is not provenance.
  case "$line" in
    "<"*) line="" ;;
  esac
  printf '%s' "$line"
}

capabilities() {
  local dir="$1"
  [ -d "$dir/requirements" ] || return 0
  find "$dir/requirements" -maxdepth 1 -name '*.md' -exec basename {} .md \; 2>/dev/null | sort | tr '\n' ' '
}

ARTIFACTS="proposal.md design.md plan.md progress.md review.md critique.md"

cmd_one() {
  local dir="$1" artifact lines header route caps counts done_count total abandoned

  printf 'change: %s\n' "$(basename "$dir")"
  printf 'path: %s\n' "$dir"

  route=$(route_unit "$dir")
  [ -n "$route" ] && printf 'route-unit: %s\n' "$route"

  printf '\nartifacts:\n'
  for artifact in $ARTIFACTS; do
    if [ -f "$dir/$artifact" ]; then
      lines=$(wc -l <"$dir/$artifact" | tr -d ' ')
      header=$(first_header "$dir/$artifact")
      printf '  %-14s present  %5s lines  %s\n' "$artifact" "$lines" "$header"
    else
      printf '  %-14s absent\n' "$artifact"
    fi
  done
  caps=$(capabilities "$dir")
  if [ -n "$caps" ]; then
    printf '  %-14s present  %s\n' "requirements/" "${caps% }"
  else
    printf '  %-14s absent\n' "requirements/"
  fi

  counts=$(task_counts "$dir")
  done_count=$(printf '%s' "$counts" | cut -f1)
  total=$(printf '%s' "$counts" | cut -f2)
  abandoned=$(printf '%s' "$counts" | cut -f3)
  if [ "$total" -gt 0 ]; then
    if [ "$abandoned" -gt 0 ]; then
      printf '\ntasks: %s/%s done (%s abandoned)\n' "$done_count" "$total" "$abandoned"
    else
      printf '\ntasks: %s/%s done\n' "$done_count" "$total"
    fi
  else
    printf '\ntasks: none declared\n'
  fi

  local whole="not reviewed"
  if [ -f "$dir/review.md" ]; then
    printf 'reviews:\n'
    local scope verdict any=0
    while IFS=$'\t' read -r scope verdict; do
      [ -n "$scope" ] || continue
      any=1
      printf '  %s: %s\n' "$scope" "$verdict"
      case "$(printf '%s' "$scope" | tr '[:upper:]' '[:lower:]')" in
        "whole change") whole="$verdict" ;;
      esac
    done <<EOF
$(review_verdicts "$dir/review.md")
EOF
    [ "$any" -eq 1 ] || printf '  (no review passes recorded)\n'
  else
    printf 'reviews: review.md absent\n'
  fi

  printf 'summary: %s — %s/%s tasks done, whole change: %s\n' \
    "$(basename "$dir")" "$done_count" "$total" "$whole"
}

cmd_all() {
  local root changes_dir dir counts done_count total whole present artifact newest e rows
  root=$(repo_root)
  changes_dir="$root/.hamilton/changes"
  [ -d "$changes_dir" ] || { printf 'no .hamilton/changes/ under %s\n' "$root" >&2; return 1; }

  rows=""
  for dir in "$changes_dir"/*/; do
    [ -d "$dir" ] || continue
    dir="${dir%/}"

    present=""
    newest=0
    for artifact in $ARTIFACTS; do
      if [ -f "$dir/$artifact" ]; then
        present="$present,${artifact%.md}"
        e=$(mtime_epoch "$dir/$artifact")
        [ "$e" -gt "$newest" ] && newest="$e"
      fi
    done
    [ -d "$dir/requirements" ] && present="$present,requirements"
    [ -n "$present" ] || present=",(none)"
    [ "$newest" -gt 0 ] || newest=$(mtime_epoch "$dir")

    counts=$(task_counts "$dir")
    done_count=$(printf '%s' "$counts" | cut -f1)
    total=$(printf '%s' "$counts" | cut -f2)

    # ASCII dash, not an em-dash: the table is padded with awk's %-Ns, which
    # counts bytes, and a multi-byte placeholder would skew the column.
    whole="-"
    if [ -f "$dir/review.md" ]; then
      whole=$(review_verdicts "$dir/review.md" \
        | awk -F'\t' 'tolower($1) == "whole change" { v = $2 } END { print (v == "" ? "-" : v) }')
    fi

    rows="$rows$newest	$(basename "$dir")	${present#,}	$done_count/$total	$whole	$(fmt_date "$newest")
"
  done

  if [ -z "${rows//[$'\n\t ']/}" ]; then
    printf 'no changes under %s\n' "$changes_dir" >&2
    return 1
  fi

  {
    printf 'change\tartifacts\ttasks\twhole change\tlast modified\n'
    printf '%s' "$rows" | sort -rn | cut -f2-
  } | awk -F'\t' '{ printf "%-28s %-46s %-8s %-18s %s\n", $1, $2, $3, $4, $5 }'
}

main() {
  local target=""

  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      --all)
        [ $# -eq 1 ] || die "--all takes no other arguments"
        repo_root >/dev/null
        cmd_all
        return $?
        ;;
      -*) die "unknown argument: $1" ;;
      *)
        [ -z "$target" ] || die "pass at most one change directory"
        target="$1"; shift ;;
    esac
  done

  if [ -n "$target" ]; then
    [ -d "$target" ] || die "change dir does not exist: $target"
    target=$(abs_dir "$target")
  else
    target=$(discover_change_dir) \
      || die "not inside a change directory — pass one as an argument, or use --all"
  fi

  cmd_one "$target"
}

main "$@"
