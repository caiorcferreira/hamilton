#!/usr/bin/env bash

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
  local epoch
  if epoch=$(stat -f %m "$1" 2>/dev/null); then
    printf '%s\n' "$epoch"
    return
  fi
  if epoch=$(stat -c %Y "$1" 2>/dev/null); then
    printf '%s\n' "$epoch"
    return
  fi
  printf '0\n'
}

fmt_date() {
  date -r "$1" +%Y-%m-%d 2>/dev/null || date -d "@$1" +%Y-%m-%d 2>/dev/null || printf 'unknown'
}

first_header() {
  strip_comments "$1" | grep -m1 '^#' | sed 's/^#\{1,\} *//'
}

plan_tasks() {
  strip_comments "$1" | awk '
    /^### Task [1-9][0-9]*:/ {
      line = $0
      sub(/^### /, "", line)
      id = line
      sub(/:.*/, "", id)
      title = line
      sub(/^Task [1-9][0-9]*:[ \t]*/, "", title)
      sub(/[ \t]+$/, "", title)
      state = (index(tolower(title), "(abandoned") > 0) ? "abandoned" : "active"
      printf "%s\t%s\t%s\n", id, title, state
    }
  '
}

root_rows() {
  strip_comments "$1" | awk '
    function trim(value) {
      sub(/^[ \t]+/, "", value)
      sub(/[ \t]+$/, "", value)
      return value
    }
    function emit_row(line,    value, i, character, cell, n, escaped) {
      value = line
      sub(/^[ \t]*\|[ \t]*/, "", value)
      sub(/[ \t]*\|[ \t]*$/, "", value)
      cell = ""
      n = 0
      escaped = 0
      for (i = 1; i <= length(value); i++) {
        character = substr(value, i, 1)
        if (escaped) {
          cell = cell "\\" character
          escaped = 0
        } else if (character == "\\") {
          escaped = 1
        } else if (character == "|") {
          cells[++n] = trim(cell)
          cell = ""
        } else {
          cell = cell character
        }
      }
      if (escaped) cell = cell "\\"
      cells[++n] = trim(cell)
      if (n != 3) {
        invalid = 1
        return
      }
      printf "%s\t%s\t%s\n", cells[1], cells[2], cells[3]
    }
    $0 == "| Task | Status | Progress |" {
      if (table_seen) {
        invalid = 1
        exit
      }
      table_seen = 1
      found = 1
      separator = 1
      next
    }
    found && separator {
      if ($0 !~ /^[ \t]*\|[ \t]*-+[ \t]*\|[ \t]*-+[ \t]*\|[ \t]*-+[ \t]*\|[ \t]*$/) {
        invalid = 1
        exit
      }
      separator = 0
      next
    }
    found && $0 ~ /^[ \t]*\|/ {
      emit_row($0)
      next
    }
    found && $0 !~ /^[ \t]*$/ {
      found = 0
    }
    END { exit invalid }
  '
}

has_only_root_ledger_shape() {
  strip_comments "$1" | awk '
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ /^[ \t]*$/) next
      if (!heading) {
        if (line ~ /^# Progress:/) heading = 1
        else invalid = 1
        next
      }
      if (!table) {
        if (line == "| Task | Status | Progress |") table = 1
        else invalid = 1
        next
      }
      if (!separator) {
        if (line ~ /^[ \t]*\|[ \t]*-+[ \t]*\|[ \t]*-+[ \t]*\|[ \t]*-+[ \t]*\|[ \t]*$/) separator = 1
        else invalid = 1
        next
      }
      if (line !~ /^[ \t]*\|/) invalid = 1
    }
    END { exit !(heading && table && separator && !invalid) }
  '
}

escape_table_title() {
  printf '%s' "$1" | sed 's/|/\\|/g'
}

latest_outcome() {
  local file="$1" task="$2" title="$3"
  strip_comments "$file" | awk -v task="$task" -v title="$title" '
    function close_attempt() {
      if (active && outcome_count != 1) invalid = 1
      active = 0
      outcome_count = 0
    }
    /^# / {
      if (title_seen || active || attempt_seen) {
        close_attempt()
        latest = ""
        invalid = 1
      }
      title_seen = 1
      next
    }
    /^## / {
      close_attempt()
      latest = ""
      attempt_seen = 1
      heading = $0
      sub(/^## /, "", heading)
      sub(/\r$/, "", heading)
      suffix = " \342\200\224 [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"
      if (heading !~ (suffix "$")) {
        invalid = 1
        next
      }
      sub(suffix "$", "", heading)
      if (heading != task ": " title) {
        invalid = 1
        next
      }
      active = 1
      next
    }
    /^###+[ \t]/ {
      close_attempt()
      latest = ""
      invalid = 1
      next
    }
    /^[ \t]*-?[ \t]*Outcome:/ {
      if (!active) {
        latest = ""
        invalid = 1
        next
      }
      value = $0
      sub(/^[ \t]*-?[ \t]*Outcome:[ \t]*/, "", value)
      sub(/[ \t\r]+$/, "", value)
      outcome_count++
      if (outcome_count != 1) invalid = 1
      if (value != "done" && value != "blocked") invalid = 1
      latest = value
    }
    END {
      close_attempt()
      print latest
      exit invalid
    }
  '
}

ledger_error() {
  printf 'task ledger: %s\n' "$1" >&2
  return 1
}

validate_ledger() {
  local dir="$1" plan="$dir/plan.md" progress="$dir/progress.md"
  local plans rows_text index row id title state actual_task status link expected_task expected_link task_file outcome active row_count

  plans=$(plan_tasks "$plan")
  rows_text=$(root_rows "$progress") || return 1
  [ -n "$plans" ] || { ledger_error "plan has no active task declarations"; return 1; }
  active=0
  while IFS=$'\t' read -r id title state; do
    [ -n "$id" ] || continue
    [ "$state" = "active" ] && active=$((active + 1))
  done <<EOF
$plans
EOF
  row_count=0
  while IFS=$'\t' read -r actual_task status link; do
    [ -n "$actual_task" ] || continue
    row_count=$((row_count + 1))
  done <<EOF
$rows_text
EOF
  [ "$row_count" -eq "$active" ] || { ledger_error "root rows do not match active plan tasks"; return 1; }
  index=0
  while IFS=$'\t' read -r id title state; do
    [ -n "$id" ] || continue
    [ "$state" = "active" ] || continue
    index=$((index + 1))
    row=$(printf '%s\n' "$rows_text" | sed -n "${index}p")
    IFS=$'\t' read -r actual_task status link <<<"$row"
    expected_task="$id: $(escape_table_title "$title")"
    expected_link="[details](tasks/task-${id#Task }/progress.md)"
    [ "$actual_task" = "$expected_task" ] || { ledger_error "row $((index + 1)) must identify $expected_task"; return 1; }
    case "$status" in
      pending|in-progress|blocked|done) ;;
      *) ledger_error "row $((index + 1)) has illegal status $status"; return 1 ;;
    esac
    [ "$link" = "$expected_link" ] || { ledger_error "row $((index + 1)) has the wrong task link"; return 1; }
    task_file="$dir/tasks/task-${id#Task }/progress.md"
    [ -f "$task_file" ] || { ledger_error "$id progress file is missing"; return 1; }
    [ "$(first_header "$task_file")" = "Task Progress: $id — $title" ] || { ledger_error "$id progress heading does not match"; return 1; }
    outcome=$(latest_outcome "$task_file" "$id" "$title") || { ledger_error "$id progress contains invalid task attempt sections"; return 1; }
    [ "$status" != "done" ] || [ "$outcome" = "done" ] || { ledger_error "$id done row lacks latest Outcome: done evidence"; return 1; }
  done <<EOF
$plans
EOF
}

ledger_counts() {
  local progress="$1" row task status link total=0 done_count=0
  while IFS=$'\t' read -r task status link; do
    [ -n "$task" ] || continue
    total=$((total + 1))
    [ "$status" = "done" ] && done_count=$((done_count + 1))
  done < <(root_rows "$progress")
  printf '%s\t%s\n' "$done_count" "$total"
}

has_task_review_pass() {
  strip_comments "$1" | grep -Eq '^## Task [1-9][0-9]*([ :]|$)'
}

format_of() {
  local dir="$1" plan_row id title state
  [ -f "$dir/plan.md" ] || { printf 'pre-plan\n'; return; }
  [ -f "$dir/progress.md" ] && has_only_root_ledger_shape "$dir/progress.md" || { printf 'legacy-unsupported\n'; return; }
  [ ! -f "$dir/review.md" ] || ! has_task_review_pass "$dir/review.md" || { printf 'legacy-unsupported\n'; return; }
  while IFS=$'\t' read -r id title state; do
    [ "$state" = "active" ] || continue
    [ -f "$dir/tasks/task-${id#Task }/progress.md" ] || { printf 'legacy-unsupported\n'; return; }
  done < <(plan_tasks "$dir/plan.md")
  printf 'split\n'
}

route_unit() {
  local dir="$1" line=""
  if [ -f "$dir/proposal.md" ]; then
    line=$(strip_comments "$dir/proposal.md" | grep -m1 '^| *Route unit *|' | sed 's/^| *Route unit *| *//; s/ *|$//')
  fi
  if [ -z "$line" ] && [ -f "$dir/plan.md" ]; then
    line=$(strip_comments "$dir/plan.md" | grep -m1 '^- *Route unit:' | sed 's/^- *Route unit: *//')
  fi
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

review_verdicts() {
  strip_comments "$1" | awk '
    /^## / {
      line = $0
      sub(/^## /, "", line)
      idx = index(line, " \342\200\224 ")
      if (idx == 0) idx = index(line, " - ")
      scope = (idx > 0) ? substr(line, 1, idx - 1) : line
      gsub(/^[ \t]+|[ \t]+$/, "", scope)
      if (!(scope in seen)) {
        seen[scope] = ++n
        order[n] = scope
      }
      current = scope
      next
    }
    current != "" && tolower($0) ~ /^verdict:/ {
      value = $0
      sub(/^[Vv]erdict:[ \t]*/, "", value)
      gsub(/[ \t\r]+$/, "", value)
      verdict[current] = tolower(value)
    }
    END {
      for (i = 1; i <= n; i++) printf "%s\t%s\n", order[i], (order[i] in verdict ? verdict[order[i]] : "?")
    }
  '
}

ARTIFACTS="proposal.md design.md plan.md progress.md review.md critique.md"

cmd_one() {
  local dir="$1" format artifact lines header route caps counts done_count total whole scope verdict any
  format=$(format_of "$dir")
  printf 'change: %s\n' "$(basename "$dir")"
  printf 'path: %s\n' "$dir"
  printf 'format: %s\n' "$format"
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
  case "$format" in
    pre-plan)
      printf '\ntasks: none declared\n'
      printf 'summary: %s — pre-plan\n' "$(basename "$dir")"
      ;;
    legacy-unsupported)
      printf '\nsummary: %s — legacy-unsupported\n' "$(basename "$dir")"
      ;;
    split)
      validate_ledger "$dir" || die "task ledger: split scaffold is invalid"
      counts=$(ledger_counts "$dir/progress.md")
      done_count=$(printf '%s' "$counts" | cut -f1)
      total=$(printf '%s' "$counts" | cut -f2)
      printf '\ntasks: %s/%s done\n' "$done_count" "$total"
      whole="not reviewed"
      if [ -f "$dir/review.md" ]; then
        printf 'reviews:\n'
        any=0
        while IFS=$'\t' read -r scope verdict; do
          [ -n "$scope" ] || continue
          any=1
          printf '  %s: %s\n' "$scope" "$verdict"
          [ "$(printf '%s' "$scope" | tr '[:upper:]' '[:lower:]')" = "whole change" ] && whole="$verdict"
        done <<EOF
$(review_verdicts "$dir/review.md")
EOF
        [ "$any" -eq 1 ] || printf '  (no review passes recorded)\n'
      else
        printf 'reviews: review.md absent\n'
      fi
      printf 'summary: %s — %s/%s tasks done, whole change: %s\n' "$(basename "$dir")" "$done_count" "$total" "$whole"
      ;;
  esac
}

cmd_all() {
  local root changes_dir dir format counts done_count total task_display whole present artifact newest epoch rows
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
        epoch=$(mtime_epoch "$dir/$artifact")
        [ "$epoch" -gt "$newest" ] && newest="$epoch"
      fi
    done
    [ -d "$dir/requirements" ] && present="$present,requirements"
    [ -n "$present" ] || present=",(none)"
    [ "$newest" -gt 0 ] || newest=$(mtime_epoch "$dir")
    format=$(format_of "$dir")
    done_count="-"
    total="-"
    task_display="-"
    whole="-"
    if [ "$format" = "split" ]; then
      if validate_ledger "$dir" 2>/dev/null; then
        counts=$(ledger_counts "$dir/progress.md")
        done_count=$(printf '%s' "$counts" | cut -f1)
        total=$(printf '%s' "$counts" | cut -f2)
        task_display="$done_count/$total"
        if [ -f "$dir/review.md" ]; then
          whole=$(review_verdicts "$dir/review.md" | awk -F'\t' 'tolower($1) == "whole change" { value = $2 } END { print (value == "" ? "-" : value) }')
        fi
      else
        format="invalid"
      fi
    fi
    rows="$rows$newest"$'\t'"$(basename "$dir")"$'\t'"$format"$'\t'"${present#,}"$'\t'"$task_display"$'\t'"$whole"$'\t'"$(fmt_date "$newest")"$'\n'
  done
  if [ -z "${rows//[$'\n\t ']/}" ]; then
    printf 'no changes under %s\n' "$changes_dir" >&2
    return 1
  fi
  {
    printf 'change\tformat\tartifacts\ttasks\twhole change\tlast modified\n'
    printf '%s' "$rows" | sort -rn | cut -f2-
  } | awk -F'\t' '{ printf "%-28s %-20s %-46s %-8s %-18s %s\n", $1, $2, $3, $4, $5, $6 }'
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
        target="$1"
        shift
        ;;
    esac
  done
  if [ -n "$target" ]; then
    [ -d "$target" ] || die "change dir does not exist: $target"
    target=$(abs_dir "$target")
  else
    target=$(discover_change_dir) || die "not inside a change directory — pass one as an argument, or use --all"
  fi
  cmd_one "$target"
}

main "$@"
