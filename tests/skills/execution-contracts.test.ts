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

  it("uses only the exact canonical abandonment suffix and preserves abandoned history", () => {
    const replan = section(skill, "## Re-plan mode")
    const codeInputs = section(readSkill("hamilton-code"), "## Inputs")

    for (const contract of [replan, codeInputs]) {
      expect(contract).toContain("`### Task N: <title> (abandoned — <reason>)`")
      expect(contract).toMatch(/only.*ends with.*complete\s+canonical.*nonempty reason/is)
      expect(contract).toContain("`(abandoned - reason)`")
      expect(contract).toContain("`(abandoned — )`")
      expect(contract).toContain("`(abandoned — reason) trailing`")
      expect(contract).toMatch(/active or malformed/)
      expect(contract).not.toMatch(/begins with the literal|suffix begins with|canonical literal/)
    }
    expect(replan).toMatch(/retain its existing task directory and append-only\s+history/)
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

  it("loads the installed task-progress template and owns only assigned task evidence", () => {
    const process = section(skill, "## Process")

    expect(skill).toContain("~/.hamilton/templates/task-progress.md")
    expect(skill).toMatch(/exact installed.*template/is)
    expect(skill).toMatch(/frontmatter.*metadata|metadata.*frontmatter/is)
    expect(skill).toMatch(/instruction block.*inline hint/is)
    expect(skill).toMatch(/must not survive|remov(?:e|ing)/is)
    expect(process).toMatch(/Update only the assigned task's root row to `in-progress`/)
    expect(process).toMatch(/update the same root row from `in-progress` to\s+the matching `done` or `blocked` status/)
    expect(skill).toContain("<change-dir>/tasks/task-N/progress.md")
    expect(skill).toMatch(/append.*next-numbered.*attempt.*physical end/is)
    expect(skill).toMatch(/preserve.*prior attempt/is)
    expect(skill).not.toMatch(/```(?:markdown)?[\s\S]*?Outcome: done \| blocked[\s\S]*?```/)
    expect(skill).toContain("Never mutate a sibling row, progress file, feedback file, or checkpoint")
  })

  it("uses the stable task checkpoint and keeps review and finish evidence separate", () => {
    expect(skill).toContain("<change-dir>/tasks/task-N/.base")
    expect(skill).toMatch(/full commit identifier/)
    expect(skill).toMatch(/never overwrite|does not overwrite/i)
    expect(skill).toMatch(/does not receive attempt sections, changed paths, commands, notes, feedback\s+verdicts, whole-branch review summaries, or finish outcomes/)
  })

  it("creates checkpoints only before evidence-free first attempts and stops for historical recovery", () => {
    const process = section(skill, "## Process")

    expect(process).toMatch(/row is `pending`.*task log has no attempt.*feedback is absent/is)
    expect(process).toMatch(/historical checkpoint.*unambiguous durable\s+git and task evidence/is)
    expect(process).toMatch(/stop.*intervention/is)
    expect(process).toMatch(/never substitute `HEAD~1`/)
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
