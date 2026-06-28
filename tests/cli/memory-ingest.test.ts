import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { executeMemoryIngest } from "../../src/cli/commands/memory-ingest.js"

function createGuideline(tmpHome: string, name: string, instructionContent: string): void {
  const dir = Path.join(tmpHome, ".hamilton", "guidelines", name)
  Fs.mkdirSync(dir, { recursive: true })
  Fs.writeFileSync(Path.join(dir, "guideline.yml"), `apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Guideline
metadata:
  name: ${name}
spec:
  instructions:
    - matching: ["*.md"]
      files:
        - INSTRUCTIONS.md`)
  Fs.writeFileSync(Path.join(dir, "INSTRUCTIONS.md"), instructionContent)
}

function createProjectFile(projectDir: string, relativePath: string, content: string): void {
  const filePath = Path.join(projectDir, relativePath)
  Fs.mkdirSync(Path.dirname(filePath), { recursive: true })
  Fs.writeFileSync(filePath, content)
}

describe("executeMemoryIngest", () => {
  let tmpHome: string
  let projectDir: string
  const originalHome = process.env.HOME

  beforeEach(() => {
    tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-mem-"))
    process.env.HOME = tmpHome
    projectDir = Path.join(tmpHome, "project")
    Fs.mkdirSync(projectDir, { recursive: true })
    createProjectFile(projectDir, "README.md", "# Test Project")

    const piDir = Path.join(tmpHome, ".hamilton", "executors", "pi", "agent")
    Fs.mkdirSync(piDir, { recursive: true })
    Fs.writeFileSync(Path.join(piDir, "settings.json"), JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }))
  })

  afterEach(() => {
    process.env.HOME = originalHome
    Fs.rmSync(tmpHome, { recursive: true, force: true })
  })

  it("ingests guidelines and returns summary output", { timeout: 15000 }, async () => {
    createGuideline(tmpHome, "test-guideline", "Always write tests first.")

    const result = await Effect.runPromiseExit(
      executeMemoryIngest(projectDir)
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      const output = result.value
      expect(output).toContain("Guideline ingestion complete")
      expect(output).toContain("Processed: 1")
      expect(output).toContain("Ingested:  1")
      expect(output).toContain("test-guideline")
    }
  })

  it("returns message when no guidelines match", async () => {
    const result = await Effect.runPromiseExit(
      executeMemoryIngest(projectDir)
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toBe("No matching guideline files found.")
    }
  })

  it("skips unchanged guidelines on second run", { timeout: 30000 }, async () => {
    createGuideline(tmpHome, "test-guideline", "Always write tests first.")

    const first = await Effect.runPromiseExit(
      executeMemoryIngest(projectDir)
    )
    expect(Exit.isSuccess(first)).toBe(true)
    if (Exit.isSuccess(first)) {
      expect(first.value).toContain("Ingested:  1")
    }

    const second = await Effect.runPromiseExit(
      executeMemoryIngest(projectDir)
    )
    expect(Exit.isSuccess(second)).toBe(true)
    if (Exit.isSuccess(second)) {
      expect(second.value).toContain("Skipped:   1")
      expect(second.value).toContain("Ingested:  0")
    }
  })
})