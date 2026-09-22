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

  it("defines feedback as the refactor gate with TDD context and routed outcomes", () => {
    const skill = readCodeFeedback()
    const inputs = section(skill, "## Inputs")
    const process = section(skill, "## Process")

    expect(inputs).toMatch(/implementation.*red\/green\/refactor.*(?:evidence|exception)/is)
    expect(inputs).toMatch(/implementation context/i)
    expect(skill).toMatch(/refactor-phase review/i)
    expect(skill).toMatch(/behavior-preserving refactor/i)
    expect(process).toMatch(/approved.*completes.*refactor gate/is)
    expect(process).toMatch(/requested changes.*same task.*new correction cycle/is)
    expect(skill).toMatch(/never\s+edits\s+implementation\s+or\s+progress\s+artifacts/i)
  })

  it("requires verification after corrections and judges exceptional verification", () => {
    const skill = readCodeFeedback()

    expect(skill).toMatch(/correction.*relevant verification/is)
    expect(skill).toMatch(/exceptional verification.*genuine\s+justification.*sufficiency/is)
    expect(skill).toMatch(/not approved automatically/is)
  })

  it("gates the split generation before task scope or verdict writes", () => {
    const skill = readCodeFeedback()
    const preflight = section(skill, "## Generation preflight")

    expect(preflight).toMatch(/no `plan\.md`.*`pre-plan`/is)
    expect(preflight).toMatch(/once `plan\.md` exists.*exact (?:split )?root task ledger/is)
    expect(preflight).toMatch(/every required active-task.*tasks\/task-N\/progress\.md/is)
    expect(preflight).toMatch(/monolithic.*missing.*partially split.*`legacy-unsupported`/is)
    expect(preflight).toMatch(/between-changes.*upgrade/i)
    expect(preflight).toMatch(/absent.*feedback\.md.*valid creation-time state/is)
    expect(preflight).toMatch(/never.*(?:create|append|change|write).*feedback/is)
    expect(skill.indexOf("## Generation preflight")).toBeLessThan(skill.indexOf("## Wrong scope"))
    expect(skill.indexOf("## Generation preflight")).toBeLessThan(skill.indexOf("## Process"))
    expect(skill.indexOf("## Generation preflight")).toBeLessThan(skill.indexOf("## Feedback artifact"))
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

  it("instantiates the installed template and appends task-owned feedback", () => {
    const artifact = readCodeFeedback()

    expect(artifact).toContain("~/.hamilton/templates/feedback.md")
    expect(artifact).toMatch(/exact installed.*template/i)
    expect(artifact).toContain("<change-dir>/tasks/task-N/feedback.md")
    expect(artifact).toMatch(/task directory segment is lowercase\s+`task-N`/)
    expect(artifact).toMatch(/remove.*instruction block.*inline hint/is)
    expect(artifact).toMatch(/append.*next-numbered pass.*physical end/is)
    expect(artifact).toMatch(/preserve.*prior pass/is)
    expect(artifact).toMatch(/frontmatter.*only.*artifact identity.*lifecycle/is)
    expect(artifact).toMatch(
      /Each pass contains exactly one full `Base:`, `Head:`, and `Verdict:` field,[\s\S]*?exactly its two child sections, `### Blocking` and `### Suggestions`/,
    )
    expect(artifact).toMatch(/never rewrite a prior pass/is)
    expect(artifact).toMatch(/no `### Reviewed range`\s+heading.*allowed/is)
    expect(artifact).toMatch(/never create.*`feedback-<k>\.md`/is)
    expect(artifact).not.toMatch(/```(?:markdown)?[\s\S]*?### Blocking[\s\S]*?### Suggestions[\s\S]*?```/)
  })

  it("records and validates complete per-pass provenance", () => {
    const artifact = readCodeFeedback()

    expect(artifact).toMatch(/physically last pass.*governs/is)
    expect(artifact).toMatch(/malformed last pass.*fail closed/is)
    expect(artifact).toMatch(/never.*fall\s+back.*earlier approval/is)
  })

  it("defines the one-time legacy transition and strict suffix boundary", () => {
    const artifact = readCodeFeedback()

    expect(artifact).toMatch(/first append.*legacy-global history/is)
    expect(artifact).toMatch(/validate the legacy-global history/is)
    expect(artifact).toMatch(/preserve every existing pass body byte-for-byte/is)
    expect(artifact).toMatch(/remove exactly\s+the\s+global `base`, `head`, and `verdict` fields/is)
    expect(artifact).toMatch(
      /append the next complete pass-local record at\s+the\s+physical end in the same mutation/is,
    )
    expect(artifact).toMatch(/never copy global provenance into historical passes/is)
    expect(artifact).toMatch(/never retain\s+global provenance beside an explicit suffix/is)
    expect(artifact).toMatch(/fieldless prefix.*explicit suffix.*already transitioned/is)
    expect(artifact).toMatch(/fail closed for partial globals/is)
    expect(artifact).toMatch(/mixed\s+global-plus-explicit evidence/is)
    expect(artifact).toMatch(/missing legacy globals without an explicit suffix/is)
    expect(artifact).toMatch(/fieldless\s+pass after the explicit suffix/is)
    expect(artifact).toMatch(/no `### Reviewed range` heading.*allowed/is)
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

  it("protects unrelated staged work before mutating or committing feedback", () => {
    const skill = readCodeFeedback()
    const process = section(skill, "## Process")
    const safety = section(skill, "## Commit safety preflight")
    const recording = section(skill, "## Record and commit")

    expect(safety).toContain("git diff --cached --name-only")
    expect(safety).toMatch(/before.*(?:create|append|change|write|mutat).*feedback/is)
    expect(safety).toMatch(/pre-staged\s+production\s+path/i)
    expect(safety).toMatch(/pre-staged\s+change-artifact\s+path/i)
    expect(safety).toMatch(/never.*(?:unstage|reset|restore)/is)
    expect(recording).toContain("git commit --only --")
    expect(recording).toMatch(/pre-existing staged.*remain staged.*unchanged/is)
    expect(recording).toMatch(/after.*commit.*verify.*only.*tasks\/task-N\/feedback\.md/is)
    expect(process.indexOf("Inspect the index")).toBeLessThan(
      process.indexOf("Append one complete pass"),
    )
    expect(process.indexOf("Append one complete pass")).toBeLessThan(
      process.indexOf("Verify the committed path list"),
    )
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
