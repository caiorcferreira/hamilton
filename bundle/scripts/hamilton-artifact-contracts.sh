#!/usr/bin/env bash

hamilton_plan_tasks() {
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
          if (!marker) {
            remaining = ""
          } else {
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
      if (line !~ /^### Task [1-9][0-9]*:[ \t]+[^ \t]/) next
      number = line
      sub(/^### Task /, "", number)
      sub(/:.*/, "", number)
      id = "Task " number
      if (seen[id]) {
        printf "error: plan contains duplicate %s declarations\n", id > "/dev/stderr"
        invalid = 1
        next
      }
      seen[id] = 1
      title = line
      sub(/^### Task [1-9][0-9]*:[ \t]*/, "", title)
      sub(/[ \t]+$/, "", title)
      state = (title ~ / \(abandoned — [^)]*[^)[:space:]][^)]*\)$/) ? "abandoned" : "active"
      count++
      ids[count] = id
      titles[count] = title
      states[count] = state
    }
    END {
      if (invalid) exit 2
      for (item = 1; item <= count; item++) {
        printf "%s\t%s\t%s\n", ids[item], titles[item], states[item]
      }
    }
  ' "$1"
}

hamilton_resolve_active_task() {
  local plan="$1" task="$2" plans match id title state
  case "$task" in
    ""|*[!0-9]*|0|0*) return 2 ;;
  esac
  plans=$(hamilton_plan_tasks "$plan") || return 2
  match=$(printf '%s\n' "$plans" | awk -F '\t' -v expected="Task $task" '$1 == expected { print; found = 1 } END { exit !found }') || return 1
  IFS=$'\t' read -r id title state <<EOF
$match
EOF
  [ "$state" = "active" ] || return 3
  printf '%s\n' "$title"
}

hamilton_plan_title() {
  awk '
    {
      remaining = $0
      visible = ""
      while (length(remaining) > 0) {
        if (in_comment) {
          marker = index(remaining, "-->")
          if (!marker) {
            remaining = ""
          } else {
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
      sub(/\r$/, "", visible)
      if (visible !~ /^#[ \t]/) next
      headings++
      if (visible !~ /^# Plan: [^ \t]/ || visible ~ /[ \t]$/ || visible ~ /[ \t]#+$/) {
        invalid = 1
        next
      }
      title = visible
      sub(/^# Plan: /, "", title)
    }
    END {
      if (in_comment || invalid || headings != 1 || title == "") exit 1
      print title
    }
  ' "$1"
}

hamilton_latest_verdict_pass() {
  local file="$1" expected_heading="$2"
  awk -v expected_heading="$expected_heading" '
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
    function reset_pass() {
      base = ""
      head = ""
      verdict = ""
      metadata = 0
      section = ""
      blocking = 0
      blocking_none = 0
      suggestions = 0
      suggestions_none = 0
      pass_active = 1
    }
    function close_pass() {
      if (!pass_active) return
      if (metadata != 3 || section != "suggestions") invalid = 1
      if (blocking + blocking_none < 1 || suggestions + suggestions_none < 1) invalid = 1
      if (blocking_none && (blocking != 0 || blocking_none != 1)) invalid = 1
      if (suggestions_none && (suggestions != 0 || suggestions_none != 1)) invalid = 1
      if (verdict == "approved" && (blocking != 0 || blocking_none != 1)) invalid = 1
      if (verdict == "changes-requested" && (blocking < 1 || blocking_none != 0)) invalid = 1
      latest_verdict = verdict
      latest_base = base
      latest_head = head
      latest_blocking = blocking
      pass_active = 0
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
      raw = visible
      sub(/\r$/, "", raw)
      line = normalize_atx(raw)
      level = atx_level(line)
      if (level == 1) {
        if (heading_seen || pass_active || pass_seen) invalid = 1
        heading = line
        sub(/^#[ \t]*/, "", heading)
        if (heading != expected_heading) invalid = 1
        heading_seen = 1
        next
      }
      if (level == 2) {
        close_pass()
        heading = line
        sub(/^##[ \t]*/, "", heading)
        if (heading !~ /^Pass [1-9][0-9]* \342\200\224 [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/) invalid = 1
        number = heading
        sub(/^Pass /, "", number)
        sub(/ \342\200\224.*/, "", number)
        if (number + 0 != expected_pass) invalid = 1
        expected_pass++
        if (!heading_seen) invalid = 1
        pass_seen = 1
        reset_pass()
        next
      }
      if (level == 3) {
        if (!pass_active) {
          invalid = 1
          next
        }
        heading = line
        sub(/^###[ \t]*/, "", heading)
        if (heading == "Blocking" && metadata == 3 && section == "") section = "blocking"
        else if (heading == "Suggestions" && section == "blocking" && blocking + blocking_none > 0) section = "suggestions"
        else invalid = 1
        next
      }
      if (level > 0) {
        invalid = 1
        next
      }
      if (raw ~ /^[ \t]*$/) next
      if (!heading_seen || !pass_active) {
        invalid = 1
        next
      }
      if (section == "") {
        if (metadata == 0 && raw ~ /^Base:[ \t]*[^ \t]/) {
          base = raw
          sub(/^Base:[ \t]*/, "", base)
          sub(/[ \t]+$/, "", base)
          metadata = 1
        } else if (metadata == 1 && raw ~ /^Head:[ \t]*[^ \t]/) {
          head = raw
          sub(/^Head:[ \t]*/, "", head)
          sub(/[ \t]+$/, "", head)
          metadata = 2
        } else if (metadata == 2 && raw ~ /^Verdict:[ \t]*(approved|changes-requested)[ \t]*$/) {
          verdict = raw
          sub(/^Verdict:[ \t]*/, "", verdict)
          sub(/[ \t]+$/, "", verdict)
          metadata = 3
        } else invalid = 1
        next
      }
      if (raw !~ /^- [^ \t]/) {
        invalid = 1
        next
      }
      value = substr(raw, 3)
      marker = value
      gsub(/[[:space:][:punct:]]/, "", marker)
      marker = tolower(marker)
      if (marker == "none" && value != "None.") {
        invalid = 1
        next
      }
      if (section == "blocking") {
        if (value == "None.") blocking_none++
        else blocking++
      } else if (section == "suggestions") {
        if (value == "None.") suggestions_none++
        else suggestions++
      } else invalid = 1
    }
    BEGIN { expected_pass = 1 }
    END {
      close_pass()
      if (in_comment || !heading_seen || !pass_seen || invalid) exit 1
      printf "%s\t%s\t%s\t%d\n", latest_verdict, latest_base, latest_head, latest_blocking
    }
  ' "$file"
}
