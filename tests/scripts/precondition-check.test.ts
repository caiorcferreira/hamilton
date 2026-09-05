import { describe, it, expect, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { run, git, makeRepo, makeChangeDir, cleanupRepos, write, commitAll, commitPaths } from "./helpers.js"

const SCRIPT = "hamilton-precondition-check.sh"
const CHANGE_PATH = ".hamilton/changes/add-auth"

afterEach(cleanupRepos)

const PLAN = `# Plan: add auth

## Tasks

### Task 1: Add the auth | session

### Task 2: Wire it into the router
`

const PROGRESS = `# Progress: add auth

| Task | Status | Progress |
|---|---|---|
| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |
| Task 2: Wire it into the router | done | [details](tasks/task-2/progress.md) |
`

const TASK_ONE_PROGRESS = `# Task Progress: Task 1 — Add the auth | session

## Attempt 1 — 2026-08-13

- Outcome: blocked

## Attempt 2 — 2026-08-14

- Outcome: done
`

const TASK_TWO_PROGRESS = `# Task Progress: Task 2 — Wire it into the router

## Attempt 1 — 2026-08-14

- Outcome: done
`

function pass(number: number, base: string, head: string, verdict = "approved", blocking = "- None.", suggestions = "- None."): string {
  return `## Pass ${number} — 2026-08-14

Base: ${base}
Head: ${head}
Verdict: ${verdict}

### Blocking

${blocking}

### Suggestions

${suggestions}
`
}

function feedback(task: number, title: string, base: string, head: string, verdict = "approved", blocking = "- None.", suggestions = "- None."): string {
  return `# Code Feedback: Task ${task} — ${title}

${pass(1, base, head, verdict, blocking, suggestions)}`
}

function review(base: string, head: string, verdict = "approved", blocking = "- None.", suggestions = "- None."): string {
  return `# Whole-branch Review: add auth

${pass(1, base, head, verdict, blocking, suggestions)}`
}

interface Artifacts {
  plan?: string
  progress?: string
  taskOneProgress?: string | null
  taskTwoProgress?: string | null
  taskOneFeedback?: string | null
  taskTwoFeedback?: string | null
  review?: string | null
}

function taskIsActive(plan: string, task: number): boolean {
  const line = plan.split("\n").find((candidate) => candidate.startsWith(`### Task ${task}:`))
  return line !== undefined && !/ \(abandoned — [^)]+\)$/.test(line)
}

function taskTitle(plan: string, task: number): string {
  const prefix = `### Task ${task}: `
  return plan.split("\n").find((candidate) => candidate.startsWith(prefix))?.slice(prefix.length) ?? ""
}

function seedChange(repo: string, artifacts: Artifacts = {}): string {
  const dir = makeChangeDir(repo, "add-auth")
  const base = git(repo, "rev-parse", "HEAD")
  const plan = artifacts.plan ?? PLAN
  Fs.writeFileSync(Path.join(dir, "plan.md"), plan)
  Fs.writeFileSync(Path.join(dir, "progress.md"), artifacts.progress ?? PROGRESS)
  const taskOneProgress = artifacts.taskOneProgress === undefined ? TASK_ONE_PROGRESS : artifacts.taskOneProgress
  const taskTwoProgress = artifacts.taskTwoProgress === undefined ? TASK_TWO_PROGRESS : artifacts.taskTwoProgress
  if (taskOneProgress !== null) write(repo, `${CHANGE_PATH}/tasks/task-1/progress.md`, taskOneProgress)
  if (taskTwoProgress !== null) write(repo, `${CHANGE_PATH}/tasks/task-2/progress.md`, taskTwoProgress)
  const firstPaths = [`${CHANGE_PATH}/plan.md`, `${CHANGE_PATH}/progress.md`]
  if (taskOneProgress !== null) firstPaths.push(`${CHANGE_PATH}/tasks/task-1/progress.md`)
  const taskOneHead = commitPaths(repo, "implement task one", ...firstPaths)
  const taskTwoHead = taskTwoProgress === null
    ? taskOneHead
    : commitPaths(repo, "implement task two", `${CHANGE_PATH}/tasks/task-2/progress.md`)
  const taskOneFeedback = artifacts.taskOneFeedback === undefined
    ? taskIsActive(plan, 1) ? feedback(1, taskTitle(plan, 1), base, taskOneHead) : null
    : artifacts.taskOneFeedback
  const taskTwoFeedback = artifacts.taskTwoFeedback === undefined
    ? taskIsActive(plan, 2) ? feedback(2, taskTitle(plan, 2), base, taskTwoHead) : null
    : artifacts.taskTwoFeedback
  const wholeReview = artifacts.review === undefined ? review(base, taskTwoHead) : artifacts.review
  if (taskOneFeedback !== null) {
    write(repo, `${CHANGE_PATH}/tasks/task-1/feedback.md`, taskOneFeedback)
    commitPaths(repo, "record task one feedback", `${CHANGE_PATH}/tasks/task-1/feedback.md`)
  }
  if (taskTwoFeedback !== null) {
    write(repo, `${CHANGE_PATH}/tasks/task-2/feedback.md`, taskTwoFeedback)
    commitPaths(repo, "record task two feedback", `${CHANGE_PATH}/tasks/task-2/feedback.md`)
  }
  if (wholeReview !== null) {
    write(repo, `${CHANGE_PATH}/review.md`, wholeReview)
    commitPaths(repo, "record whole-branch review", `${CHANGE_PATH}/review.md`)
  }
  return dir
}

function check(repo: string, dir: string, ...extra: string[]) {
  return run(SCRIPT, ["--change-dir", dir, "--test-cmd", "true", ...extra], repo)
}

function initialCommit(repo: string): string {
  return git(repo, "rev-list", "--max-parents=0", "HEAD")
}

function taskCommit(repo: string, task: number): string {
  return git(repo, "log", "-1", "--format=%H", "HEAD", "--", `${CHANGE_PATH}/tasks/task-${task}/progress.md`)
}

function record(repo: string, path: string, content: string, message: string): string {
  write(repo, path, content)
  return commitPaths(repo, message, path)
}

describe("hamilton-precondition-check.sh", () => {
  it("opens the gate when every precondition holds", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Clean tree")
    expect(result.stdout).toContain("[PASS] Tasks (2/2 implemented)")
    expect(result.stdout).toContain("[PASS] Reviews (all task feedback and whole-branch verdicts approved and current)")
    expect(result.stdout).not.toContain("[FAIL]")
    expect(result.lastLine).toBe("gate: open")
  })

  it("requires --test-cmd rather than guessing one", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["--change-dir", repo], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("will not guess")
  })

  it("requires a change dir that exists", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["--change-dir", Path.join(repo, "nope"), "--test-cmd", "true"], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("change dir does not exist")
  })
})

describe("hamilton-precondition-check.sh gate 1 — clean tree", () => {
  it("fails a dirty tree and names the paths", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    write(repo, "stray.ts", "// never committed\n")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Clean tree (1 uncommitted path(s))")
    expect(result.stdout).toContain("?? stray.ts")
    expect(result.lastLine).toBe("gate: closed (1 failing)")
  })
})

describe("hamilton-precondition-check.sh gate 2 — tests", () => {
  it("fails on a non-zero exit and shows the tail of the output", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)

    const result = run(
      SCRIPT,
      ["--change-dir", dir, "--test-cmd", "echo 'boom: 2 failed'; exit 3"],
      repo
    )

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("exited 3")
    expect(result.stdout).toContain("boom: 2 failed")
  })
})

describe("hamilton-precondition-check.sh gate 3 — tasks", () => {
  it("rejects duplicate task declarations", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, { plan: `${PLAN}\n### Task 1: Duplicate auth\n` })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).toContain("duplicate Task 1")
  })

  it("ignores task headings inside HTML comments", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, { plan: `${PLAN}\n<!-- ### Task 1: Hidden duplicate -->\n` })

    const result = check(repo, dir)

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain("[PASS] Tasks (2/2 implemented)")
  })

  it("keeps malformed abandonment syntax active", () => {
    const repo = makeRepo()
    const title = "Wire it into the router (abandoned - not canonical)"
    const dir = seedChange(repo, {
      plan: PLAN.replace("Wire it into the router", title),
      progress: PROGRESS.replace("Wire it into the router", title),
      taskTwoProgress: TASK_TWO_PROGRESS.replace("Wire it into the router", title)
    })

    const result = check(repo, dir)

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toContain("[PASS] Tasks (2/2 implemented)")
  })

  it("fails when an active task row is missing", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      progress: PROGRESS.replace("| Task 2: Wire it into the router | done | [details](tasks/task-2/progress.md) |\n", "")
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Tasks")
    expect(result.stdout).toContain("Task 2")
    expect(result.stdout).toContain("missing")
  })

  it("fails when an active task row is duplicated", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      progress: `${PROGRESS}| Task 2: Wire it into the router | done | [details](tasks/task-2/progress.md) |\n`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 2")
    expect(result.stdout).toContain("duplicate")
  })

  it("fails when the root ledger has an extra task row", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      progress: `${PROGRESS}| Task 3: Extra work | done | [details](tasks/task-3/progress.md) |\n`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 3")
    expect(result.stdout).toContain("extra")
  })

  it("fails when active task rows are reordered", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      progress: `# Progress: add auth

| Task | Status | Progress |
|---|---|---|
| Task 2: Wire it into the router | done | [details](tasks/task-2/progress.md) |
| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("order")
  })

  it("fails when a task status is outside the four allowed values", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, { progress: PROGRESS.replace("| done |", "| waiting |") })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("invalid status: waiting")
  })

  it("fails when a task link does not exactly target its progress file", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      progress: PROGRESS.replace("tasks/task-2/progress.md", "tasks/task-1/progress.md")
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 2")
    expect(result.stdout).toContain("wrong link")
  })

  it("fails when a linked task progress file is missing", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, { taskTwoProgress: null })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 2")
    expect(result.stdout).toContain("progress file is missing")
  })

  it("fails when a linked task progress heading declares another task", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      taskTwoProgress: TASK_TWO_PROGRESS.replace(
        "# Task Progress: Task 2 — Wire it into the router",
        "# Task Progress: Task 1 — Add the auth | session"
      )
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 2")
    expect(result.stdout).toContain("wrong task heading")
  })

  it.each(["pending", "in-progress", "blocked"])("fails when Task 2 is %s", (status) => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      progress: PROGRESS.replace(
        "| Task 2: Wire it into the router | done |",
        `| Task 2: Wire it into the router | ${status} |`
      ),
      taskTwoProgress: TASK_TWO_PROGRESS.replace("- Outcome: done", "- Outcome: blocked")
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 2")
    expect(result.stdout).toContain(`status: ${status}`)
  })

  it("fails when a done row lacks latest done evidence", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      taskTwoProgress: `${TASK_TWO_PROGRESS}
## Attempt 2 — 2026-08-15

- Outcome: blocked
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 2")
    expect(result.stdout).toContain("latest Outcome: done evidence")
  })

  it("skips abandoned plan tasks while retaining their history", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      plan: `# Plan: add auth

## Tasks

### Task 1: Add the auth | session

### Task 2: Wire it into the router (abandoned — folded into Task 1)
`,
      progress: PROGRESS.replace("| Task 2: Wire it into the router | done | [details](tasks/task-2/progress.md) |\n", ""),
      taskTwoProgress: TASK_TWO_PROGRESS.replace("- Outcome: done", "- Outcome: blocked")
    })

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Tasks (1/1 implemented, 1 abandoned)")
    expect(Fs.readFileSync(Path.join(dir, "tasks/task-2/progress.md"), "utf8")).toContain("Outcome: blocked")
  })

  it("passes an empty ledger when every plan task is abandoned", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      plan: `# Plan: add auth

## Tasks

### Task 1: Add the auth | session (abandoned — no longer needed)

### Task 2: Wire it into the router (abandoned — no longer needed)
`,
      progress: `# Progress: add auth

| Task | Status | Progress |
|---|---|---|
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Clean tree")
    expect(result.stdout).toContain("[PASS] Tests (true)")
    expect(result.stdout).toContain("[PASS] Tasks (0/0 implemented, 2 abandoned)")
    expect(result.stdout).toContain("[PASS] Reviews (all task feedback and whole-branch verdicts approved and current)")
    expect(result.lastLine).toBe("gate: open")
  })

  it("fails an empty ledger when the plan declares no recognizable tasks", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      plan: `# Plan: add auth

## Tasks

No tasks were declared.
`,
      progress: `# Progress: add auth

| Task | Status | Progress |
|---|---|---|
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Tasks (plan.md declares no recognizable tasks)")
    expect(result.lastLine).toBe("gate: closed (1 failing)")
  })

  it("fails a planned legacy progress layout instead of interpreting it", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      progress: `# Progress: add auth

## Task 1: Add the auth | session — 2026-08-14

- Outcome: done

## Task 2: Wire it into the router — 2026-08-14

- Outcome: done
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("legacy progress layout is unsupported")
  })

  it.each([
    ["task-titled", TASK_ONE_PROGRESS.replace("## Attempt 2", "## Task 1: Add the auth | session")],
    ["skipped", TASK_ONE_PROGRESS.replace("## Attempt 2", "## Attempt 3")],
    ["duplicated", TASK_ONE_PROGRESS.replace("## Attempt 2", "## Attempt 1")],
    ["out-of-order", TASK_ONE_PROGRESS.replace("## Attempt 1", "## Attempt 2").replace("## Attempt 2 — 2026-08-14", "## Attempt 1 — 2026-08-14")]
  ])("fails %s task attempt headings", (_kind, taskOneProgress) => {
    const repo = makeRepo()
    const dir = seedChange(repo, { taskOneProgress })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1: invalid task attempt evidence")
  })
})

describe("hamilton-precondition-check.sh gate 4 — reviews", () => {
  it("fails when a task's latest verdict regressed to changes-requested", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    const head = taskCommit(repo, 1)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      `${feedback(1, "Add the auth | session", base, head)}\n${pass(2, base, head, "changes-requested", "- [src/auth.ts:1] Fix the auth flow.")}`,
      "request task one changes"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("latest verdict: changes-requested")
  })

  it("fails an approved verdict that still carries blocking items", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    const head = taskCommit(repo, 1)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      feedback(1, "Add the auth | session", base, head, "approved", "- [src/auth.ts:12] The token is never validated."),
      "record contradictory task feedback"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("approved with 1 blocking")
  })

  it("fails approved feedback with an unresolved cannot verify from diff item", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    const head = taskCommit(repo, 1)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      feedback(1, "Add the auth | session", base, head, "approved", "- None.", "- [src/router.ts:1] Cannot verify from diff whether routing is safe."),
      "record unresolved task feedback"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("cannot verify from diff")
  })

  it("fails feedback whose declared task differs from its owner directory", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      feedback(2, "Wire it into the router", initialCommit(repo), taskCommit(repo, 1)),
      "record feedback under the wrong task"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("feedback malformed")
  })

  it("fails when task feedback is missing", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, { taskOneFeedback: null })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("feedback missing")
  })

  it("fails when a task feedback file has no physical pass", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      "# Code Feedback: Task 1 — Add the auth | session\n",
      "erase task feedback passes"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("feedback malformed")
  })

  it("does not fall back past the physically last malformed task feedback pass", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    const head = taskCommit(repo, 1)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      `${feedback(1, "Add the auth | session", base, head)}
## Pass 2 — 2026-08-15

Base: ${base}
Verdict: approved
`,
      "append malformed task feedback"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("feedback malformed")
  })

  it("fails unknown metadata in the physically last task feedback pass", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    const head = taskCommit(repo, 1)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      feedback(1, "Add the auth | session", base, head).replace("\n### Blocking", "\nConfidence: high\n\n### Blocking"),
      "record unknown task feedback metadata"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("feedback malformed")
  })

  it.each(["Blocking", "Suggestions"])("fails an empty %s section in task feedback", (section) => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const content = feedback(1, "Add the auth | session", initialCommit(repo), taskCommit(repo, 1))
      .replace(`### ${section}\n\n- None.`, `### ${section}\n`)
    record(repo, `${CHANGE_PATH}/tasks/task-1/feedback.md`, content, "record empty task feedback section")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1(feedback malformed)")
    expect(result.lastLine).toContain("gate: closed")
  })

  it.each(["Blocking", "Suggestions"])("rejects None mixed with findings in task feedback %s", (section) => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const content = feedback(1, "Add the auth | session", initialCommit(repo), taskCommit(repo, 1))
      .replace(`### ${section}\n\n- None.`, `### ${section}\n\n- None.\n- [src/auth.ts:1] Finding.`)
    record(repo, `${CHANGE_PATH}/tasks/task-1/feedback.md`, content, "record mixed task feedback section")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1(feedback malformed)")
    expect(result.lastLine).toContain("gate: closed")
  })

  it.each([
    ["Blocking", "missing-period None", "- None"],
    ["Blocking", "lowercase None", "- none."],
    ["Blocking", "uppercase None", "- NONE."],
    ["Blocking", "contentless bullet", "- "],
    ["Suggestions", "missing-period None", "- None"],
    ["Suggestions", "lowercase None", "- none."],
    ["Suggestions", "uppercase None", "- NONE."],
    ["Suggestions", "contentless bullet", "- "]
  ])("rejects a %s %s marker", (section, _label, entry) => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const content = feedback(1, "Add the auth | session", initialCommit(repo), taskCommit(repo, 1))
      .replace(`### ${section}\n\n- None.`, `### ${section}\n\n${entry}`)
    record(repo, `${CHANGE_PATH}/tasks/task-1/feedback.md`, content, "record invalid empty marker")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1(feedback malformed)")
    expect(result.lastLine).toContain("gate: closed")
  })

  it("fails an inverted task feedback range", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      feedback(1, "Add the auth | session", taskCommit(repo, 1), initialCommit(repo)),
      "record inverted task range"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("range is malformed")
  })

  it("fails task feedback that predates the latest task progress commit", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    Fs.appendFileSync(Path.join(dir, "tasks/task-1/progress.md"), `
## Attempt 3 — 2026-08-15

- Outcome: done
`)
    commitPaths(repo, "update task one", `${CHANGE_PATH}/tasks/task-1/progress.md`)

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1")
    expect(result.stdout).toContain("feedback is stale")
  })

  it("keeps task feedback fresh across a later sibling task commit", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    Fs.appendFileSync(Path.join(dir, "tasks/task-2/progress.md"), `
## Attempt 2 — 2026-08-15

- Outcome: done
`)
    const head = commitPaths(repo, "update task two", `${CHANGE_PATH}/tasks/task-2/progress.md`)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-2/feedback.md`,
      feedback(2, "Wire it into the router", base, head),
      "refresh task two feedback"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Reviews")
    expect(result.lastLine).toBe("gate: open")
  })

  it("fails a changes-requested whole-branch verdict", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    record(
      repo,
      `${CHANGE_PATH}/review.md`,
      review(initialCommit(repo), taskCommit(repo, 2), "changes-requested", "- [src/auth.ts:1] Fix the composed flow."),
      "request whole-branch changes"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("whole-branch")
    expect(result.stdout).toContain("latest verdict: changes-requested")
  })

  it("fails a contradictory whole-branch approval", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    record(
      repo,
      `${CHANGE_PATH}/review.md`,
      review(initialCommit(repo), taskCommit(repo, 2), "approved", "- [src/auth.ts:1] The composed flow is broken."),
      "record contradictory whole-branch review"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("whole-branch")
    expect(result.stdout).toContain("approved with 1 blocking")
  })

  it("does not fall back past the physically last malformed whole-branch pass", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    const head = taskCommit(repo, 2)
    record(
      repo,
      `${CHANGE_PATH}/review.md`,
      `${review(base, head)}
## Pass 2 — 2026-08-15

Base: ${base}
Verdict: approved
`,
      "append malformed whole-branch review"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("whole-branch")
    expect(result.stdout).toContain("review malformed")
  })

  it.each(["Blocking", "Suggestions"])("fails an empty %s section in whole-branch review", (section) => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const content = review(initialCommit(repo), taskCommit(repo, 2))
      .replace(`### ${section}\n\n- None.`, `### ${section}\n`)
    record(repo, `${CHANGE_PATH}/review.md`, content, "record empty whole-branch review section")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("whole-branch(review malformed)")
    expect(result.lastLine).toContain("gate: closed")
  })

  it.each(["Blocking", "Suggestions"])("rejects None mixed with findings in whole-branch %s", (section) => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const content = review(initialCommit(repo), taskCommit(repo, 2))
      .replace(`### ${section}\n\n- None.`, `### ${section}\n\n- None.\n- [src/auth.ts:1] Finding.`)
    record(repo, `${CHANGE_PATH}/review.md`, content, "record mixed whole-branch review section")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("whole-branch(review malformed)")
    expect(result.lastLine).toContain("gate: closed")
  })

  it("fails when review.md is missing", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, { review: null })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Reviews (no review.md in")
    expect(result.stdout).toContain("[FAIL] Whole-branch review freshness")
    expect(result.lastLine).toBe("gate: closed (2 failing)")
  })
})

describe("hamilton-precondition-check.sh gate 5 — review freshness", () => {
  it("passes when the latest whole-branch range contains the latest material commit", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Whole-branch review freshness")
    expect(result.stdout).toContain("contains material")
  })

  it.each([
    ".hamilton/changes/add-auth/proposal.md",
    ".hamilton/changes/add-auth/requirements/auth.md",
    ".hamilton/specs/auth.md",
    ".hamilton/maps/auth/route.md",
    "src/auth.ts",
    "tests/auth.test.ts",
    "skills/auth/SKILL.md",
    ".hamilton/changes/another-change/progress.md"
  ])("fails after a material change to %s", (path) => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    write(repo, path, "material change\n")
    commitAll(repo, "make material change")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Whole-branch review freshness")
    expect(result.stdout).toContain("does not contain material")
  })

  it("treats noncanonical task-like feedback paths as material", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    write(repo, `${CHANGE_PATH}/tasks/task-not-a-task/feedback.md`, "# Not task feedback\n")
    commitAll(repo, "record noncanonical task-like feedback")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Whole-branch review freshness")
    expect(result.stdout).toContain("does not contain material")
  })

  it.each([
    ".hamilton/changes/add-auth/progress.md",
    ".hamilton/changes/add-auth/tasks/task-1/feedback.md",
    ".hamilton/changes/add-auth/review.md",
    ".hamilton/changes/add-auth/finish.md"
  ])("stays fresh after bookkeeping changes to %s", (path) => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const full = Path.join(repo, path)
    const content = Fs.existsSync(full) ? Fs.readFileSync(full, "utf8") : "# Finish History: add auth\n"
    record(repo, path, `${content}\n`, "record bookkeeping")

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Whole-branch review freshness")
  })

  it("stays fresh after task progress bookkeeping once that task feedback is refreshed", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    Fs.appendFileSync(Path.join(dir, "tasks/task-1/progress.md"), `
## Attempt 3 — 2026-08-15

- Outcome: done
`)
    const head = commitPaths(repo, "record task bookkeeping", `${CHANGE_PATH}/tasks/task-1/progress.md`)
    record(
      repo,
      `${CHANGE_PATH}/tasks/task-1/feedback.md`,
      feedback(1, "Add the auth | session", base, head),
      "refresh task one feedback"
    )

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Whole-branch review freshness")
  })

  it("waives only the final material ancestry comparison when explicitly told to", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    write(repo, "src/auth.ts", "export const auth = true\n")
    commitAll(repo, "make a later material change")

    const result = check(repo, dir, "--whole-change-waived")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[WAIVED] Whole-branch review freshness")
    expect(result.stdout).toContain("record this in the finish entry")
    expect(result.lastLine).toBe("gate: open")
  })

  it("does not waive malformed whole-branch range metadata", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    const head = taskCommit(repo, 2).slice(0, 12)
    record(repo, `${CHANGE_PATH}/review.md`, review(base, head), "record malformed review range")

    const result = check(repo, dir, "--whole-change-waived")

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("range is malformed")
    expect(result.stdout).not.toContain("[WAIVED] Whole-branch review freshness")
  })

  it("does not waive a whole-branch head outside the current branch", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const base = initialCommit(repo)
    git(repo, "checkout", "-q", "-b", "side-review", base)
    write(repo, "side.ts", "export const side = true\n")
    const sideHead = commitAll(repo, "create unreachable review head")
    git(repo, "checkout", "-q", "main")
    record(repo, `${CHANGE_PATH}/review.md`, review(base, sideHead), "record off-branch review range")

    const result = check(repo, dir, "--whole-change-waived")

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("not on current branch")
    expect(result.stdout).not.toContain("[WAIVED] Whole-branch review freshness")
  })

  it("does not waive stale task feedback", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    Fs.appendFileSync(Path.join(dir, "tasks/task-1/progress.md"), `
## Attempt 3 — 2026-08-15

- Outcome: done
`)
    commitPaths(repo, "update task one", `${CHANGE_PATH}/tasks/task-1/progress.md`)

    const result = check(repo, dir, "--whole-change-waived")

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("feedback is stale")
  })

  it("does not waive an unapproved verdict", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    record(
      repo,
      `${CHANGE_PATH}/review.md`,
      review(initialCommit(repo), taskCommit(repo, 2), "changes-requested", "- [src/auth.ts:1] Fix the flow."),
      "request whole-branch changes"
    )

    const result = check(repo, dir, "--whole-change-waived")

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("latest verdict: changes-requested")
  })

  it("does not waive incomplete ledger state", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    record(
      repo,
      `${CHANGE_PATH}/progress.md`,
      PROGRESS.replace("| Task 1: Add the auth \\| session | done |", "| Task 1: Add the auth \\| session | pending |"),
      "return task one to pending"
    )

    const result = check(repo, dir, "--whole-change-waived")

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1 status: pending")
  })

  it("does not waive a dirty tree", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    write(repo, "stray.ts", "export const stray = true\n")

    const result = check(repo, dir, "--whole-change-waived")

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Clean tree")
  })

  it("does not waive configured verification", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)

    const result = run(
      SCRIPT,
      ["--change-dir", dir, "--test-cmd", "echo verification-failed; exit 9", "--whole-change-waived"],
      repo
    )

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Tests")
    expect(result.stdout).toContain("verification-failed")
  })
})
