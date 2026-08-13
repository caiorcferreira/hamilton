import { describe, it, expect, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { run, git, makeRepo, makeChangeDir, cleanupRepos, write, commitAll } from "./helpers.js"

const SCRIPT = "hamilton-precondition-check.sh"

afterEach(cleanupRepos)

const PLAN = `# Plan: add auth

## Tasks

### Task 1: Add the auth module

- Files: src/auth.ts
`

const PROGRESS = `# Progress: add auth

## Task 1: Add the auth module — 2026-08-13

- Outcome: done
`

const REVIEW = `# Review: add auth

## Task 1 — 2026-08-13

Verdict: approved

## whole change — 2026-08-13

Verdict: approved
`

interface Artifacts {
  plan?: string
  progress?: string
  /** null omits review.md entirely. */
  review?: string | null
}

/** Seed and commit a change directory whose gates all pass unless overridden. */
function seedChange(repo: string, artifacts: Artifacts = {}): string {
  const dir = makeChangeDir(repo, "add-auth")
  Fs.writeFileSync(Path.join(dir, "plan.md"), artifacts.plan ?? PLAN)
  Fs.writeFileSync(Path.join(dir, "progress.md"), artifacts.progress ?? PROGRESS)
  const review = artifacts.review === undefined ? REVIEW : artifacts.review
  if (review !== null) Fs.writeFileSync(Path.join(dir, "review.md"), review)
  commitAll(repo, "record the change artifacts")
  return dir
}

function check(repo: string, dir: string, ...extra: string[]) {
  return run(SCRIPT, ["--change-dir", dir, "--test-cmd", "true", ...extra], repo)
}

describe("hamilton-precondition-check.sh", () => {
  it("opens the gate when every precondition holds", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Clean tree")
    expect(result.stdout).toContain("[PASS] Tasks (1/1 implemented)")
    expect(result.stdout).toContain("[PASS] Reviews (all task scopes and whole change approved)")
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
  it("reads the latest outcome, not the first", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      progress: `# Progress: add auth

## Task 1: Add the auth module — 2026-08-13

- Outcome: done

## Task 1: Add the auth module — 2026-08-14

- Outcome: blocked
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Tasks (0/1 implemented — Task 1(blocked))")
  })

  it("fails a task with no progress entry at all", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, { progress: "# Progress: add auth\n" })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1(no entry)")
  })

  it("skips abandoned tasks and counts them separately", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      plan: `# Plan: add auth

## Tasks

### Task 1: Add the auth module

### Task 2: Add the audit log (abandoned — folded into Task 1)
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Tasks (1/1 implemented, 1 abandoned)")
  })

  it("ignores task headers that appear inside the template's instructional comments", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      plan: `<!--
  Tasks are written as:
  ### Task 9: <imperative title>
-->

# Plan: add auth

## Tasks

### Task 1: Add the auth module
`
    })

    const result = check(repo, dir)

    // Task 9 exists only in the comment; counting it would fail an otherwise open gate.
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Tasks (1/1 implemented)")
  })
})

describe("hamilton-precondition-check.sh gate 4 — reviews", () => {
  it("fails when a task's latest verdict regressed to changes-requested", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      review: `# Review: add auth

## Task 1 — 2026-08-13

Verdict: approved

## Task 1 — 2026-08-14

Verdict: changes-requested

## whole change — 2026-08-14

Verdict: approved
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("Task 1(latest verdict: changes-requested)")
  })

  it("fails an approved verdict that still carries blocking items", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      review: `# Review: add auth

## Task 1 — 2026-08-13

Verdict: approved

### Blocking

- src/auth.ts:12 — the token is never validated

## whole change — 2026-08-13

Verdict: approved
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("approved with unaddressed blocking items: task 1(1 blocking)")
  })

  it("fails an unfilled scope placeholder rather than passing text it cannot classify", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      review: `# Review: add auth

## <scope reviewed> — <YYYY-MM-DD>

Verdict: approved
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("unrecognised scope(s): <scope reviewed>")
  })

  it("fails when the whole change was never reviewed", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, {
      review: `# Review: add auth

## Task 1 — 2026-08-13

Verdict: approved
`
    })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("whole-change(never reviewed)")
  })

  it("fails when review.md is missing", () => {
    const repo = makeRepo()
    const dir = seedChange(repo, { review: null })

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Reviews (no review.md in")
    expect(result.stdout).toContain("[FAIL] Whole-change review freshness (review.md has never been committed)")
    expect(result.lastLine).toBe("gate: closed (2 failing)")
  })
})

describe("hamilton-precondition-check.sh gate 5 — review freshness", () => {
  it("fails when code landed after the whole-change review", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    const reviewCommit = git(repo, "rev-parse", "--short", "HEAD")
    write(repo, "src/auth.ts", "export const auth = true\n")
    commitAll(repo, "more code after the review")
    const codeCommit = git(repo, "rev-parse", "--short", "HEAD")

    const result = check(repo, dir)

    expect(result.status).toBe(1)
    expect(result.stdout).toContain("[FAIL] Whole-change review freshness")
    expect(result.stdout).toContain(`code ${codeCommit} is newer than review ${reviewCommit}`)
  })

  it("passes when the review commit postdates the last code commit", () => {
    const repo = makeRepo()
    write(repo, "src/auth.ts", "export const auth = true\n")
    commitAll(repo, "add auth")
    const dir = seedChange(repo)

    const result = check(repo, dir)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[PASS] Whole-change review freshness")
    expect(result.stdout).toContain("postdates code")
  })

  it("waives freshness only when explicitly told to", () => {
    const repo = makeRepo()
    const dir = seedChange(repo)
    write(repo, "src/auth.ts", "export const auth = true\n")
    commitAll(repo, "more code after the review")

    const result = check(repo, dir, "--whole-change-waived")

    expect(result.status).toBe(0)
    expect(result.stdout).toContain("[WAIVED] Whole-change review freshness")
    expect(result.stdout).toContain("record this in the finish entry")
    expect(result.lastLine).toBe("gate: open")
  })
})
