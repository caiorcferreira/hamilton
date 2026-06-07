import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { ensureSharedAgentsSymlink, SharedAgentsSymlinkError } from "../../src/workflow/shared-agents.js"

describe("ensureSharedAgentsSymlink", () => {
  let tmpDir: string
  let agentsDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-symlink-test-"))
    agentsDir = Path.join(tmpDir, "agents")
    Fs.mkdirSync(agentsDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentsDir, "AGENTS.md"), "test")
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("creates symlink when link path does not exist", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "my-wf")
    Fs.mkdirSync(workflowDir, { recursive: true })

    const exit = await Effect.runPromiseExit(ensureSharedAgentsSymlink(workflowDir, agentsDir))
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(workflowDir, "shared", "agents")
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
    const realPath = Path.resolve(Path.dirname(linkPath), Fs.readlinkSync(linkPath))
    expect(realPath).toBe(Path.resolve(agentsDir))
  })

  it("no-ops when correct symlink already exists", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "my-wf")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.symlinkSync(agentsDir, Path.join(workflowDir, "shared", "agents"))

    const exit = await Effect.runPromiseExit(ensureSharedAgentsSymlink(workflowDir, agentsDir))
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(workflowDir, "shared", "agents")
    const realPath = Path.resolve(Path.dirname(linkPath), Fs.readlinkSync(linkPath))
    expect(realPath).toBe(Path.resolve(agentsDir))
  })

  it("replaces symlink when wrong target exists", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "my-wf")
    const wrongAgentsDir = Path.join(tmpDir, "wrong-agents")
    Fs.mkdirSync(wrongAgentsDir, { recursive: true })
    Fs.writeFileSync(Path.join(wrongAgentsDir, "AGENTS.md"), "wrong")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.symlinkSync(wrongAgentsDir, Path.join(workflowDir, "shared", "agents"))

    const exit = await Effect.runPromiseExit(ensureSharedAgentsSymlink(workflowDir, agentsDir))
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(workflowDir, "shared", "agents")
    const realPath = Path.resolve(Path.dirname(linkPath), Fs.readlinkSync(linkPath))
    expect(realPath).toBe(Path.resolve(agentsDir))
  })

  it("replaces when a file (not symlink) exists at link path", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "my-wf")
    Fs.mkdirSync(workflowDir, { recursive: true })
    const sharedDir = Path.join(workflowDir, "shared")
    Fs.mkdirSync(sharedDir, { recursive: true })
    Fs.writeFileSync(Path.join(workflowDir, "shared", "agents"), "not a symlink")

    const exit = await Effect.runPromiseExit(ensureSharedAgentsSymlink(workflowDir, agentsDir))
    expect(Exit.isSuccess(exit)).toBe(true)

    const linkPath = Path.join(workflowDir, "shared", "agents")
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
    const realPath = Path.resolve(Path.dirname(linkPath), Fs.readlinkSync(linkPath))
    expect(realPath).toBe(Path.resolve(agentsDir))
  })

  it("creates shared/ parent directory if missing", async () => {
    const workflowDir = Path.join(tmpDir, "workflows", "my-wf")
    Fs.mkdirSync(workflowDir, { recursive: true })
    expect(Fs.existsSync(Path.join(workflowDir, "shared"))).toBe(false)

    const exit = await Effect.runPromiseExit(ensureSharedAgentsSymlink(workflowDir, agentsDir))
    expect(Exit.isSuccess(exit)).toBe(true)

    expect(Fs.existsSync(Path.join(workflowDir, "shared"))).toBe(true)
    const linkPath = Path.join(workflowDir, "shared", "agents")
    expect(Fs.lstatSync(linkPath).isSymbolicLink()).toBe(true)
  })
})