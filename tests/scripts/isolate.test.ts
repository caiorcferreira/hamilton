import { describe, it, expect, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { run, git, makeRepo, makeChangeDir, cleanupRepos, field } from "./helpers.js"

const SCRIPT = "hamilton-isolate.sh"

afterEach(cleanupRepos)

describe("hamilton-isolate.sh --check", () => {
  it("reports not isolated on the default branch", () => {
    const repo = makeRepo()
    const result = run(SCRIPT, ["--check"], repo)

    expect(result.status).toBe(1)
    expect(field(result, "mode")).toBe("none")
    expect(field(result, "default-branch")).toBe("main")
    expect(result.lastLine).toBe("isolated: no (on the default branch (main) with no worktree)")
  })

  it("reports isolated on a dedicated branch", () => {
    const repo = makeRepo()
    git(repo, "checkout", "-q", "-b", "add-auth")

    const result = run(SCRIPT, ["--check"], repo)

    expect(result.status).toBe(0)
    expect(field(result, "mode")).toBe("in-place-branch")
    expect(field(result, "branch")).toBe("add-auth")
    expect(result.lastLine).toBe("isolated: yes")
  })

  it("detects master as the default branch", () => {
    const repo = makeRepo({ defaultBranch: "master" })

    const result = run(SCRIPT, ["--check"], repo)

    expect(result.status).toBe(1)
    expect(field(result, "default-branch")).toBe("master")
  })

  it("prefers origin/HEAD over a local main", () => {
    const repo = makeRepo()
    git(repo, "update-ref", "refs/remotes/origin/trunk", "HEAD")
    git(repo, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk")

    const result = run(SCRIPT, ["--check"], repo)

    // main is no longer the default, so sitting on it counts as isolated.
    expect(field(result, "default-branch")).toBe("trunk")
    expect(result.status).toBe(0)
  })

  it("fails closed on a detached HEAD", () => {
    const repo = makeRepo()
    git(repo, "checkout", "-q", "--detach", "HEAD")

    const result = run(SCRIPT, ["--check"], repo)

    expect(result.status).toBe(1)
    expect(field(result, "mode")).toBe("detached-head")
    expect(result.lastLine).toContain("detached HEAD")
  })

  it("reports isolated inside a linked worktree", () => {
    const repo = makeRepo()
    run(SCRIPT, ["add-auth"], repo)

    const result = run(SCRIPT, ["--check"], Path.join(repo, ".worktrees", "add-auth"))

    expect(result.status).toBe(0)
    expect(field(result, "mode")).toBe("linked-worktree")
  })

  it("rejects a change dir outside the worktree root", () => {
    const repo = makeRepo()
    const other = makeRepo()
    git(repo, "checkout", "-q", "-b", "add-auth")
    const outside = makeChangeDir(other, "add-auth")

    const result = run(SCRIPT, ["--check", "--change-dir", outside], repo)

    expect(result.status).toBe(1)
    expect(field(result, "change-dir")).toContain("OUTSIDE root")
    expect(result.lastLine).toContain("does not resolve under the worktree root")
  })

  it("accepts a change dir under the worktree root", () => {
    const repo = makeRepo()
    git(repo, "checkout", "-q", "-b", "add-auth")
    const inside = makeChangeDir(repo, "add-auth")

    const result = run(SCRIPT, ["--check", "--change-dir", inside], repo)

    expect(result.status).toBe(0)
    expect(field(result, "change-dir")).toContain("under root")
    expect(result.lastLine).toBe("isolated: yes")
  })

  it("rejects a change dir that does not exist", () => {
    const repo = makeRepo()
    git(repo, "checkout", "-q", "-b", "add-auth")

    const result = run(SCRIPT, ["--check", "--change-dir", Path.join(repo, "nope")], repo)

    expect(result.status).toBe(1)
    expect(result.lastLine).toContain("change dir does not exist")
  })

  it("errors outside a git repository", () => {
    const dir = Fs.mkdtempSync(Path.join(Fs.realpathSync(require("node:os").tmpdir()), "hamilton-nogit-"))
    try {
      const result = run(SCRIPT, ["--check"], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("not inside a git repository")
    } finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("hamilton-isolate.sh create mode", () => {
  it("creates the worktree and branch and prints the path last", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["add-auth"], repo)

    expect(result.status).toBe(0)
    expect(result.lastLine).toBe(Path.join(repo, ".worktrees", "add-auth"))
    expect(Fs.existsSync(result.lastLine)).toBe(true)
    expect(git(repo, "show-ref", "--verify", "refs/heads/add-auth")).toContain("add-auth")
  })

  it("leaves the tree clean by excluding .worktrees/", () => {
    const repo = makeRepo()

    run(SCRIPT, ["add-auth"], repo)

    expect(git(repo, "status", "--porcelain")).toBe("")
  })

  it("does not touch info/exclude when .worktrees/ is already ignored", () => {
    const repo = makeRepo()
    Fs.writeFileSync(Path.join(repo, ".gitignore"), ".worktrees/\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "ignore worktrees")

    const result = run(SCRIPT, ["add-auth"], repo)

    expect(result.stdout).not.toContain("ignored: added")
    expect(git(repo, "status", "--porcelain")).toBe("")
  })

  it("refuses a title that is not kebab-case", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["Add_Auth"], repo)

    expect(result.status).toBe(2)
    expect(result.stderr).toContain("kebab-case")
  })

  it("refuses to reuse an existing branch", () => {
    const repo = makeRepo()
    git(repo, "branch", "add-auth")

    const result = run(SCRIPT, ["add-auth"], repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("never silently reuse it")
  })

  it("refuses to reuse an existing worktree directory", () => {
    const repo = makeRepo()
    Fs.mkdirSync(Path.join(repo, ".worktrees", "add-auth"), { recursive: true })

    const result = run(SCRIPT, ["add-auth"], repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("already exists")
  })

  it("refuses to nest a worktree inside a worktree", () => {
    const repo = makeRepo()
    run(SCRIPT, ["add-auth"], repo)

    const result = run(SCRIPT, ["add-more"], Path.join(repo, ".worktrees", "add-auth"))

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("already in a linked worktree")
  })
})

describe("hamilton-isolate.sh --verify", () => {
  it("succeeds inside the named worktree", () => {
    const repo = makeRepo()
    run(SCRIPT, ["add-auth"], repo)

    const result = run(SCRIPT, ["--verify", "add-auth"], Path.join(repo, ".worktrees", "add-auth"))

    expect(result.status).toBe(0)
    expect(result.lastLine).toContain(Path.join(".worktrees", "add-auth"))
  })

  it("fails when the cd never took effect", () => {
    const repo = makeRepo()
    run(SCRIPT, ["add-auth"], repo)

    const result = run(SCRIPT, ["--verify", "add-auth"], repo)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("not in .worktrees/add-auth")
  })
})
