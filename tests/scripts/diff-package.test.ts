import { describe, it, expect, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { run, git, makeRepo, makeChangeDir, cleanupRepos, write, commitAll, field } from "./helpers.js"

const SCRIPT = "hamilton-diff-package.sh"

afterEach(cleanupRepos)

/** Package mode writes to TMPDIR unless --out says otherwise; don't leave those behind. */
function discard(path: string): void {
  Fs.rmSync(path, { force: true })
}

describe("hamilton-diff-package.sh --record", () => {
  it("stores BASE = HEAD and leaves the tree clean", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    const head = git(repo, "rev-parse", "HEAD")

    const result = run(SCRIPT, ["--record", "--change-dir", changeDir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "base")).toBe(head)
    expect(result.lastLine).toBe(Path.join(changeDir, ".base"))
    expect(Fs.readFileSync(result.lastLine, "utf-8").trim()).toBe(head)
    // .base sits among tracked artifacts, so an untracked file there would fail the finish gate.
    expect(git(repo, "status", "--porcelain")).toBe("")
  })

  it("adds the exclude entry once, not once per call", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")

    const first = run(SCRIPT, ["--record", "--change-dir", changeDir], repo)
    const second = run(SCRIPT, ["--record", "--change-dir", changeDir], repo)

    expect(first.stdout).toContain("ignored: added")
    expect(second.stdout).not.toContain("ignored: added")

    const exclude = Fs.readFileSync(Path.join(repo, ".git", "info", "exclude"), "utf-8")
    const hits = exclude.split("\n").filter((line) => line === ".hamilton/changes/add-auth/.base")
    expect(hits).toHaveLength(1)
  })

  it("rejects --base", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")

    const result = run(SCRIPT, ["--record", "--change-dir", changeDir, "--base", "HEAD"], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("meaningless")
  })
})

describe("hamilton-diff-package.sh package mode", () => {
  it("refuses to guess a BASE when none was recorded", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")

    const result = run(SCRIPT, ["--change-dir", changeDir], repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("run --record")
  })

  it("writes a stat summary and a diff for the recorded range", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    run(SCRIPT, ["--record", "--change-dir", changeDir], repo)
    const base = git(repo, "rev-parse", "HEAD")
    write(repo, "src/auth.ts", "export const auth = true\n")
    const head = commitAll(repo, "add auth")

    const result = run(SCRIPT, ["--change-dir", changeDir], repo)

    expect(result.status).toBe(0)
    expect(field(result, "range")).toBe(`${base}..${head}`)
    expect(field(result, "files-changed")).toBe("1")

    const pkg = Fs.readFileSync(result.lastLine, "utf-8")
    expect(pkg).toContain("# Hamilton diff package")
    expect(pkg).toContain("## git diff --stat")
    expect(pkg).toContain("## git diff -U10")
    expect(pkg).toContain("export const auth = true")
    discard(result.lastLine)
  })

  it("fails when nothing has been committed since --record", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    run(SCRIPT, ["--record", "--change-dir", changeDir], repo)

    const result = run(SCRIPT, ["--change-dir", changeDir], repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("BASE equals HEAD")
  })

  it("discovers the change directory from the working directory", () => {
    const repo = makeRepo()
    const changeDir = makeChangeDir(repo, "add-auth")
    run(SCRIPT, ["--record", "--change-dir", changeDir], repo)
    write(repo, "src/auth.ts", "export const auth = true\n")
    commitAll(repo, "add auth")

    const out = Path.join(repo, "package.diff")
    const result = run(SCRIPT, ["--out", out], changeDir)

    expect(result.status).toBe(0)
    expect(result.lastLine).toBe(out)
    expect(Fs.existsSync(out)).toBe(true)
  })

  it("accepts an explicit --base with nothing recorded", () => {
    const repo = makeRepo()
    const base = git(repo, "rev-parse", "HEAD")
    write(repo, "src/auth.ts", "export const auth = true\n")
    const head = commitAll(repo, "add auth")

    const result = run(SCRIPT, ["--base", base], repo)

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
    // The wider range: what local main already carried, plus the branch's own commit.
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
