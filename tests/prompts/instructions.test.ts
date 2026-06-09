import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadInstructionFiles } from "../../src/prompts/instructions.js"

describe("loadInstructionFiles", () => {
  let tmpHome: string
  let tmpProject: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-instr-home-"))
    tmpProject = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-instr-proj-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
    Fs.rmSync(tmpProject, { recursive: true, force: true })
  })

  it("returns empty array when instruction dir does not exist", async () => {
    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("returns empty array when project has no matching extensions", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\", \".tsx\"]",
      "---",
      "TypeScript conventions here."
    ].join("\n"))

    Fs.writeFileSync(Path.join(tmpProject, "readme.txt"), "hello")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("loads matching instruction file when extension matches", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\", \".tsx\"]",
      "---",
      "TypeScript conventions here."
    ].join("\n"))

    Fs.writeFileSync(Path.join(tmpProject, "main.ts"), "console.log('hi')")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].name).toBe("TypeScript")
      expect(exit.value[0].content).toContain("TypeScript conventions here.")
    }
  })

  it("loads multiple matching instruction files", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\", \".tsx\"]",
      "---",
      "TS content."
    ].join("\n"))
    Fs.writeFileSync(Path.join(instrDir, "python.md"), [
      "---",
      "name: Python",
      "extensions: [\".py\"]",
      "---",
      "Python content."
    ].join("\n"))

    Fs.writeFileSync(Path.join(tmpProject, "main.ts"), "ts")
    Fs.writeFileSync(Path.join(tmpProject, "main.py"), "py")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(2)
    }
  })

  it("skips instruction files with invalid or missing frontmatter", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "bad.md"), "no frontmatter here")

    Fs.writeFileSync(Path.join(tmpProject, "main.ts"), "ts")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("skips node_modules, .git, dist, build directories", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\"]",
      "---",
      "TS content."
    ].join("\n"))

    const nmDir = Path.join(tmpProject, "node_modules")
    Fs.mkdirSync(nmDir, { recursive: true })
    Fs.writeFileSync(Path.join(nmDir, "dep.ts"), "ts in node_modules")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("scans nested directories for extensions", async () => {
    const instrDir = Path.join(tmpHome, ".hamilton", "instruction")
    Fs.mkdirSync(instrDir, { recursive: true })
    Fs.writeFileSync(Path.join(instrDir, "typescript.md"), [
      "---",
      "name: TypeScript",
      "extensions: [\".ts\"]",
      "---",
      "TS content."
    ].join("\n"))

    const srcDir = Path.join(tmpProject, "src")
    Fs.mkdirSync(srcDir, { recursive: true })
    Fs.writeFileSync(Path.join(srcDir, "main.ts"), "ts")

    const exit = await Effect.runPromiseExit(loadInstructionFiles(tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
    }
  })
})