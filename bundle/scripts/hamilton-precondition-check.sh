#!/usr/bin/env bash
#
# hamilton-precondition-check.sh — run the finish-work gate in one call.
#
#   hamilton-precondition-check.sh --change-dir <dir> --test-cmd '<command>' [--whole-change-waived]
#
# Gates, one line of output each:
#   1 clean tree            git status --porcelain is empty
#   2 tests                 --test-cmd exits 0
#   3 tasks                 every non-abandoned plan task has a latest progress Outcome: done
#   4 reviews               every task scope and "whole change" latest verdict is approved,
#                           with no blocking items under an approved verdict
#   5 review freshness      the commit that last touched review.md includes the commit that
#                           last touched code — i.e. the whole-change review is not stale
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

plan_tasks() {
  strip_comments "$1" | awk '
    function normalize_atx(value) {
      if (substr(value, 1, 4) == "    ") return value
      if (substr(value, 1, 3) == "   ") return substr(value, 4)
      if (substr(value, 1, 2) == "  ") return substr(value, 3)
      if (substr(value, 1, 1) == " ") return substr(value, 2)
      return value
    }
    {
      line = normalize_atx($0)
      if (line !~ /^### Task [1-9][0-9]*:/) next
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
        if (heading ~ ("^Attempt [1-9][0-9]*" suffix "$")) {
          active = 1
          next
        }
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

  plans=$(plan_tasks "$plan")
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

# "<scope><TAB><verdict><TAB><blocking count>" per review section, in file order.
review_sections() {
  strip_comments "$1" | awk '
    function flush() {
      if (scope != "") printf "%s\t%s\t%d\n", scope, verdict, blocking
    }
    /^## / {
      flush()
      line = $0
      sub(/^## /, "", line)
      sub(/\r$/, "", line)
      idx = index(line, " \342\200\224 ")           # em dash separator from the template
      if (idx == 0) idx = index(line, " - ")
      scope = (idx > 0) ? substr(line, 1, idx - 1) : line
      gsub(/^[ \t]+|[ \t]+$/, "", scope)
      scope = tolower(scope)
      verdict = ""; blocking = 0; section = ""
      next
    }
    /^### / {
      section = tolower($0)
      sub(/^### /, "", section)
      gsub(/[ \t\r]+$/, "", section)
      next
    }
    tolower($0) ~ /^verdict:/ {
      value = $0
      sub(/^[Vv]erdict:[ \t]*/, "", value)
      gsub(/[ \t\r]+$/, "", value)
      verdict = tolower(value)
      next
    }
    section == "blocking" && /^[ \t]*-[ \t]+/ { blocking++ }
    END { flush() }
  '
}

# Sections are in file order and the newest pass is last, so the last verdict for a
# scope is the one that governs.
latest_verdict() {
  printf '%s\n' "$1" | awk -F'\t' -v s="$2" '$1 == s { v = $2 } END { print v }'
}

gate_reviews() {
  local change_dir="$1"
  local review="$change_dir/review.md" plan="$change_dir/plan.md"
  local problems=""

  [ -f "$review" ] || { fail "Reviews (no review.md in $change_dir)"; return; }

  local sections
  sections=$(review_sections "$review")
  if [ -z "$sections" ]; then
    fail "Reviews (review.md has no '## <scope> — <date>' sections)"
    return
  fi

  # Any scope that is not "Task <N>" or "whole change" is unparseable, and this
  # gate does not pass on text it cannot classify.
  local unknown
  unknown=$(printf '%s\n' "$sections" | awk -F'\t' '
    $1 !~ /^task [0-9]+$/ && $1 != "whole change" { print $1 }
  ' | sort -u | tr '\n' ' ')
  if [ -n "${unknown// /}" ]; then
    fail "Reviews (unrecognised scope(s): ${unknown% })"
    return
  fi

  # An approved verdict carrying blocking items contradicts itself, whichever
  # pass it belongs to.
  local contradictory
  contradictory=$(printf '%s\n' "$sections" | awk -F'\t' '
    $2 == "approved" && $3 > 0 { printf "%s(%d blocking) ", $1, $3 }
  ')
  if [ -n "$contradictory" ]; then
    fail "Reviews (approved with unaddressed blocking items: ${contradictory% })"
    return
  fi

  # Every non-abandoned plan task needs a reviewed scope of its own.
  if [ -f "$plan" ]; then
    local id title state verdict
    while IFS=$'\t' read -r id title state; do
      [ -n "$id" ] || continue
      [ "$state" = "abandoned" ] && continue
      verdict=$(latest_verdict "$sections" "$(printf '%s' "$id" | tr '[:upper:]' '[:lower:]')")
      if [ -z "$verdict" ]; then
        problems="$problems $id(never reviewed)"
      elif [ "$verdict" != "approved" ]; then
        problems="$problems $id(latest verdict: $verdict)"
      fi
    done <<EOF
$(plan_tasks "$plan")
EOF
  fi

  local whole
  whole=$(latest_verdict "$sections" "whole change")
  if [ -z "$whole" ]; then
    problems="$problems whole-change(never reviewed)"
  elif [ "$whole" != "approved" ]; then
    problems="$problems whole-change(latest verdict: $whole)"
  fi

  if [ -n "$problems" ]; then
    fail "Reviews ($(printf '%s' "${problems# }"))"
  else
    pass "Reviews (all task scopes and whole change approved)"
  fi
}

# ----------------------------------------------------------- gate 5: freshness

# Ancestry, not timestamps: the header dates in review.md are day-granularity and
# cannot answer "is this review newer than the code?". A review commit that contains
# the last code commit as an ancestor was necessarily made after it.
gate_review_freshness() {
  local change_dir="$1" waiver="$2"
  local root rel_review review_commit code_commit

  if [ "$waiver" = "yes" ]; then
    waived "Whole-change review freshness (waived by the user; record this in the finish entry)"
    return
  fi

  root=$(abs_dir "$(git rev-parse --show-toplevel)")
  rel_review="${change_dir#"$root"/}/review.md"

  review_commit=$(git -C "$root" log -1 --format=%H -- "$rel_review" 2>/dev/null)
  code_commit=$(git -C "$root" log -1 --format=%H -- . ':(exclude).hamilton' 2>/dev/null)

  if [ -z "$review_commit" ]; then
    fail "Whole-change review freshness (review.md has never been committed)"
    return
  fi
  if [ -z "$code_commit" ]; then
    fail "Whole-change review freshness (no commit touches anything outside .hamilton/)"
    return
  fi
  if [ "$review_commit" = "$code_commit" ]; then
    pass "Whole-change review freshness (review.md and code landed in $(git -C "$root" rev-parse --short "$code_commit"))"
    return
  fi
  if git -C "$root" merge-base --is-ancestor "$code_commit" "$review_commit"; then
    pass "Whole-change review freshness (review $(git -C "$root" rev-parse --short "$review_commit") postdates code $(git -C "$root" rev-parse --short "$code_commit"))"
  else
    fail "Whole-change review freshness (code $(git -C "$root" rev-parse --short "$code_commit") is newer than review $(git -C "$root" rev-parse --short "$review_commit") — re-review the whole change, or pass --whole-change-waived if the user waived it)"
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
