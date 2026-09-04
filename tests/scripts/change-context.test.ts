import { describe, it, expect, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { run, makeRepo, makeChangeDir, cleanupRepos, field, SCRIPTS_DIR } from "./helpers.js"

const SCRIPT = "hamilton-change-context.sh"

afterEach(cleanupRepos)

const PROPOSAL = `# Proposal: Add auth

| Field      | Value |
|------------|-------|
| Change     | 2026-08-13-add-auth |
| Route unit | .hamilton/maps/auth/route.md — unit 2 |
`

const PLAN = `# Plan: add auth

## Tasks

### Task 1: Add the auth | session

### Task 2: Wire it into the router
`

const ROOT_PROGRESS = `# Progress: add auth

| Task | Status | Progress |
|---|---|---|
| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |
| Task 2: Wire it into the router | blocked | [details](tasks/task-2/progress.md) |
`

const TASK_ONE_PROGRESS = `# Task Progress: Task 1 — Add the auth | session

## Task 1: Add the auth | session — 2026-08-13

- Outcome: blocked

## Task 1: Add the auth | session — 2026-08-14

- Outcome: done
`

const TASK_TWO_PROGRESS = `# Task Progress: Task 2 — Wire it into the router

## Task 2: Wire it into the router — 2026-08-14

- Outcome: blocked
`

const REVIEW = `# Review: add auth

## whole change — 2026-08-14

Verdict: approved
`

const LEGACY_TASK_REVIEW = `# Review: add auth

## Task 1 — 2026-08-14

Verdict: approved

## whole change — 2026-08-14

Verdict: approved
`

function seed(repo: string, slug: string, files: Record<string, string>): string {
  const dir = makeChangeDir(repo, slug)
  for (const [name, content] of Object.entries(files)) {
    const full = Path.join(dir, name)
    Fs.mkdirSync(Path.dirname(full), { recursive: true })
    Fs.writeFileSync(full, content)
  }
  return dir
}

function splitFiles(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    "proposal.md": PROPOSAL,
    "plan.md": PLAN,
    "progress.md": ROOT_PROGRESS,
    "tasks/task-1/progress.md": TASK_ONE_PROGRESS,
    "tasks/task-2/progress.md": TASK_TWO_PROGRESS,
    "review.md": REVIEW,
    "requirements/auth.md": "# Auth\n",
    ...overrides
  }
}

describe("hamilton-change-context.sh <change-dir>", () => {
  it("summarizes a validated split task ledger", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", splitFiles())

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "change")).toBe("add-auth")
    expect(field(result, "path")).toBe(dir)
    expect(field(result, "format")).toBe("split")
    expect(field(result, "route-unit")).toBe(".hamilton/maps/auth/route.md — unit 2")
    expect(result.stdout).toMatch(/proposal\.md\s+present/)
    expect(result.stdout).toMatch(/requirements\/\s+present\s+auth/)
    expect(field(result, "tasks")).toBe("1/2 done")
    expect(result.lastLine).toBe("summary: add-auth — 1/2 tasks done, whole change: approved")
  })

  it("recognizes a pre-plan directory without requiring progress scaffolding", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", { "proposal.md": PROPOSAL })

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "format")).toBe("pre-plan")
    expect(field(result, "tasks")).toBe("none declared")
    expect(result.lastLine).toBe("summary: add-auth — pre-plan")
  })

  it("labels a planned monolithic directory legacy-unsupported without inferring state", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", {
      "plan.md": PLAN,
      "progress.md": `# Progress: add auth

## Task 1: Add the auth module — 2026-08-13

- Outcome: done
`,
      "review.md": REVIEW
    })

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "format")).toBe("legacy-unsupported")
    expect(field(result, "tasks")).toBeUndefined()
    expect(result.stdout).not.toContain("whole change: approved")
    expect(result.lastLine).toBe("summary: add-auth — legacy-unsupported")
  })

  it("labels a split ledger with legacy task passes in root review legacy-unsupported", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", splitFiles({ "review.md": LEGACY_TASK_REVIEW }))

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "format")).toBe("legacy-unsupported")
    expect(field(result, "tasks")).toBeUndefined()
    expect(field(result, "reviews")).toBeUndefined()
    expect(result.stdout).not.toContain("whole change: approved")
    expect(result.lastLine).toBe("summary: add-auth — legacy-unsupported")
  })

  it("recognizes an indented legacy task pass in root review", () => {
    const repo = makeRepo()
    const review = LEGACY_TASK_REVIEW.replace("## Task 1", "   ## Task 1")
    const dir = seed(repo, "add-auth", splitFiles({ "review.md": review }))

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "format")).toBe("legacy-unsupported")
    expect(field(result, "tasks")).toBeUndefined()
    expect(field(result, "reviews")).toBeUndefined()
    expect(result.stdout).not.toContain("whole change: approved")
  })

  it("recognizes a tab-delimited legacy task pass in root review", () => {
    const repo = makeRepo()
    const review = LEGACY_TASK_REVIEW.replace("## Task 1", "##\tTask 1")
    const dir = seed(repo, "add-auth", splitFiles({ "review.md": review }))

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "format")).toBe("legacy-unsupported")
    expect(field(result, "tasks")).toBeUndefined()
    expect(field(result, "reviews")).toBeUndefined()
    expect(result.stdout).not.toContain("whole change: approved")
  })

  it("rejects a table separator with fewer than three hyphens per cell", () => {
    const repo = makeRepo()
    const progress = ROOT_PROGRESS.replace("|---|---|---|", "|-|-|-|")
    const dir = seed(repo, "add-auth", splitFiles({ "progress.md": progress }))

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "format")).toBe("legacy-unsupported")
    expect(field(result, "tasks")).toBeUndefined()
    expect(result.stdout).not.toContain("whole change: approved")
  })

  it.each([
    ["between the delimiter and first row", ROOT_PROGRESS.replace("|---|---|---|\n", "|---|---|---|\n\n")],
    ["between data rows", ROOT_PROGRESS.replace("| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |\n", "| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |\n\n")]
  ])("rejects a blank line %s", (_location, progress) => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", splitFiles({ "progress.md": progress }))

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "format")).toBe("legacy-unsupported")
    expect(field(result, "tasks")).toBeUndefined()
    expect(result.stdout).not.toContain("whole change: approved")
  })

  it.each([
    ["task", `## Task 1: Add the auth | session — 2026-08-15

- Outcome: done
`],
    ["review", `## Review: Task 1 — 2026-08-15

Verdict: approved
`],
    ["finish", `## Finish — 2026-08-15

Outcome: completed
`]
  ])("labels mixed split and root %s history legacy-unsupported", (_kind, history) => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", splitFiles({
      "progress.md": `${ROOT_PROGRESS}\n${history}`
    }))

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "format")).toBe("legacy-unsupported")
    expect(field(result, "tasks")).toBeUndefined()
    expect(result.stdout).not.toContain("whole change: approved")
    expect(result.lastLine).toBe("summary: add-auth — legacy-unsupported")
  })

  it("discards an unfilled route-unit placeholder", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", {
      "proposal.md": `# Proposal: Add auth

| Route unit | <.hamilton/maps/<effort>/route.md — unit N; omit unless map-aware> |
`
    })

    const result = run(SCRIPT, [dir], repo)

    expect(field(result, "route-unit")).toBeUndefined()
  })

  it.each([
    ["missing", { "progress.md": `# Progress: add auth\n\n| Task | Status | Progress |\n|---|---|---|\n| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |\n` }],
    ["duplicate", { "progress.md": `${ROOT_PROGRESS}| Task 2: Wire it into the router | blocked | [details](tasks/task-2/progress.md) |\n` }],
    ["extra", { "progress.md": `${ROOT_PROGRESS}| Task 3: Extra | pending | [details](tasks/task-3/progress.md) |\n` }],
    ["reordered", { "progress.md": `# Progress: add auth\n\n| Task | Status | Progress |\n|---|---|---|\n| Task 2: Wire it into the router | blocked | [details](tasks/task-2/progress.md) |\n| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |\n` }],
    ["wrong-link", { "progress.md": ROOT_PROGRESS.replace("tasks/task-2/progress.md", "tasks/task-1/progress.md") }],
    ["wrong-task", { "tasks/task-2/progress.md": TASK_TWO_PROGRESS.replace("Task 2", "Task 1") }],
    ["illegal-status", { "progress.md": ROOT_PROGRESS.replace("| blocked |", "| waiting |") }],
    ["duplicate-table", { "progress.md": `${ROOT_PROGRESS}| Task | Status | Progress |\n|---|---|---|\n` }],
    ["done-without-done-evidence", { "tasks/task-1/progress.md": TASK_ONE_PROGRESS.replace("- Outcome: done", "- Outcome: blocked") }],
    ["done-without-latest-evidence", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n## Task 1: Add the auth | session — 2026-08-15\n` }],
    ["malformed-latest-heading", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n## Task 1 — 2026-08-15\n\n- Outcome: done\n` }],
    ["wrong-level-latest-heading", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n### Task 1: Add the auth | session — 2026-08-15\n\n- Outcome: done\n` }],
    ["indented-wrong-level-latest-heading", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n   ### Task 1: Add the auth | session — 2026-08-15\n` }],
    ["empty-latest-h2", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n##\n` }],
    ["indented-empty-latest-h2", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n   ##\n` }],
    ["tab-delimited-empty-latest-h2", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n##\t\n` }],
    ["duplicate-outcomes", { "tasks/task-1/progress.md": TASK_ONE_PROGRESS.replace("- Outcome: done", "- Outcome: done\n- Outcome: done") }],
    ["missing-non-done-outcome", { "tasks/task-2/progress.md": TASK_TWO_PROGRESS.replace("- Outcome: blocked", "") }],
    ["illegal-non-done-outcome", { "tasks/task-2/progress.md": TASK_TWO_PROGRESS.replace("- Outcome: blocked", "- Outcome: waiting") }],
    ["outcome-outside-attempt", { "tasks/task-2/progress.md": `# Task Progress: Task 2 — Wire it into the router\n\n- Outcome: blocked\n` }],
    ["sibling-task-attempt", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n## Task 2: Wire it into the router — 2026-08-15\n\n- Outcome: blocked\n` }]
  ])("reports %s split-ledger drift", (_name, overrides) => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", splitFiles(overrides))

    const result = run(SCRIPT, [dir], repo)

    expect(result.status, result.stderr).toBe(2)
    expect(result.stderr).toContain("task ledger:")
    expect(field(result, "tasks")).toBeUndefined()
  })

  it("supports an all-abandoned plan with an empty task ledger", () => {
    const repo = makeRepo()
    const dir = seed(repo, "retired-change", {
      "plan.md": `# Plan: retired change

## Tasks

### Task 1: Retired work (abandoned — no longer needed)
`,
      "progress.md": `# Progress: retired change

| Task | Status | Progress |
|---|---|---|


`
    })

    const result = run(SCRIPT, [dir], repo)

    expect(result.status, result.stderr).toBe(0)
    expect(field(result, "format")).toBe("split")
    expect(field(result, "tasks")).toBe("0/0 done")
    expect(result.lastLine).toBe("summary: retired-change — 0/0 tasks done, whole change: not reviewed")
  })

  it("discovers a split change from a subdirectory", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", splitFiles())

    const result = run(SCRIPT, [], Path.join(dir, "requirements"))

    expect(result.status).toBe(0)
    expect(field(result, "change")).toBe("add-auth")
  })

  it("errors when it is not inside a change directory", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, [], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("not inside a change directory")
  })

  it("errors on a change dir that does not exist", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, [Path.join(repo, "nope")], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("change dir does not exist")
  })

  it("avoids Bash 4 line-collection builtins", () => {
    const source = Fs.readFileSync(Path.join(SCRIPTS_DIR, SCRIPT), "utf8")

    expect(source).not.toMatch(/\b(?:mapfile|readarray)\b/)
  })
})

describe("hamilton-change-context.sh --all", () => {
  it("lists split, pre-plan, and legacy changes in reverse modification order", () => {
    const repo = makeRepo()
    const legacy = seed(repo, "legacy-change", { "plan.md": PLAN, "progress.md": "# Progress\n" })
    const split = seed(repo, "split-change", splitFiles())
    const prePlan = seed(repo, "pre-plan-change", { "proposal.md": PROPOSAL })
    const stamp = new Date("2026-01-02T12:00:00Z")
    Fs.utimesSync(Path.join(legacy, "plan.md"), stamp, stamp)
    Fs.utimesSync(Path.join(legacy, "progress.md"), stamp, stamp)
    for (const name of ["proposal.md", "plan.md", "progress.md", "review.md"]) {
      Fs.utimesSync(Path.join(split, name), stamp, stamp)
    }
    Fs.utimesSync(Path.join(prePlan, "proposal.md"), new Date("2026-01-03T12:00:00Z"), new Date("2026-01-03T12:00:00Z"))

    const result = run(SCRIPT, ["--all"], repo)

    expect(result.status).toBe(0)
    expect(result.lines[0]).toMatch(/^change\s+format\s+artifacts\s+tasks\s+whole change\s+last modified/)
    expect(result.lines[1]).toContain("pre-plan-change")
    expect(result.lines[1]).toContain("pre-plan")
    expect(result.lines[2]).toContain("split-change")
    expect(result.lines[2]).toContain("split")
    expect(result.lines[2]).toContain("1/2")
    expect(result.lines[3]).toContain("legacy-change")
    expect(result.lines[3]).toContain("legacy-unsupported")
    expect(result.lines[3]).toMatch(/\s-\s+-\s+2026-01-02$/)
  })

  it.each([
    ["task", `## Task 1: Add the auth | session — 2026-08-15

- Outcome: done
`],
    ["review", `## Review: Task 1 — 2026-08-15

Verdict: approved
`],
    ["finish", `## Finish — 2026-08-15

Outcome: completed
`]
  ])("lists mixed root %s history as legacy-unsupported and continues", (_kind, history) => {
    const repo = makeRepo()
    seed(repo, "mixed-change", splitFiles({
      "progress.md": `${ROOT_PROGRESS}\n${history}`
    }))
    seed(repo, "split-change", splitFiles())

    const result = run(SCRIPT, ["--all"], repo)
    const mixed = result.lines.find((line) => line.startsWith("mixed-change"))
    const split = result.lines.find((line) => line.startsWith("split-change"))

    expect(result.status).toBe(0)
    expect(mixed).toContain("legacy-unsupported")
    expect(mixed).not.toContain("1/2")
    expect(split).toContain("split")
    expect(split).toContain("1/2")
  })

  it("lists legacy task passes in root review as unsupported and continues", () => {
    const repo = makeRepo()
    seed(repo, "legacy-review-change", splitFiles({ "review.md": LEGACY_TASK_REVIEW }))
    seed(repo, "split-change", splitFiles())

    const result = run(SCRIPT, ["--all"], repo)
    const legacy = result.lines.find((line) => line.startsWith("legacy-review-change"))
    const split = result.lines.find((line) => line.startsWith("split-change"))

    expect(result.status).toBe(0)
    expect(legacy).toMatch(/^legacy-review-change\s+legacy-unsupported\s/)
    expect(legacy).not.toContain("1/2")
    expect(legacy).not.toContain("approved")
    expect(split).toContain("split")
    expect(split).toContain("1/2")
  })

  it("lists an indented root task review as unsupported and continues", () => {
    const repo = makeRepo()
    const review = LEGACY_TASK_REVIEW.replace("## Task 1", "   ## Task 1")
    seed(repo, "legacy-review-change", splitFiles({ "review.md": review }))
    seed(repo, "split-change", splitFiles())

    const result = run(SCRIPT, ["--all"], repo)
    const legacy = result.lines.find((line) => line.startsWith("legacy-review-change"))
    const split = result.lines.find((line) => line.startsWith("split-change"))

    expect(result.status).toBe(0)
    expect(legacy).toMatch(/^legacy-review-change\s+legacy-unsupported\s/)
    expect(legacy).not.toContain("1/2")
    expect(legacy).not.toContain("approved")
    expect(split).toMatch(/^split-change\s+split\s/)
  })

  it("lists a tab-delimited root task review as unsupported and continues", () => {
    const repo = makeRepo()
    const review = LEGACY_TASK_REVIEW.replace("## Task 1", "##\tTask 1")
    seed(repo, "legacy-review-change", splitFiles({ "review.md": review }))
    seed(repo, "split-change", splitFiles())

    const result = run(SCRIPT, ["--all"], repo)
    const legacy = result.lines.find((line) => line.startsWith("legacy-review-change"))
    const split = result.lines.find((line) => line.startsWith("split-change"))

    expect(result.status).toBe(0)
    expect(legacy).toMatch(/^legacy-review-change\s+legacy-unsupported\s/)
    expect(legacy).not.toContain("1/2")
    expect(legacy).not.toContain("approved")
    expect(split).toMatch(/^split-change\s+split\s/)
  })

  it("lists a short table separator as unsupported and continues", () => {
    const repo = makeRepo()
    const progress = ROOT_PROGRESS.replace("|---|---|---|", "|-|-|-|")
    seed(repo, "short-separator-change", splitFiles({ "progress.md": progress }))
    seed(repo, "split-change", splitFiles())

    const result = run(SCRIPT, ["--all"], repo)
    const legacy = result.lines.find((line) => line.startsWith("short-separator-change"))
    const split = result.lines.find((line) => line.startsWith("split-change"))

    expect(result.status).toBe(0)
    expect(legacy).toMatch(/^short-separator-change\s+legacy-unsupported\s/)
    expect(legacy).not.toContain("1/2")
    expect(legacy).not.toContain("approved")
    expect(split).toMatch(/^split-change\s+split\s/)
  })

  it.each([
    ["delimiter", ROOT_PROGRESS.replace("|---|---|---|\n", "|---|---|---|\n\n")],
    ["row", ROOT_PROGRESS.replace("| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |\n", "| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |\n\n")]
  ])("lists rows after a blank following the %s as unsupported and continues", (_location, progress) => {
    const repo = makeRepo()
    seed(repo, "blank-table-change", splitFiles({ "progress.md": progress }))
    seed(repo, "split-change", splitFiles())

    const result = run(SCRIPT, ["--all"], repo)
    const legacy = result.lines.find((line) => line.startsWith("blank-table-change"))
    const split = result.lines.find((line) => line.startsWith("split-change"))

    expect(result.status).toBe(0)
    expect(legacy).toMatch(/^blank-table-change\s+legacy-unsupported\s/)
    expect(legacy).not.toContain("1/2")
    expect(legacy).not.toContain("approved")
    expect(split).toMatch(/^split-change\s+split\s/)
  })

  it.each([
    ["duplicate-table", { "progress.md": `${ROOT_PROGRESS}| Task | Status | Progress |\n|---|---|---|\n` }],
    ["malformed-latest-heading", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n## Task 1 — 2026-08-15\n\n- Outcome: done\n` }],
    ["wrong-level-latest-heading", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n### Task 1: Add the auth | session — 2026-08-15\n\n- Outcome: done\n` }],
    ["indented-wrong-level-latest-heading", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n   ### Task 1: Add the auth | session — 2026-08-15\n` }],
    ["empty-latest-h2", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n##\n` }],
    ["indented-empty-latest-h2", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n   ##\n` }],
    ["tab-delimited-empty-latest-h2", { "tasks/task-1/progress.md": `${TASK_ONE_PROGRESS}\n##\t\n` }],
    ["duplicate-outcomes", { "tasks/task-1/progress.md": TASK_ONE_PROGRESS.replace("- Outcome: done", "- Outcome: done\n- Outcome: done") }],
    ["missing-non-done-outcome", { "tasks/task-2/progress.md": TASK_TWO_PROGRESS.replace("- Outcome: blocked", "") }],
    ["illegal-non-done-outcome", { "tasks/task-2/progress.md": TASK_TWO_PROGRESS.replace("- Outcome: blocked", "- Outcome: waiting") }],
    ["outcome-outside-attempt", { "tasks/task-2/progress.md": `# Task Progress: Task 2 — Wire it into the router\n\n- Outcome: blocked\n` }]
  ])("marks %s structural drift invalid and continues", (_kind, overrides) => {
    const repo = makeRepo()
    seed(repo, "invalid-change", splitFiles(overrides))
    seed(repo, "split-change", splitFiles())

    const result = run(SCRIPT, ["--all"], repo)
    const invalid = result.lines.find((line) => line.startsWith("invalid-change"))
    const split = result.lines.find((line) => line.startsWith("split-change"))

    expect(result.status).toBe(0)
    expect(invalid).toMatch(/^invalid-change\s+invalid\s/)
    expect(invalid).not.toContain("1/2")
    expect(invalid).not.toContain("approved")
    expect(split).toMatch(/^split-change\s+split\s/)
    expect(split).toContain("1/2")
  })

  it("exits 1 when there is no changes directory", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["--all"], repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("no .hamilton/changes/")
  })

  it("exits 1 when the changes directory is empty", () => {
    const repo = makeRepo()
    Fs.mkdirSync(Path.join(repo, ".hamilton", "changes"), { recursive: true })

    const result = run(SCRIPT, ["--all"], repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("no changes under")
  })

  it("takes no other arguments with --all", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", splitFiles())

    const result = run(SCRIPT, ["--all", dir], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("takes no other arguments")
  })
})
