import { describe, expect, it } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const templatesDir = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "../../bundle/templates")
const repositoryDir = Path.resolve(templatesDir, "../..")

function readTemplate(name: string): string {
  return Fs.readFileSync(Path.join(templatesDir, name), "utf-8")
}

describe("split execution artifact templates", () => {
  it("gives every lifecycle producer disposable authoring instructions", () => {
    const lifecycleTemplates = [
      ["progress.md", "hamilton-plan", ".hamilton/changes/<change>/progress.md"],
      ["task-progress.md", "hamilton-plan", ".hamilton/changes/<change>/tasks/task-N/progress.md"],
      ["feedback.md", "hamilton-code-feedback", ".hamilton/changes/<change>/tasks/task-N/feedback.md"],
      ["review.md", "hamilton-review", ".hamilton/changes/<change>/review.md"],
      ["finish.md", "hamilton-finish-work", ".hamilton/changes/<change>/finish.md"],
    ]

    for (const [name, producer, instancePath] of lifecycleTemplates) {
      const template = readTemplate(name)
      const instructions = template.match(/<!--([\s\S]*?)-->/)?.[1]

      expect(instructions).toBeDefined()
      expect(template.startsWith("---\n")).toBe(true)
      expect(instructions).toContain(`Produced by: ${producer}`)
      expect(instructions).toContain(`Lives at: ${instancePath}`)
      expect(instructions).toMatch(/Delete this instruction block and every inline hint before finalizing\./)
    }
  })

  it("defines the root task index", () => {
    const template = readTemplate("progress.md")

    expect(template).toContain("artifact: progress")
    expect(template).toContain("tasks:")
    expect(template).toContain("title: \"<task title>\"")
    expect(template).toContain("progress: tasks/task-N/progress.md")
    expect(template).toContain("status: pending | in-progress | blocked | complete")
  })

  it("defines the task-local progress artifact", () => {
    const template = readTemplate("task-progress.md")

    expect(template).toContain("# Task Progress: Task N — <title>")
    expect(template).not.toContain("## Attempt N — <YYYY-MM-DD>")
    expect(template).not.toContain("- Outcome: done | blocked")
    expect(template).not.toContain("- Verified: `<command>` → <result>")
  })

  it("defines the task-local feedback artifact", () => {
    const template = readTemplate("feedback.md")

    expect(template).toContain("# Code Feedback: Task N — <title>")
    expect(template).toContain("base: <full commit identifier>")
    expect(template).toContain("head: <full commit identifier>")
    expect(template).toContain("verdict: approved | changes-requested | skipped")
    expect(template).toContain("decision: accepted | rejected | skipped")
    expect(template).toContain("### Blocking")
    expect(template).toContain("### Suggestions")
  })

  it("defines the whole-branch review artifact", () => {
    const template = readTemplate("review.md")

    expect(template).toContain("# Whole-branch Review: <Change Title>")
    expect(template).toContain("base: <full merge-base commit identifier>")
    expect(template).toContain("head: <full head commit identifier>")
    expect(template).toContain("verdict: approved | changes-requested | skipped")
    expect(template).toContain("decision: accepted | rejected | skipped")
    expect(template).not.toContain("<scope reviewed>")
  })

  it("defines finish history at first-attempt creation", () => {
    const template = readTemplate("finish.md")

    expect(template).toContain("## Attempt N — <YYYY-MM-DD>")
    expect(template).toContain("strategy: local-merge | pull-request | no-op")
    expect(template).toContain("result: completed | blocked | pending")
    expect(template).toContain("decision: accepted | rejected | skipped")
  })

  it("documents the split artifact owners and instance paths", () => {
    const template = readTemplate("README.md")

    expect(template).toContain("`task-progress.md`")
    expect(template).toContain("`feedback.md`")
    expect(template).toContain("`finish.md`")
    expect(template).toContain("tasks/task-N/progress.md")
    expect(template).toContain("tasks/task-N/feedback.md")
  })

  it("keeps bundled templates as the only repository template source", () => {
    const trackedMirror = execFileSync("git", ["ls-files", ".hamilton/templates/**"], {
      cwd: repositoryDir,
      encoding: "utf-8",
    })

    expect(trackedMirror).toBe("")
    expect(Fs.existsSync(Path.join(templatesDir, "progress.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(templatesDir, "task-progress.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(templatesDir, "feedback.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(templatesDir, "review.md"))).toBe(true)
    expect(Fs.existsSync(Path.join(templatesDir, "finish.md"))).toBe(true)
  })
})
