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
  it("defines the root task index", () => {
    const template = readTemplate("progress.md")

    expect(template).toContain("| Task | Status | Progress |")
    expect(template).toContain("| Task N: <Markdown-escaped title> | pending | [details](tasks/task-N/progress.md) |")
    expect(template).toContain("pending | in-progress | blocked | done")
  })

  it("defines the task-local progress artifact", () => {
    const template = readTemplate("task-progress.md")

    expect(template).toContain("# Task Progress: Task N — <title>")
    expect(template).toContain("## Attempt N — <YYYY-MM-DD>")
    expect(template).toContain("- Outcome: done | blocked")
    expect(template).toContain("- Verified: `<command>` → <result>")
  })

  it("defines the task-local feedback artifact", () => {
    const template = readTemplate("feedback.md")

    expect(template).toContain("# Code Feedback: Task N — <title>")
    expect(template).toContain("Base: <full commit identifier>")
    expect(template).toContain("Head: <full commit identifier>")
    expect(template).toContain("Verdict: approved | changes-requested")
    expect(template).toContain("### Blocking")
    expect(template).toContain("### Suggestions")
  })

  it("defines the whole-branch review artifact", () => {
    const template = readTemplate("review.md")

    expect(template).toContain("# Whole-branch Review: <Change Title>")
    expect(template).toContain("Base: <full merge-base commit identifier>")
    expect(template).toContain("Head: <full head commit identifier>")
    expect(template).toContain("Verdict: approved | changes-requested")
    expect(template).not.toContain("<scope reviewed>")
  })

  it("defines paired finish attempts and outcomes", () => {
    const template = readTemplate("finish.md")

    expect(template).toContain("## Attempt N — <YYYY-MM-DD>")
    expect(template).toContain("## Outcome N — <YYYY-MM-DD>")
    expect(template).toContain("- Result: completed | blocked")
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
