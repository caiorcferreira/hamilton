import { describe, it, expect, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { run, git, makeRepo, write, cleanupRepos, field } from "./helpers.js"

const SCRIPT = "hamilton-prototype-branch.sh"

afterEach(cleanupRepos)

describe("hamilton-prototype-branch.sh create/resume mode", () => {
  it("creates the branch from the current branch and switches to it", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["payments-redesign", "03-storage-model"], repo)

    expect(result.status).toBe(0)
    expect(field(result, "mode")).toBe("created")
    expect(result.lastLine).toBe("prototype/payments-redesign/03-storage-model")
    expect(git(repo, "branch", "--show-current")).toBe("prototype/payments-redesign/03-storage-model")
  })

  it("carries an uncommitted change along the switch", () => {
    const repo = makeRepo()
    const file = write(repo, "scratch.txt", "wip\n")

    const result = run(SCRIPT, ["payments-redesign", "03-storage-model"], repo)

    expect(result.status).toBe(0)
    expect(Fs.existsSync(file)).toBe(true)
    expect(Fs.readFileSync(file, "utf-8")).toBe("wip\n")
  })

  it("reports mode: resumed when the branch already exists", () => {
    const repo = makeRepo()
    run(SCRIPT, ["payments-redesign", "03-storage-model"], repo)
    git(repo, "checkout", "-q", "main")

    const result = run(SCRIPT, ["payments-redesign", "03-storage-model"], repo)

    expect(result.status).toBe(0)
    expect(field(result, "mode")).toBe("resumed")
    expect(result.lastLine).toBe("prototype/payments-redesign/03-storage-model")
    expect(git(repo, "branch", "--show-current")).toBe("prototype/payments-redesign/03-storage-model")
  })

  it("creates a standalone branch from a question slug", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, ["--standalone", "my-question"], repo)

    expect(result.status).toBe(0)
    expect(field(result, "mode")).toBe("created")
    expect(result.lastLine).toBe("prototype/my-question")
    expect(git(repo, "branch", "--show-current")).toBe("prototype/my-question")
  })
})

describe("hamilton-prototype-branch.sh --verify", () => {
  it("succeeds when the current branch matches", () => {
    const repo = makeRepo()
    run(SCRIPT, ["payments-redesign", "03-storage-model"], repo)

    const result = run(
      SCRIPT,
      ["--verify", "prototype/payments-redesign/03-storage-model"],
      repo
    )

    expect(result.status).toBe(0)
  })

  it("fails when the current branch does not match", () => {
    const repo = makeRepo()

    const result = run(
      SCRIPT,
      ["--verify", "prototype/payments-redesign/03-storage-model"],
      repo
    )

    expect(result.status).toBe(1)
  })
})

describe("hamilton-prototype-branch.sh usage and environment errors", () => {
  it("exits 2 with no arguments", () => {
    const repo = makeRepo()

    const result = run(SCRIPT, [], repo)

    expect(result.status).toBe(2)
  })

  it("exits 2 outside a git repository", () => {
    const dir = Fs.mkdtempSync(Path.join(Fs.realpathSync(Os.tmpdir()), "hamilton-nogit-"))
    try {
      const result = run(SCRIPT, ["payments-redesign", "03-storage-model"], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain("not inside a git repository")
    } finally {
      Fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
