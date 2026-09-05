import { describe, it, expect, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { run, git, makeRepo, makeChangeDir, cleanupRepos, write, commitAll, field } from "./helpers.js"

const SCRIPT = "hamilton-diff-package.sh"

afterEach(cleanupRepos)

function discard(path: string): void {
  Fs.rmSync(path, { force: true })
}

function addTask(changeDir: string, task: number): void {
  const plan = Path.join(changeDir, "plan.md")
  const current = Fs.existsSync(plan) ? Fs.readFileSync(plan, "utf-8") : ""
  Fs.writeFileSync(plan, `${current}### Task ${task}: Test task\n`)
}

function prepareTask(repo: string, changeDir: string, task: number): void {
  addTask(changeDir, task)
  commitAll(repo, `add task ${task}`)
}

function prepareAbandonedTask(repo: string, changeDir: string, task: number): void {
  const plan = Path.join(changeDir, "plan.md")
  Fs.writeFileSync(plan, `### Task ${task}: Retired work (abandoned — no longer needed)\n`)
  commitAll(repo, `abandon task ${task}`)
}

function basePath(changeDir: string, task: number): string {
  return Path.join(changeDir, "tasks", `task-${task}`, ".base")
}

function record(changeDir: string, task: number, cwd: string): ReturnType<typeof run> {
  return run(SCRIPT, ["--record", "--change-dir", changeDir, "--task", String(task)], cwd)
}

function packageTask(changeDir: string, task: number, cwd: string): ReturnType<typeof run> {
  return run(SCRIPT, ["--change-dir", changeDir, "--task", String(task)], cwd)
}

describe("hamilton-diff-package.sh --record", () => {
  it("rejects duplicate task declarations", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    Fs.writeFileSync(Path.join(changeDir, "plan.md"), "### Task 2: First\n### Task 2: Second\n")
    commitAll(repo, "add duplicate tasks")

    const result = record(changeDir, 2, repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("duplicate Task 2")
  })

  it("ignores task headings inside HTML comments", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    Fs.writeFileSync(Path.join(changeDir, "plan.md"), "### Task 2: Test task\n<!-- ### Task 2: Hidden duplicate -->\n")
    commitAll(repo, "add commented task")

    const result = record(changeDir, 2, repo)

    expect(result.status).toBe(0)
    expect(Fs.existsSync(basePath(changeDir, 2))).toBe(true)
  })

  it("rejects a task declared only inside an HTML comment", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    Fs.writeFileSync(Path.join(changeDir, "plan.md"), "<!--\n### Task 2: Hidden task\n-->\n")
    commitAll(repo, "add hidden task")

    const result = record(changeDir, 2, repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("not active")
  })

  it("does not treat malformed abandonment syntax as abandoned", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    Fs.writeFileSync(Path.join(changeDir, "plan.md"), "### Task 2: Test task (abandoned - not canonical)\n")
    commitAll(repo, "add malformed abandonment")

    const result = record(changeDir, 2, repo)

    expect(result.status).toBe(0)
    expect(Fs.existsSync(basePath(changeDir, 2))).toBe(true)
  })

  it("stores Task N's BASE = HEAD and leaves the tree clean", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)
    const head = git(repo, "rev-parse", "HEAD")

    const result = record(changeDir, 2, repo)

    expect(result.status).toBe(0)
    expect(field(result, "base")).toBe(head)
    expect(result.lastLine).toBe(basePath(changeDir, 2))
    expect(Fs.readFileSync(result.lastLine, "utf-8").trim()).toBe(head)
    expect(Fs.existsSync(Path.join(changeDir, ".base"))).toBe(false)
    expect(git(repo, "status", "--porcelain")).toBe("")
  })

  it("adds each task checkpoint ignore entry once", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)

    const first = record(changeDir, 2, repo)
    const second = record(changeDir, 2, repo)

    expect(first.stdout).toContain("ignored: added")
    expect(second.stdout).not.toContain("ignored: added")

    const exclude = Fs.readFileSync(Path.join(repo, ".git", "info", "exclude"), "utf-8")
    const hits = exclude.split("\n").filter((line) => line === ".hamilton/changes/add-auth/tasks/task-2/.base")
    expect(hits).toHaveLength(1)
  })

  it("records once without overwriting a task checkpoint", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)
    const base = git(repo, "rev-parse", "HEAD")
    record(changeDir, 2, repo)
    write(repo, "src/auth.ts", "export const auth = true\n")
    commitAll(repo, "add auth")

    const result = record(changeDir, 2, repo)

    expect(result.status).toBe(0)
    expect(field(result, "base")).toBe(base)
    expect(Fs.readFileSync(basePath(changeDir, 2), "utf-8").trim()).toBe(base)
  })

  it("requires an exact positive active task number", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)

    for (const task of ["", "0", "-1", "02", "2x", "3"]) {
      const args = ["--record", "--change-dir", changeDir]
      if (task !== "") args.push("--task", task)
      const result = run(SCRIPT, args, repo)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("task")
    }
  })

  it("rejects abandoned plan tasks", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareAbandonedTask(repo, changeDir, 2)

    const result = record(changeDir, 2, repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("abandoned")
    expect(Fs.existsSync(basePath(changeDir, 2))).toBe(false)
  })

  it("rejects --base", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)

    const result = run(SCRIPT, ["--record", "--change-dir", changeDir, "--task", "2", "--base", "HEAD"], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("meaningless")
  })
})

describe("hamilton-diff-package.sh package mode", () => {
  it("refuses to guess a task BASE when none was recorded", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)

    const result = packageTask(changeDir, 2, repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("run --record")
    expect(result.stderr).not.toContain("HEAD~1")
  })

  it("requires an exact active task number when packaging", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)

    for (const task of ["0", "02", "3"]) {
      const result = run(SCRIPT, ["--change-dir", changeDir, "--task", task], repo)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("task")
    }
  })

  it("rejects abandoned plan tasks when packaging", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareAbandonedTask(repo, changeDir, 2)

    const result = packageTask(changeDir, 2, repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("abandoned")
  })

  it("writes a stat summary and a diff for the recorded task range", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)
    record(changeDir, 2, repo)
    const base = git(repo, "rev-parse", "HEAD")
    write(repo, "src/auth.ts", "export const auth = true\n")
    const head = commitAll(repo, "add auth")

    const result = packageTask(changeDir, 2, repo)

    expect(result.status).toBe(0)
    expect(field(result, "range")).toBe(`${base}..${head}`)
    expect(field(result, "files-changed")).toBe("1")
    expect(Fs.readFileSync(result.lastLine, "utf-8")).toContain("export const auth = true")
    discard(result.lastLine)
  })

  it("uses the first checkpoint across a correction range", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)
    const base = git(repo, "rev-parse", "HEAD")
    record(changeDir, 2, repo)
    write(repo, "src/auth.ts", "export const auth = true\n")
    commitAll(repo, "implement auth")
    write(repo, "src/auth.ts", "export const auth = false\n")
    const head = commitAll(repo, "correct auth")

    const result = packageTask(changeDir, 2, repo)

    expect(result.status).toBe(0)
    expect(field(result, "range")).toBe(`${base}..${head}`)
    discard(result.lastLine)
  })

  it("discovers the change directory from the working directory", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)
    record(changeDir, 2, repo)
    write(repo, "src/auth.ts", "export const auth = true\n")
    commitAll(repo, "add auth")
    const out = Path.join(repo, "package.diff")

    const result = run(SCRIPT, ["--task", "2", "--out", out], changeDir)

    expect(result.status).toBe(0)
    expect(result.lastLine).toBe(out)
    expect(Fs.existsSync(out)).toBe(true)
    discard(out)
  })

  it("keeps one task's checkpoint isolated from the next task", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)
    prepareTask(repo, changeDir, 3)
    const task2Base = git(repo, "rev-parse", "HEAD")
    record(changeDir, 2, repo)
    write(repo, "src/auth.ts", "export const auth = true\n")
    const task3Base = commitAll(repo, "implement task two")
    record(changeDir, 3, repo)
    write(repo, "src/session.ts", "export const session = true\n")
    const head = commitAll(repo, "implement task three")

    const task2 = packageTask(changeDir, 2, repo)
    const task3 = packageTask(changeDir, 3, repo)

    expect(field(task2, "range")).toBe(`${task2Base}..${head}`)
    expect(field(task3, "range")).toBe(`${task3Base}..${head}`)
    expect(Fs.readFileSync(basePath(changeDir, 2), "utf-8").trim()).toBe(task2Base)
    discard(task2.lastLine)
    discard(task3.lastLine)
  })

  it("fails for empty, malformed, off-history, and same-as-HEAD task checkpoints", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    prepareTask(repo, changeDir, 2)
    const checkpoint = basePath(changeDir, 2)
    Fs.mkdirSync(Path.dirname(checkpoint), { recursive: true })

    Fs.writeFileSync(checkpoint, "\n")
    const empty = packageTask(changeDir, 2, repo)
    expect(empty.status).toBe(1)
    expect(empty.stderr).not.toContain("HEAD~1")

    Fs.writeFileSync(checkpoint, "not-a-commit\n")
    const malformed = packageTask(changeDir, 2, repo)
    expect(malformed.status).toBe(2)
    expect(malformed.stderr).toContain("exactly one full commit ID")

    const head = git(repo, "rev-parse", "HEAD")
    for (const malformedCheckpoint of ["HEAD~1", "main", head.slice(0, 12), `${head.slice(0, 20)} ${head.slice(20)}`]) {
      Fs.writeFileSync(checkpoint, `${malformedCheckpoint}\n`)
      const invalid = packageTask(changeDir, 2, repo)
      expect(invalid.status).toBe(2)
      expect(invalid.stderr).toContain("exactly one full commit ID")
    }

    git(repo, "checkout", "-q", "-b", "other")
    write(repo, "src/other.ts", "export const other = true\n")
    const offHistory = commitAll(repo, "other history")
    git(repo, "checkout", "-q", "main")
    Fs.mkdirSync(Path.dirname(checkpoint), { recursive: true })
    Fs.writeFileSync(checkpoint, `${offHistory}\n`)
    const unrelated = packageTask(changeDir, 2, repo)
    expect(unrelated.status).toBe(2)
    expect(unrelated.stderr).toContain("not an ancestor")

    Fs.writeFileSync(checkpoint, `${head}\n`)
    const sameAsHead = packageTask(changeDir, 2, repo)
    expect(sameAsHead.status).toBe(1)
    expect(sameAsHead.stderr).toContain("BASE equals HEAD")
  })

  it("accepts an explicit --base with nothing recorded", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    const base = git(repo, "rev-parse", "HEAD")
    write(repo, "src/auth.ts", "export const auth = true\n")
    const head = commitAll(repo, "add auth")

    const result = run(SCRIPT, ["--base", base, "--change-dir", changeDir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "range")).toBe(`${base}..${head}`)
    discard(result.lastLine)
  })

  it("rejects a BASE that is not a commit here", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["--base", "0000000000000000000000000000000000000000"], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("not a commit in this repository")
  })
})

describe("hamilton-diff-package.sh --whole-change", () => {
  it("packages merge-base(default)..HEAD", () => {
    const repo = makeRepo()
    const base = git(repo, "rev-parse", "HEAD")
    git(repo, "checkout", "-q", "-b", "add-auth")
    write(repo, "src/auth.ts", "export const auth = true\n")
    const head = commitAll(repo, "add auth")

    const result = run(SCRIPT, ["--whole-change"], repo)

    expect(result.status).toBe(0)
    expect(field(result, "default-branch")).toBe("main")
    expect(field(result, "range")).toBe(`${base}..${head}`)
    discard(result.lastLine)
  })

  it("prefers origin/<default> over a local branch that has moved on", () => {
    const repo = makeRepo()
    const remoteTip = git(repo, "rev-parse", "HEAD")
    write(repo, "src/other.ts", "export const other = true\n")
    commitAll(repo, "local main moves ahead")
    git(repo, "update-ref", "refs/remotes/origin/main", remoteTip)
    git(repo, "checkout", "-q", "-b", "add-auth")
    write(repo, "src/auth.ts", "export const auth = true\n")
    const head = commitAll(repo, "add auth")

    const result = run(SCRIPT, ["--whole-change"], repo)

    expect(field(result, "default-branch")).toBe("origin/main")
    expect(field(result, "range")).toBe(`${remoteTip}..${head}`)
    expect(field(result, "files-changed")).toBe("2")
    discard(result.lastLine)
  })

  it("fails when HEAD is at the merge-base", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["--whole-change"], repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("no commits to review")
  })

  it("rejects --change-dir", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")

    const result = run(SCRIPT, ["--whole-change", "--change-dir", changeDir], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("meaningless")
  })
})
