import * as Fs from "node:fs"
import { describe, expect, it } from "vitest"
import { readSkill, section } from "./helpers.js"

const pipelineSequence =
  /init\s+→\s+propose\s+→\s+plan\s+→\s+code\s+→\s+code-feedback\s+→\s+review\s+→\s+finish-work/

const coreSkills = [
  ["hamilton-init", 0, /standing project standards/i],
  ["hamilton-propose", 1, /proposal.*requirements.*design/is],
  ["hamilton-plan", 2, /ordered ledger.*tasks/is],
  ["hamilton-code", 3, /one active plan task/i],
  ["hamilton-code-feedback", 4, /one implemented plan task.*stable diff/is],
  ["hamilton-review", 5, /complete branch.*final inspection/is],
  ["hamilton-finish-work", 6, /canonical specifications.*finish/is],
] as const

const liveSkills = [...coreSkills.map(([name]) => name), "hamilton-critique", "hamilton-orchestrate"]

describe("seven-step pipeline identity", () => {
  it.each(coreSkills)("identifies %s as core step %i with its distinct role", (name, step, role) => {
    const skill = readSkill(name)

    expect(skill).toMatch(pipelineSequence)
    expect(skill).toMatch(new RegExp(`step ${step}\\b`, "i"))
    expect(skill).toMatch(role)
  })

  it("keeps critique optional, outside the core count, and distinct from whole-branch review", () => {
    const critique = readSkill("hamilton-critique")

    expect(critique).toMatch(pipelineSequence)
    expect(critique).toMatch(/optional.*outside the (?:seven-step )?core (?:pipeline|count)/is)
    expect(critique).toMatch(/proposal.*requirements.*design/is)
    expect(critique).toMatch(/hamilton-review.*whole-branch/is)
  })

  it("keeps Wayfinder outside the core count", () => {
    for (const [name] of coreSkills) {
      expect(readSkill(name)).toMatch(/Wayfinder.*optional.*outside\s+the\s+(?:seven-step\s+)?core\s+count/is)
    }
  })

  it("uses the split task and whole-branch handoffs", () => {
    expect(readSkill("hamilton-init")).toMatch(/ready for `hamilton-propose`.*`hamilton-plan`/s)
    expect(section(readSkill("hamilton-propose"), "## Handoff")).toContain("`hamilton-plan`")
    expect(readSkill("hamilton-propose")).toMatch(/frontmatter.*`route_unit`/is)
    expect(section(readSkill("hamilton-plan"), "## Handoff")).toMatch(/`hamilton-code`.*`hamilton-orchestrate`/s)
    expect(section(readSkill("hamilton-code"), "## Handoff")).toMatch(/done commit.*`hamilton-code-feedback`/s)
    expect(section(readSkill("hamilton-code-feedback"), "## Output and handoff")).toMatch(/next task.*`hamilton-code`.*whole-branch.*`hamilton-review`/s)
    expect(section(readSkill("hamilton-review"), "## Output and handoff")).toMatch(/approved.*`hamilton-finish-work`/s)
    expect(readSkill("hamilton-finish-work")).toMatch(/step 6.*last/is)
    expect(readSkill("hamilton-finish-work")).toMatch(/frontmatter.*`decision`/is)
  })

  it("describes orchestration as the code-feedback loop followed by final review and finish", () => {
    const orchestrate = readSkill("hamilton-orchestrate")

    expect(orchestrate).toMatch(pipelineSequence)
    expect(orchestrate).toMatch(/`hamilton-code`.*↔.*`hamilton-code-feedback`.*`hamilton-review`.*`hamilton-finish-work`/s)
    expect(orchestrate).toMatch(/Wayfinder.*critique.*optional.*outside\s+the\s+(?:seven-step\s+)?core\s+count/is)
  })

  it("does not advertise hamilton-review as a task-scoped gate", () => {
    for (const name of liveSkills) {
      const skill = readSkill(name)

      expect(skill).not.toMatch(/hamilton-review pass on (?:this|each|one) task/i)
      expect(skill).not.toMatch(/task-scoped `hamilton-review`/i)
    }
  })

  it("makes the design testing strategy name tactical and final gates", () => {
    const design = Fs.readFileSync(new URL("../../bundle/templates/design.md", import.meta.url), "utf-8")
    const testing = section(design, "## Testing Strategy")

    expect(testing).toMatch(/tactical.*`hamilton-code`.*`hamilton-code-feedback`/s)
    expect(testing).toMatch(/final.*`hamilton-review`.*`hamilton-finish-work`/s)
  })
})
