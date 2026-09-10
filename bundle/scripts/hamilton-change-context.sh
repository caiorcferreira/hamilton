#!/usr/bin/env bash

set -uo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P) || exit 2
. "$SCRIPT_DIR/hamilton-artifact-contracts.sh" || exit 2

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
  strip_comments "$1" | sed -n '/^ \{0,3\}#/ { s/^ \{0,3\}#\{1,\} *//; p; q; }'
}

TABLE_SEPARATOR_RE='^[ \t]*[|][ \t]*---+[ \t]*[|][ \t]*---+[ \t]*[|][ \t]*---+[ \t]*[|][ \t]*$'

root_rows() {
  strip_comments "$1" | awk -v table_separator_re="$TABLE_SEPARATOR_RE" '
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
    found && $0 ~ /^[ \t]*$/ {
      found = 0
      table_ended = 1
      if (separator) invalid = 1
      next
    }
    table_ended && $0 ~ /^[ \t]*\|/ {
      invalid = 1
      exit
    }
    found && separator {
      if ($0 !~ table_separator_re) {
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
  strip_comments "$1" | awk -v table_separator_re="$TABLE_SEPARATOR_RE" '
    function normalize_atx(value) {
      if (substr(value, 1, 4) == "    ") return value
      if (substr(value, 1, 3) == "   ") return substr(value, 4)
      if (substr(value, 1, 2) == "  ") return substr(value, 3)
      if (substr(value, 1, 1) == " ") return substr(value, 2)
      return value
    }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ /^[ \t]*$/) {
        if (table) table_ended = 1
        next
      }
      if (table_ended) {
        invalid = 1
        next
      }
      if (!heading) {
        if (normalize_atx(line) ~ /^# Progress:/) heading = 1
        else invalid = 1
        next
      }
      if (!table) {
        if (line == "| Task | Status | Progress |") table = 1
        else invalid = 1
        next
      }
      if (!separator) {
        if (line ~ table_separator_re) separator = 1
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
    BEGIN { expected_attempt = 1 }
    function normalize_atx(value) {
      if (substr(value, 1, 4) == "    ") return value
      if (substr(value, 1, 3) == "   ") return substr(value, 4)
      if (substr(value, 1, 2) == "  ") return substr(value, 3)
      if (substr(value, 1, 1) == " ") return substr(value, 2)
      return value
    }
    function atx_level(value,    count, character) {
      count = 0
      while (substr(value, count + 1, 1) == "#") count++
      if (count < 1 || count > 6) return 0
      character = substr(value, count + 1, 1)
      if (character != "" && character != " " && character != "\t") return 0
      return count
    }
    function close_attempt() {
      if (active && outcome_count != 1) invalid = 1
      active = 0
      outcome_count = 0
    }
    {
      line = normalize_atx($0)
      level = atx_level(line)
      if (level == 1) {
        if (title_seen || active || attempt_seen) {
          close_attempt()
          latest = ""
          invalid = 1
        }
        heading = line
        sub(/^#[ \t]*/, "", heading)
        sub(/\r$/, "", heading)
        if (heading != "Task Progress: " task " — " title) invalid = 1
        title_seen = 1
        next
      }
      if (level == 2) {
        close_attempt()
        latest = ""
        attempt_seen = 1
        if (!title_seen) {
          invalid = 1
          next
        }
        heading = line
        sub(/^##[ \t]*/, "", heading)
        sub(/\r$/, "", heading)
        suffix = " — [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"
        if (heading !~ ("^Attempt [1-9][0-9]*" suffix "$")) {
          invalid = 1
          next
        }
        attempt = heading
        sub(/^Attempt /, "", attempt)
        sub(suffix "$", "", attempt)
        if (attempt + 0 != expected_attempt) invalid = 1
        expected_attempt++
        active = 1
        next
      }
      if (level > 0) {
        close_attempt()
        latest = ""
        invalid = 1
        next
      }
      if ($0 ~ /^[ \t]*-?[ \t]*Outcome:/) {
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
    }
    END {
      close_attempt()
      if (!title_seen) invalid = 1
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

  plans=$(hamilton_plan_tasks "$plan") || return 1
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
  strip_comments "$1" | grep -Eq '^ {0,3}##[[:blank:]]+Task [1-9][0-9]*([ :]|$)'
}

format_of() {
  local dir="$1" plans id title state
  [ -f "$dir/plan.md" ] || { printf 'pre-plan\n'; return; }
  plans=$(hamilton_plan_tasks "$dir/plan.md") || { printf 'invalid\n'; return 2; }
  [ -f "$dir/progress.md" ] && has_only_root_ledger_shape "$dir/progress.md" || { printf 'legacy-unsupported\n'; return; }
  [ ! -f "$dir/review.md" ] || ! has_task_review_pass "$dir/review.md" || { printf 'legacy-unsupported\n'; return; }
  while IFS=$'\t' read -r id title state; do
    [ "$state" = "active" ] || continue
    [ -f "$dir/tasks/task-${id#Task }/progress.md" ] || { printf 'legacy-unsupported\n'; return; }
  done <<EOF
$plans
EOF
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

repo_root_for() {
  local dir="$1"
  git -C "$dir" rev-parse --show-toplevel 2>/dev/null
}

relative_to_root() {
  local root="$1" path="$2"
  case "$path" in
    "$root"/*) printf '%s\n' "${path#"$root"/}" ;;
    *) return 1 ;;
  esac
}

full_commit() {
  local root="$1" commit="$2"
  [[ "$commit" =~ ^[0-9a-f]{40}$|^[0-9a-f]{64}$ ]] || return 1
  git -C "$root" cat-file -e "$commit^{commit}" 2>/dev/null
}

review_standing() {
  local root="$1" base="$2" head="$3" required="$4"
  full_commit "$root" "$base" && full_commit "$root" "$head" || { printf 'malformed\n'; return; }
  git -C "$root" merge-base --is-ancestor "$base" "$head" 2>/dev/null || { printf 'malformed\n'; return; }
  git -C "$root" merge-base --is-ancestor "$head" HEAD 2>/dev/null || { printf 'stale\n'; return; }
  [ -n "$required" ] || { printf 'stale\n'; return; }
  git -C "$root" merge-base --is-ancestor "$required" "$head" 2>/dev/null || { printf 'stale\n'; return; }
  printf 'fresh\n'
}

latest_task_commit() {
  local root="$1" path="$2"
  git -C "$root" log -1 --format=%H HEAD -- "$path"
}

latest_material_commit() {
  local root="$1" change_path="$2"
  local plan="$root/$change_path/plan.md" plans id title state
  local -a exclusions=(
    ":(exclude)$change_path/progress.md"
    ":(exclude)$change_path/review.md"
    ":(exclude)$change_path/finish.md"
  )
  if [ -f "$plan" ]; then
    plans=$(hamilton_plan_tasks "$plan") || return 1
    while IFS=$'\t' read -r id title state; do
      [ -n "$id" ] || continue
      [ "$state" = "active" ] || continue
      exclusions+=(
        ":(exclude)$change_path/tasks/task-${id#Task }/progress.md"
        ":(exclude)$change_path/tasks/task-${id#Task }/feedback.md"
      )
    done <<EOF
$plans
EOF
  fi
  git -C "$root" log -1 --format=%H HEAD -- . "${exclusions[@]}"
}

durable_task_feedback() {
  local root="$1" path="$2" file="$3" head_blob worktree_blob commit changed
  head_blob=$(git -C "$root" rev-parse "HEAD:$path" 2>/dev/null) || return 1
  worktree_blob=$(git -C "$root" hash-object -- "$file" 2>/dev/null) || return 1
  [ "$worktree_blob" = "$head_blob" ] || return 1
  git -C "$root" diff --cached --quiet HEAD -- "$path" || return 1
  commit=$(git -C "$root" log -1 --format=%H HEAD -- "$path")
  [ -n "$commit" ] || return 1
  changed=$(git -C "$root" diff-tree --root --no-commit-id --name-only -r "$commit") || return 1
  [ "$changed" = "$path" ]
}

task_feedback_state() {
  local root="$1" change_path="$2" file="$3" task="$4" title="$5" parsed verdict base head blocking implementation standing
  [ -s "$file" ] || { printf 'absent\n'; return; }
  durable_task_feedback "$root" "$change_path/tasks/task-${task#Task }/feedback.md" "$file" || { printf 'uncommitted\n'; return; }
  parsed=$(hamilton_latest_verdict_pass "$file" "Code Feedback: $task — $title") || { printf 'malformed\n'; return; }
  IFS=$'\t' read -r verdict base head blocking <<<"$parsed"
  implementation=$(latest_task_commit "$root" "$change_path/tasks/task-${task#Task }/progress.md")
  standing=$(review_standing "$root" "$base" "$head" "$implementation")
  [ "$standing" != "malformed" ] || { printf 'malformed\n'; return; }
  printf '%s (%s)\n' "$verdict" "$standing"
}

whole_review_state() {
  local root="$1" change_path="$2" file="$3" plan_title parsed verdict base head blocking material standing
  [ -s "$file" ] || { printf 'not reviewed\n'; return; }
  plan_title=$(hamilton_plan_title "$root/$change_path/plan.md") || { printf 'malformed\n'; return; }
  parsed=$(hamilton_latest_verdict_pass "$file" "Whole-branch Review: $plan_title") || { printf 'malformed\n'; return; }
  IFS=$'\t' read -r verdict base head blocking <<<"$parsed"
  material=$(latest_material_commit "$root" "$change_path")
  standing=$(review_standing "$root" "$base" "$head" "$material")
  [ "$standing" != "malformed" ] || { printf 'malformed\n'; return; }
  printf '%s (%s)\n' "$verdict" "$standing"
}

ARTIFACTS="proposal.md design.md plan.md progress.md review.md finish.md critique.md"

cmd_one() {
  local dir="$1" format artifact lines header route caps counts done_count total whole root change_path plans rows_text index row id title state actual_task status link feedback
  format=$(format_of "$dir") || die "task ledger: plan task declarations are invalid"
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
      root=$(repo_root_for "$dir") || die "change dir is not inside a git repository"
      change_path=$(relative_to_root "$root" "$dir") || die "change dir is outside its git repository"
      plans=$(hamilton_plan_tasks "$dir/plan.md") || die "task ledger: plan task declarations are invalid"
      rows_text=$(root_rows "$dir/progress.md")
      printf 'task state:\n'
      index=0
      while IFS=$'\t' read -r id title state; do
        [ -n "$id" ] || continue
        [ "$state" = "active" ] || continue
        index=$((index + 1))
        row=$(printf '%s\n' "$rows_text" | sed -n "${index}p")
        IFS=$'\t' read -r actual_task status link <<<"$row"
        feedback=$(task_feedback_state "$root" "$change_path" "$dir/tasks/task-${id#Task }/feedback.md" "$id" "$title")
        printf '  %s: %s, feedback: %s\n' "$id" "$status" "$feedback"
      done <<EOF
$plans
EOF
      whole=$(whole_review_state "$root" "$change_path" "$dir/review.md")
      printf 'reviews:\n'
      printf '  whole change: %s\n' "$whole"
      printf 'summary: %s — %s/%s tasks done, whole change: %s\n' "$(basename "$dir")" "$done_count" "$total" "$whole"
      ;;
  esac
}

cmd_all() {
  local root changes_dir dir format counts done_count total task_display whole present artifact newest epoch rows change_path
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
    format=$(format_of "$dir") || format="invalid"
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
        change_path=$(relative_to_root "$root" "$dir")
        whole=$(whole_review_state "$root" "$change_path" "$dir/review.md")
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
