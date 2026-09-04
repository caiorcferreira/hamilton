import { describe, expect, it } from "vitest"
import { readSkill, section } from "./helpers.js"

describe("hamilton-plan execution contract", () => {
  const skill = readSkill("hamilton-plan")

  it("initializes the stable root ledger and task-local evidence paths", () => {
    const process = section(skill, "## Process")

    expect(skill).toContain("<change-dir>/progress.md")
    expect(skill).toContain("<change-dir>/tasks/task-N/progress.md")
    expect(skill).toContain("tasks/task-N/progress.md")
    expect(process).toMatch(/status vocabulary is\s+`pending`, `in-progress`, `blocked`, and `done`/)
    expect(process).toMatch(/standard Markdown table escaping/)
    expect(process).toMatch(/identity is not derived from the title/)
  })

  it("reconciles re-plans without rewriting task history", () => {
    const replan = section(skill, "## Re-plan mode")

    expect(replan).toContain("Tasks the root ledger marks `done` are frozen")
    expect(replan).toMatch(/Append each new active task.*status `pending`/s)
    expect(replan).toContain("A renamed non-done task")
    expect(replan).toMatch(/Mark an abandoned task.*retain its existing task directory/s)
    expect(replan).toContain("Renumber nothing")
  })

  it("uses the canonical abandoned marker and preserves abandoned history", () => {
    const replan = section(skill, "## Re-plan mode")
    const codeInputs = section(readSkill("hamilton-code"), "## Inputs")

    expect(replan).toContain("`### Task N: <title> (abandoned — <reason>)`")
    expect(replan).toContain("retain its existing task directory and append-only history")
    expect(codeInputs).toContain("literal `(abandoned`")
  })

  it("rejects planned legacy layouts", () => {
    expect(skill).toMatch(/plan\.md.*legacy-unsupported|legacy-unsupported.*plan\.md/is)
    expect(skill).toMatch(/Never parse,\s+migrate, reconstruct, or partially scaffold a planned legacy layout\./)
  })
})

describe("hamilton-code execution contract", () => {
  const skill = readSkill("hamilton-code")

  it("requires one exact active task id for referenced and inline inputs", () => {
    const inputs = section(skill, "## Inputs")

    expect(inputs).toMatch(/exactly one existing active `Task N`/)
    expect(inputs).toMatch(/inline.*numeric task id/is)
    expect(inputs).toContain("does not permit title inference")
  })

  it("owns only the assigned task status transitions and evidence", () => {
    const process = section(skill, "## Process")

    expect(process).toMatch(/Update only the assigned task's root row to `in-progress`/)
    expect(process).toMatch(/update the same root row from `in-progress` to\s+the matching `done` or `blocked` status/)
    expect(skill).toContain("<change-dir>/tasks/task-N/progress.md")
    expect(skill).toContain("## Attempt N — <YYYY-MM-DD>")
    expect(skill).toContain("- Outcome: done | blocked")
    expect(skill).toContain("Never mutate a sibling row, progress file, feedback file, or checkpoint")
  })

  it("uses the stable task checkpoint and keeps review and finish evidence separate", () => {
    expect(skill).toContain("<change-dir>/tasks/task-N/.base")
    expect(skill).toMatch(/full commit identifier/)
    expect(skill).toMatch(/never overwrite|does not overwrite/i)
    expect(skill).toMatch(/does not receive attempt sections, changed paths, commands, notes, feedback\s+verdicts, whole-branch review summaries, or finish outcomes/)
  })

  it("persists graceful blockers without committing partial production edits", () => {
    const blocking = section(skill, "## Blocking and interruption")

    expect(blocking).toContain("artifact-only commit path")
    expect(blocking).toMatch(/partial production\s+edits remain uncommitted/)
    expect(blocking).toContain("root row to `blocked`")
    expect(blocking).toContain("assigned task log")
  })

  it("rejects unsupported planned legacy layouts before implementation", () => {
    expect(skill).toContain("legacy-unsupported")
    expect(skill).toMatch(/before implementation/)
    expect(skill).toMatch(/Never parse, migrate, reconstruct, or partially scaffold a\s+planned legacy layout\./)
  })
})
