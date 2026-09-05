#!/usr/bin/env bash
#
# hamilton-precondition-check.sh — run the finish-work gate in one call.
#
#   hamilton-precondition-check.sh --change-dir <dir> --test-cmd '<command>' [--whole-change-waived]
#
# This script fails closed. Anything it cannot parse is a FAIL, never a PASS: a false
# pass would launder an unreviewed change through the gate. It never infers the
# whole-change waiver either — gate 5 is waived only when --whole-change-waived is
# passed, which is the user's explicit decision to make, and the [WAIVED] line is
# printed so the finish entry can record it.
#
# --test-cmd is required. The project's test command lives in AGENTS.md and the plan;
# guessing it here would be one more thing to get quietly wrong.
#
# Exit: 0 all gates pass, 1 one or more gates fail, 2 usage or environment error.

set -uo pipefail

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P) || exit 2
. "$SCRIPT_DIR/hamilton-artifact-contracts.sh" || exit 2

usage() {
  cat <<'EOF'
usage:
  hamilton-precondition-check.sh --change-dir <dir> --test-cmd '<command>' [--whole-change-waived]

exit: 0 all gates pass, 1 a gate failed, 2 usage or environment error
EOF
}

die() {
  printf 'error: %s\n' "$1" >&2
  exit 2
}

abs_dir() {
  (cd "$1" 2>/dev/null && pwd -P)
}

FAILURES=0

pass() { printf '[PASS] %s\n' "$1"; }
fail() { printf '[FAIL] %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
waived() { printf '[WAIVED] %s\n' "$1"; }

# Artifact bodies carry instructional HTML comments that mention the very headers
# and verdict values parsed below. Strip them before reading anything.
strip_comments() {
  awk '
    /<!--/ { in_comment = 1 }
    !in_comment { print }
    /-->/ { in_comment = 0 }
  ' "$1"
}

# ---------------------------------------------------------------- gate 1: tree

gate_clean_tree() {
  local dirty
  dirty=$(git status --porcelain 2>/dev/null)
  if [ -z "$dirty" ]; then
    pass "Clean tree"
    return
  fi
  fail "Clean tree ($(printf '%s\n' "$dirty" | wc -l | tr -d ' ') uncommitted path(s))"
  printf '%s\n' "$dirty" | sed 's/^/       /'
}

# --------------------------------------------------------------- gate 2: tests

gate_tests() {
  local cmd="$1" out status
  out=$(mktemp "${TMPDIR:-/tmp}/hamilton-precheck-XXXXXX") || die "cannot create a scratch file"
  bash -c "$cmd" >"$out" 2>&1
  status=$?
  if [ "$status" -eq 0 ]; then
    pass "Tests ($cmd)"
  else
    fail "Tests ($cmd exited $status)"
    tail -n 15 "$out" | sed 's/^/       /'
  fi
  rm -f "$out"
}

# --------------------------------------------------------------- gate 3: tasks

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

task_progress_state() {
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
        if (heading != "Task Progress: " task " \342\200\224 " title) wrong_heading = 1
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
        suffix = " \342\200\224 [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]"
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
      if (!title_seen) wrong_heading = 1
      if (wrong_heading) print "wrong-heading"
      else if (invalid) print "invalid"
      else print latest
    }
  '
}

gate_tasks() {
  local change_dir="$1"
  local plan="$change_dir/plan.md" progress="$change_dir/progress.md"
  local plans rows_text expected_text="" first_active="" total=0 done_count=0 abandoned=0
  local id title state expected_task actual_task status link count index row expected_link task_file evidence suffix=""

  [ -f "$plan" ] || { fail "Tasks (no plan.md in $change_dir)"; return; }
  [ -f "$progress" ] || { fail "Tasks (no progress.md in $change_dir)"; return; }

  plans=$(hamilton_plan_tasks "$plan") || { fail "Tasks (plan has invalid or duplicate task declarations)"; return; }
  while IFS=$'\t' read -r id title state; do
    [ -n "$id" ] || continue
    if [ "$state" = "abandoned" ]; then
      abandoned=$((abandoned + 1))
      continue
    fi
    [ -n "$first_active" ] || first_active="$id"
    total=$((total + 1))
    expected_task="$id: $(escape_table_title "$title")"
    expected_text="${expected_text}${expected_text:+$'\n'}$id"$'\t'"$expected_task"
  done <<EOF
$plans
EOF

  [ "$total" -gt 0 ] || [ "$abandoned" -gt 0 ] || { fail "Tasks (plan.md declares no recognizable tasks)"; return; }
  has_only_root_ledger_shape "$progress" || { fail "Tasks ($first_active: legacy progress layout is unsupported)"; return; }
  rows_text=$(root_rows "$progress") || { fail "Tasks ($first_active: invalid root task ledger)"; return; }

  while IFS=$'\t' read -r id expected_task; do
    [ -n "$id" ] || continue
    count=$(printf '%s\n' "$rows_text" | awk -F'\t' -v task="$expected_task" '$1 == task { count++ } END { print count + 0 }')
    [ "$count" -gt 0 ] || { fail "Tasks ($id: missing root ledger row)"; return; }
    [ "$count" -eq 1 ] || { fail "Tasks ($id: duplicate root ledger row)"; return; }
  done <<EOF
$expected_text
EOF

  while IFS=$'\t' read -r actual_task status link; do
    [ -n "$actual_task" ] || continue
    id=$(printf '%s\n' "$expected_text" | awk -F'\t' -v task="$actual_task" '$2 == task { print $1 }')
    [ -n "$id" ] || { fail "Tasks (${actual_task%%:*}: extra root ledger row)"; return; }
  done <<EOF
$rows_text
EOF

  index=0
  while IFS=$'\t' read -r id expected_task; do
    [ -n "$id" ] || continue
    index=$((index + 1))
    row=$(printf '%s\n' "$rows_text" | sed -n "${index}p")
    IFS=$'\t' read -r actual_task status link <<<"$row"
    [ "$actual_task" = "$expected_task" ] || { fail "Tasks ($id: root ledger row is out of plan order)"; return; }
    case "$status" in
      pending|in-progress|blocked|done) ;;
      *) fail "Tasks ($id: invalid status: $status)"; return ;;
    esac
    expected_link="[details](tasks/task-${id#Task }/progress.md)"
    [ "$link" = "$expected_link" ] || { fail "Tasks ($id: wrong link; expected $expected_link)"; return; }
    task_file="$change_dir/tasks/task-${id#Task }/progress.md"
    [ -f "$task_file" ] || { fail "Tasks ($id: progress file is missing)"; return; }
    title=$(printf '%s\n' "$plans" | awk -F'\t' -v task="$id" '$1 == task { print $2; exit }')
    evidence=$(task_progress_state "$task_file" "$id" "$title")
    [ "$evidence" != "wrong-heading" ] || { fail "Tasks ($id: wrong task heading in progress file)"; return; }
    [ "$evidence" != "invalid" ] || { fail "Tasks ($id: invalid task attempt evidence; latest Outcome: done evidence is required)"; return; }
    [ "$status" = "done" ] || { fail "Tasks ($id status: $status)"; return; }
    [ "$evidence" = "done" ] || { fail "Tasks ($id: done row lacks latest Outcome: done evidence)"; return; }
    done_count=$((done_count + 1))
  done <<EOF
$expected_text
EOF

  [ "$abandoned" -gt 0 ] && suffix=", $abandoned abandoned"
  pass "Tasks ($done_count/$total implemented$suffix)"
}

# ------------------------------------------------------------- gate 4: reviews

whole_review_pass() {
  local file="$1" heading
  heading=$(strip_comments "$file" | awk '
    /^#[ \t]+Whole-branch Review:[ \t]+[^ \t]/ {
      line = $0
      sub(/^#[ \t]+/, "", line)
      sub(/\r$/, "", line)
      print line
      exit
    }
  ')
  [ -n "$heading" ] || return 1
  hamilton_latest_verdict_pass "$file" "$heading"
}

full_commit() {
  local root="$1" commit="$2"
  [[ "$commit" =~ ^[0-9a-f]{40}$|^[0-9a-f]{64}$ ]] || return 1
  git -C "$root" cat-file -e "$commit^{commit}" 2>/dev/null
}

review_range_standing() {
  local root="$1" base="$2" head="$3" required="$4"
  if ! full_commit "$root" "$base" || ! full_commit "$root" "$head"; then
    printf 'malformed\n'
    return
  fi
  git -C "$root" merge-base --is-ancestor "$base" "$head" 2>/dev/null || { printf 'malformed\n'; return; }
  git -C "$root" merge-base --is-ancestor "$head" HEAD 2>/dev/null || { printf 'off-branch\n'; return; }
  if [ -n "$required" ] && ! git -C "$root" merge-base --is-ancestor "$required" "$head" 2>/dev/null; then
    printf 'stale\n'
    return
  fi
  printf 'fresh\n'
}

latest_task_commit() {
  local root="$1" path="$2"
  git -C "$root" log -1 --format=%H HEAD -- "$path" 2>/dev/null
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
  git -C "$root" log -1 --format=%H HEAD -- . "${exclusions[@]}" 2>/dev/null
}

gate_reviews() {
  local change_dir="$1"
  local review="$change_dir/review.md" plan="$change_dir/plan.md"
  local root change_path problems=""
  local plans id title state feedback parsed verdict base head blocking implementation standing

  [ -f "$review" ] || { fail "Reviews (no review.md in $change_dir)"; return; }

  root=$(git -C "$change_dir" rev-parse --show-toplevel 2>/dev/null) || { fail "Reviews (change directory is not in a git repository)"; return; }
  case "$change_dir" in
    "$root"/*) change_path="${change_dir#"$root"/}" ;;
    *) fail "Reviews (change directory is outside the repository)"; return ;;
  esac

  if [ -f "$plan" ]; then
    plans=$(hamilton_plan_tasks "$plan") || { problems="${problems}${problems:+; }plan(task declarations malformed)"; plans=""; }
    while IFS=$'\t' read -r id title state; do
      [ -n "$id" ] || continue
      [ "$state" = "abandoned" ] && continue
      feedback="$change_dir/tasks/task-${id#Task }/feedback.md"
      if [ ! -s "$feedback" ]; then
        problems="${problems}${problems:+; }$id(feedback missing)"
        continue
      fi
      parsed=$(hamilton_latest_verdict_pass "$feedback" "Code Feedback: $id — $title") || {
        problems="${problems}${problems:+; }$id(feedback malformed)"
        continue
      }
      IFS=$'\t' read -r verdict base head blocking <<<"$parsed"
      if [ "$verdict" != "approved" ]; then
        problems="${problems}${problems:+; }$id(latest verdict: $verdict)"
        continue
      fi
      implementation=$(latest_task_commit "$root" "$change_path/tasks/task-${id#Task }/progress.md")
      if [ -z "$implementation" ]; then
        problems="${problems}${problems:+; }$id(feedback is stale)"
        continue
      fi
      standing=$(review_range_standing "$root" "$base" "$head" "$implementation")
      case "$standing" in
        malformed) problems="${problems}${problems:+; }$id(review range is malformed)" ;;
        off-branch) problems="${problems}${problems:+; }$id(review head is not on current branch)" ;;
        stale) problems="${problems}${problems:+; }$id(feedback is stale)" ;;
        fresh) ;;
        *) problems="${problems}${problems:+; }$id(review range cannot be verified)" ;;
      esac
    done <<EOF
$plans
EOF
  fi

  parsed=$(whole_review_pass "$review") || {
    problems="${problems}${problems:+; }whole-branch(review malformed)"
    parsed=""
  }
  if [ -n "$parsed" ]; then
    IFS=$'\t' read -r verdict base head blocking <<<"$parsed"
    if [ "$verdict" != "approved" ]; then
      problems="${problems}${problems:+; }whole-branch(latest verdict: $verdict)"
    else
      standing=$(review_range_standing "$root" "$base" "$head" "")
      case "$standing" in
        malformed) problems="${problems}${problems:+; }whole-branch(review range is malformed)" ;;
        off-branch) problems="${problems}${problems:+; }whole-branch(review head is not on current branch)" ;;
        fresh) ;;
        *) problems="${problems}${problems:+; }whole-branch(review range cannot be verified)" ;;
      esac
    fi
  fi

  if [ -n "$problems" ]; then
    fail "Reviews ($problems)"
  else
    pass "Reviews (all task feedback and whole-branch verdicts approved and current)"
  fi
}

# ----------------------------------------------------------- gate 5: freshness

gate_review_freshness() {
  local change_dir="$1" waiver="$2"
  local review="$change_dir/review.md" root change_path parsed verdict base head blocking standing material

  [ -s "$review" ] || { fail "Whole-branch review freshness (review.md is missing)"; return; }
  root=$(git -C "$change_dir" rev-parse --show-toplevel 2>/dev/null) || { fail "Whole-branch review freshness (change directory is not in a git repository)"; return; }
  case "$change_dir" in
    "$root"/*) change_path="${change_dir#"$root"/}" ;;
    *) fail "Whole-branch review freshness (change directory is outside the repository)"; return ;;
  esac
  parsed=$(whole_review_pass "$review") || { fail "Whole-branch review freshness (review malformed)"; return; }
  IFS=$'\t' read -r verdict base head blocking <<<"$parsed"
  standing=$(review_range_standing "$root" "$base" "$head" "")
  case "$standing" in
    malformed) fail "Whole-branch review freshness (review range is malformed)"; return ;;
    off-branch) fail "Whole-branch review freshness (review head is not on current branch)"; return ;;
    fresh) ;;
    *) fail "Whole-branch review freshness (review range cannot be verified)"; return ;;
  esac
  material=$(latest_material_commit "$root" "$change_path")
  [ -n "$material" ] || { fail "Whole-branch review freshness (no material commit exists on the current branch)"; return; }
  if [ "$waiver" = "yes" ]; then
    waived "Whole-branch review freshness (material ancestry waived by the user; record this in the finish entry)"
    return
  fi
  if git -C "$root" merge-base --is-ancestor "$material" "$head" 2>/dev/null; then
    pass "Whole-branch review freshness (review head $(git -C "$root" rev-parse --short "$head") contains material $(git -C "$root" rev-parse --short "$material"))"
  else
    fail "Whole-branch review freshness (review head $(git -C "$root" rev-parse --short "$head") does not contain material $(git -C "$root" rev-parse --short "$material") — re-review the whole change, or pass --whole-change-waived if the user waived it)"
  fi
}

# ----------------------------------------------------------------------- main

main() {
  local change_dir="" test_cmd="" waiver="no"

  [ $# -gt 0 ] || { usage >&2; exit 2; }

  while [ $# -gt 0 ]; do
    case "$1" in
      -h|--help) usage; exit 0 ;;
      --change-dir)
        [ $# -ge 2 ] || die "--change-dir requires a value"
        change_dir="$2"; shift 2 ;;
      --test-cmd)
        [ $# -ge 2 ] || die "--test-cmd requires a value"
        test_cmd="$2"; shift 2 ;;
      --whole-change-waived) waiver="yes"; shift ;;
      *) die "unknown argument: $1" ;;
    esac
  done

  [ -n "$change_dir" ] || die "--change-dir is required"
  [ -n "$test_cmd" ] || die "--test-cmd is required (take it from AGENTS.md or plan.md; this script will not guess)"
  [ -d "$change_dir" ] || die "change dir does not exist: $change_dir"
  git rev-parse --show-toplevel >/dev/null 2>&1 || die "not inside a git repository"

  change_dir=$(abs_dir "$change_dir")

  gate_clean_tree
  gate_tests "$test_cmd"
  gate_tasks "$change_dir"
  gate_reviews "$change_dir"
  gate_review_freshness "$change_dir" "$waiver"

  if [ "$FAILURES" -eq 0 ]; then
    printf 'gate: open\n'
    return 0
  fi
  printf 'gate: closed (%d failing)\n' "$FAILURES"
  return 1
}

main "$@"
