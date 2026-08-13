import { describe, it, expect, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { run, makeRepo, makeChangeDir, cleanupRepos, field } from "./helpers.js"

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

### Task 1: Add the auth module

### Task 2: Wire it into the router
`

const PROGRESS = `# Progress: add auth

## Task 1: Add the auth module — 2026-08-13

- Outcome: done
`

const REVIEW = `# Review: add auth

## Task 1 — 2026-08-13

Verdict: changes-requested

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

describe("hamilton-change-context.sh <change-dir>", () => {
  it("inventories the artifacts, tasks, and review verdicts", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", {
      "proposal.md": PROPOSAL,
      "plan.md": PLAN,
      "progress.md": PROGRESS,
      "review.md": REVIEW,
      "requirements/auth.md": "# Auth\n"
    })

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "change")).toBe("add-auth")
    expect(field(result, "path")).toBe(dir)
    expect(field(result, "route-unit")).toBe(".hamilton/maps/auth/route.md — unit 2")
    expect(result.stdout).toMatch(/proposal\.md\s+present/)
    expect(result.stdout).toMatch(/design\.md\s+absent/)
    expect(result.stdout).toMatch(/requirements\/\s+present\s+auth/)
    expect(field(result, "tasks")).toBe("1/2 done")
    expect(result.lastLine).toBe("summary: add-auth — 1/2 tasks done, whole change: approved")
  })

  it("reports the latest verdict per scope", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", { "review.md": REVIEW })

    const result = run(SCRIPT, [dir], repo)

    // Task 1 was reviewed twice; the second pass governs.
    expect(result.stdout).toContain("  Task 1: approved")
    expect(result.stdout).toContain("  whole change: approved")
  })

  it("counts abandoned tasks separately", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", {
      "plan.md": `# Plan: add auth

### Task 1: Add the auth module

### Task 2: Add the audit log (abandoned — folded into Task 1)
`,
      "progress.md": PROGRESS
    })

    const result = run(SCRIPT, [dir], repo)

    expect(field(result, "tasks")).toBe("1/1 done (1 abandoned)")
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

  it("reports an empty change without pretending it has tasks or reviews", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", { "proposal.md": PROPOSAL })

    const result = run(SCRIPT, [dir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "tasks")).toBe("none declared")
    expect(field(result, "reviews")).toBe("review.md absent")
    expect(result.lastLine).toBe("summary: add-auth — 0/0 tasks done, whole change: not reviewed")
  })

  it("discovers the change from a subdirectory of it", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", { "plan.md": PLAN, "requirements/auth.md": "# Auth\n" })

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
})

describe("hamilton-change-context.sh --all", () => {
  it("lists every change, most recently touched first", () => {
    const repo = makeRepo()
    const older = seed(repo, "older-change", { "plan.md": PLAN, "progress.md": PROGRESS })
    seed(repo, "newer-change", { "plan.md": PLAN })

    // Midday UTC so the local-time rendering lands on the same date either side of the meridian.
    const stamp = new Date("2026-01-02T12:00:00Z")
    Fs.utimesSync(Path.join(older, "plan.md"), stamp, stamp)
    Fs.utimesSync(Path.join(older, "progress.md"), stamp, stamp)

    const result = run(SCRIPT, ["--all"], repo)

    expect(result.status).toBe(0)
    expect(result.lines[0]).toMatch(/^change\s+artifacts\s+tasks\s+whole change\s+last modified/)
    expect(result.lines[1]).toContain("newer-change")
    expect(result.lines[2]).toContain("older-change")
    expect(result.lines[2]).toContain("1/2")
    expect(result.lines[2]).toContain("2026-01-02")
  })

  it("shows a dash for a change with no whole-change verdict", () => {
    const repo = makeRepo()
    seed(repo, "add-auth", { "plan.md": PLAN })

    const result = run(SCRIPT, ["--all"], repo)

    expect(result.lines[1]).toMatch(/add-auth\s+plan\s+0\/2\s+-\s/)
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

  it("takes no other arguments", () => {
    const repo = makeRepo()
    const dir = seed(repo, "add-auth", { "plan.md": PLAN })

    const result = run(SCRIPT, ["--all", dir], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("takes no other arguments")
  })
})
