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

  it("instantiates lint-valid planning artifacts with repository authorship", () => {
    const process = section(skill, "## Process")

    expect(process).toMatch(/plan\.md.*frontmatter.*`artifact`, `change`, `status`, `created`, `author`, `decision`, and `route_unit`/is)
    expect(process).toMatch(/root.*progress.*frontmatter.*`artifact`,\s+`change`,\s+`status`,\s+`updated`,\s+`decision`,\s+and\s+`tasks`/is)
    expect(process).toMatch(/each active.*tasks\/task-N\/progress\.md.*`artifact`,\s+`change`,\s+numeric `task`,\s+`status: pending`,\s+`updated`, and `decision`.*frontmatter/is)
    expect(process).toMatch(/same ordered task list.*frontmatter.*Markdown table.*one row/is)
    expect(process).toContain("# Task Progress: Task N — <title>")
    expect(process).toMatch(/`status: pending`.*no attempt|no attempt.*`status: pending`/is)
    expect(process).toMatch(/exact.*task heading|exact heading.*Task N/is)
    expect(process).toMatch(/escaped display titles|escape.*`\|`/is)
    expect(process).toMatch(/git config user\.name/)
    expect(process).toMatch(/git config user\.email/)
    expect(process).toMatch(/Name <email>/)
    expect(process).toMatch(/missing.*identity.*ask the user.*not invent/is)
    expect(process).toMatch(/preserv(?:e|es).*existing.*author/i)
    expect(process).toMatch(/after.*complete.*scaffold.*hamilton workbench lint --change-dir <change-dir>/is)
    expect(process).toMatch(/map-aware.*lint.*--file|--file.*map-aware.*lint/is)
  })

  it("reconciles re-plans without rewriting task history", () => {
    const replan = section(skill, "## Re-plan mode")

    expect(replan).toContain("Tasks the root ledger marks `done` are frozen")
    expect(replan).toMatch(/Append each new active task.*status `pending`/s)
    expect(replan).toContain("A renamed non-done task")
    expect(replan).toMatch(/Mark an abandoned task.*retain its existing task directory/s)
    expect(replan).toContain("Renumber nothing")
    expect(replan).toMatch(/surviving task's actual status in both the root frontmatter.*row/is)
    expect(replan).toMatch(/new active task.*matching frontmatter metadata and root row.*status `pending`/is)
    expect(replan).toContain("including frozen `done` tasks and existing non-done tasks")
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
    expect(process).toMatch(/Update only the assigned task's root frontmatter metadata entry and\s+Markdown row together to `in-progress`/is)
    expect(process).toMatch(/update the same root frontmatter metadata entry\s+and Markdown row together from `in-progress` to\s+the matching `done` or `blocked` status/is)
    expect(process).toMatch(/frontmatter.*(?:metadata|entry).*and.*(?:Markdown )?row.*together.*`in-progress`/is)
    expect(process).toMatch(/frontmatter.*(?:metadata|entry).*and.*(?:Markdown )?row.*together.*`(?:done|blocked)`/is)
    expect(process).toMatch(/preserv(?:e|es).*sibling.*(?:unchanged|status)/is)
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

  it("finalizes assigned task-local status only with its attempt outcome", () => {
    const process = section(skill, "## Process")

    expect(process).toMatch(/empty local task log.*`status: pending`/is)
    expect(process).toMatch(/Do not set.*local.*`in-progress`.*before.*attempt/is)
    expect(process).toMatch(/append.*attempt.*set.*local.*status.*`done` or `blocked`.*before.*lint.*commit/is)
    expect(process).toMatch(/done.*local.*`done`.*blocked.*local.*`blocked`/is)
    expect(process).toMatch(/preserv(?:e|es).*prior attempts.*sibling files/is)
    expect(process).toMatch(/linked file has no appended attempts.*creation portion.*match/is)
    expect(process).toMatch(/after attempts exist.*local `status: done` or `blocked`.*latest.*outcome/is)
    expect(process).toMatch(/previously finalized.*without.*local.*`in-progress`/is)
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
