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
