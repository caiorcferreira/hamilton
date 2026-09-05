import * as Fs from "node:fs"
import { describe, expect, it } from "vitest"
import { readSkill, section } from "./helpers.js"

const readCodeFeedback = () => readSkill("hamilton-code-feedback")
const readQualityRubric = () =>
  Fs.readFileSync(
    new URL("../../skills/hamilton-code-feedback/references/code-quality.md", import.meta.url),
    "utf-8",
  )

describe("hamilton-code-feedback contract", () => {
  it("declares the task-scoped skill frontmatter", () => {
    const skill = readCodeFeedback()

    expect(skill).toMatch(/^---\nname: hamilton-code-feedback\n/)
    expect(skill).toMatch(/description:.*exactly one Task N/i)
    expect(skill).toMatch(/pipeline.*step 4/is)
  })

  it("accepts one exact task and its complete evidence package", () => {
    const inputs = section(readCodeFeedback(), "## Inputs")

    expect(inputs).toMatch(/exactly one existing active `Task N`/)
    expect(inputs).toContain("stable task diff package")
    expect(inputs).toContain("full base and head commit identifiers")
    expect(inputs).toContain("<change-dir>/tasks/task-N/progress.md")
    expect(inputs).toMatch(/binding requirements and design constraints/i)
    expect(inputs).toContain("Project standards")
  })

  it("keeps inspection bounded to the task diff and one named risk", () => {
    const inspection = section(readCodeFeedback(), "## Bounded inspection")

    expect(inspection).toContain("inspection boundary")
    expect(inspection).toMatch(/one concrete, named risk/)
    expect(inspection).toMatch(/Do not crawl|Never crawl/)
    expect(inspection).toMatch(/no unrelated repository\s+area/i)
  })

  it("blocks every unresolved impact that cannot be verified from the diff", () => {
    const verdicts = section(readCodeFeedback(), "## Verdicts")

    expect(verdicts).toContain("`cannot verify from diff`")
    expect(verdicts).toMatch(/blocking.*`changes-requested`/is)
    expect(verdicts).toMatch(/located evidence or code resolves it/i)
    expect(verdicts).toMatch(/never.*`approved`.*unresolved/is)
  })

  it("appends the canonical task-owned feedback pass", () => {
    const artifact = readCodeFeedback()

    expect(artifact).toContain("<change-dir>/tasks/task-N/feedback.md")
    expect(artifact).toMatch(/task directory segment is lowercase\s+`task-N`/)
    expect(artifact).toContain("# Code Feedback: Task N — <title>")
    expect(artifact).toContain("## Pass N — <YYYY-MM-DD>")
    expect(artifact).toContain("Verdict: approved | changes-requested")
    expect(artifact).toContain("### Blocking")
    expect(artifact).toContain("### Suggestions")
  })

  it("records and validates the complete reviewed range", () => {
    const artifact = readCodeFeedback()

    expect(artifact).toContain("Base: <full base commit identifier>")
    expect(artifact).toContain("Head: <full head commit identifier>")
    expect(artifact).toMatch(/physically last pass.*governs/is)
    expect(artifact).toMatch(/malformed last pass.*fail closed/is)
    expect(artifact).toMatch(/never.*fall\s+back.*earlier approval/is)
  })

  it("uses an artifact-only commit and never writes progress", () => {
    const recording = section(readCodeFeedback(), "## Record and commit")

    expect(recording).toContain("artifact-only bookkeeping commit")
    expect(recording).toMatch(/only.*tasks\/task-N\/feedback\.md/is)
    expect(recording).toMatch(/no code or sibling task artifact/i)
    expect(recording).toMatch(/Never.*root.*progress\.md/is)
    expect(recording).toMatch(/Never.*tasks\/task-N\/progress\.md/is)
    expect(recording).toMatch(/Never.*root task status/is)
  })

  it("stops whole-branch input and redirects it to hamilton-review", () => {
    const wrongScope = section(readCodeFeedback(), "## Wrong scope")

    expect(wrongScope).toMatch(/whole-branch.*stop/is)
    expect(wrongScope).toMatch(/without recording a verdict/i)
    expect(wrongScope).toContain("`hamilton-review`")
  })

  it("ships its own rubric without depending on a sibling skill", () => {
    const skill = readCodeFeedback()
    const rubric = readQualityRubric()

    expect(skill).toContain("references/code-quality.md")
    expect(skill).not.toMatch(/skills\/hamilton-review|\.\.\/hamilton-review/)
    expect(rubric).toContain("# Task diff code-quality rubric")
    expect(rubric).toContain("## Principles")
    expect(rubric).toMatch(/diff-scoped/i)
  })
})
