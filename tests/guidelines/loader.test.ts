import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadGuidelines } from "../../src/guidelines/loader.js"

describe("loadGuidelines", () => {
  let tmpHome: string
  let tmpProject: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guide-home-"))
    tmpProject = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-guide-proj-"))
    process.env.HOME = tmpHome
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
    Fs.rmSync(tmpProject, { recursive: true, force: true })
  })

  function writeGuideline(name: string, yml: string) {
    const dir = Path.join(tmpHome, ".hamilton", "guidelines", name)
    Fs.mkdirSync(dir, { recursive: true })
    Fs.writeFileSync(Path.join(dir, "guideline.yml"), yml)
    return dir
  }

  it("returns empty array when guidelines dir does not exist", async () => {
    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("returns empty array for empty guidelines directory", async () => {
    Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "guidelines"), { recursive: true })
    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("loads a guideline with rules only", async () => {
    writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  rules:",
      "  - name: no-npm",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^npm"',
      "    reason: Use pnpm in this repo."
    ].join("\n"))

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].name).toBe("js-standards")
      expect(exit.value[0].instructions).toBeNull()
      expect(exit.value[0].rules).toHaveLength(1)
      expect(exit.value[0].rules![0].name).toBe("no-npm")
      expect(exit.value[0].rules![0].compiledPattern).toBeInstanceOf(RegExp)
    }
  })

  it("loads a guideline with instructions matching project extensions", async () => {
    const dir = writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  instructions:",
      '    extensions: [".ts", ".js"]',
      "    files:",
      "    - code-style.md"
    ].join("\n"))
    Fs.writeFileSync(Path.join(dir, "code-style.md"), "Use const over let.")

    Fs.writeFileSync(Path.join(tmpProject, "main.ts"), "console.log('hi')")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].instructions).toHaveLength(1)
      expect(exit.value[0].instructions![0].name).toBe("js-standards")
      expect(exit.value[0].instructions![0].content).toBe("Use const over let.")
    }
  })

  it("skips instructions when no project extensions overlap", async () => {
    const dir = writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  instructions:",
      '    extensions: [".ts", ".js"]',
      "    files:",
      "    - code-style.md"
    ].join("\n"))
    Fs.writeFileSync(Path.join(dir, "code-style.md"), "Use const over let.")

    Fs.writeFileSync(Path.join(tmpProject, "main.py"), "print('hi')")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].instructions).toBeNull()
    }
  })

  it("always loads rules regardless of project extensions", async () => {
    writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  instructions:",
      '    extensions: [".ts", ".js"]',
      "    files:",
      "    - code-style.md",
      "  rules:",
      "  - name: no-npm",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^npm"',
      "    reason: Use pnpm."
    ].join("\n"))

    Fs.writeFileSync(Path.join(tmpProject, "main.py"), "print('hi')")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].instructions).toBeNull()
      expect(exit.value[0].rules).toHaveLength(1)
    }
  })

  it("skips directory without guideline.yml silently", async () => {
    writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  rules:",
      "  - name: no-npm",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^npm"',
      "    reason: Use pnpm."
    ].join("\n"))

    const emptyDir = Path.join(tmpHome, ".hamilton", "guidelines", "empty")
    Fs.mkdirSync(emptyDir, { recursive: true })

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].name).toBe("js-standards")
    }
  })

  it("skips guideline with invalid YAML", async () => {
    writeGuideline("bad", "not: [valid: yaml")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([])
    }
  })

  it("skips rule with invalid regex", async () => {
    writeGuideline("bad-regex", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: bad-regex",
      "spec:",
      "  rules:",
      "  - name: broken",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "[invalid"',
      "    reason: bad pattern"
    ].join("\n"))

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].rules).toBeNull()
    }
  })

  it("loads multiple guidelines", async () => {
    writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  rules:",
      "  - name: no-npm",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^npm"',
      "    reason: Use pnpm."
    ].join("\n"))

    writeGuideline("py-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: py-standards",
      "spec:",
      "  rules:",
      "  - name: no-pip",
      "    toolNames: [bash]",
      "    target: command",
      '    pattern: "^pip"',
      "    reason: Use uv instead."
    ].join("\n"))

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(2)
    }
  })

  it("skips node_modules, .git, dist, build, .hamilton when scanning extensions", async () => {
    const dir = writeGuideline("js-standards", [
      "apiVersion: dag.hamilton.io/v1alpha1",
      "kind: Guideline",
      "metadata:",
      "  name: js-standards",
      "spec:",
      "  instructions:",
      '    extensions: [".ts"]',
      "    files:",
      "    - code-style.md"
    ].join("\n"))
    Fs.writeFileSync(Path.join(dir, "code-style.md"), "Use const.")

    const nmDir = Path.join(tmpProject, "node_modules")
    Fs.mkdirSync(nmDir, { recursive: true })
    Fs.writeFileSync(Path.join(nmDir, "dep.ts"), "ts in node_modules")

    const exit = await Effect.runPromiseExit(loadGuidelines(Path.join(tmpHome, ".hamilton", "guidelines"), tmpProject))
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toHaveLength(1)
      expect(exit.value[0].instructions).toBeNull()
    }
  })
})
