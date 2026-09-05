import * as Fs from "node:fs"
import { describe, expect, it } from "vitest"
import { readSkill, section } from "./helpers.js"

const readReview = () => readSkill("hamilton-review")
const readQualityRubric = () =>
  Fs.readFileSync(
    new URL("../../skills/hamilton-review/references/code-quality.md", import.meta.url),
    "utf-8",
  )

describe("hamilton-review contract", () => {
  it("declares the whole-branch pipeline gate", () => {
    const skill = readReview()

    expect(skill).toMatch(/^---\nname: hamilton-review\n/)
    expect(skill).toMatch(/description:.*whole branch/i)
    expect(skill).toMatch(/pipeline.*step 5/is)
  })

  it("accepts only a complete merge-base-to-head evidence package", () => {
    const inputs = section(readReview(), "## Inputs")

    expect(inputs).toMatch(/only.*complete branch change/is)
    expect(inputs).toMatch(/merge base through current\s+`HEAD`/)
    expect(inputs).toContain("full merge base and head commit identifiers")
    expect(inputs).toMatch(/proposal.*requirements.*design.*plan.*root task ledger/is)
    expect(inputs).toMatch(/every active task.*latest implementation attempt.*feedback concerns/is)
    expect(inputs).toContain("complete branch diff")
    expect(inputs).toContain("Project standards")
  })

  it("starts from the whole diff and always inspects broader repository impact", () => {
    const inspection = section(readReview(), "## Whole-branch inspection")

    expect(inspection).toMatch(/complete branch diff.*starting evidence/is)
    expect(inspection).toMatch(/not.*inspection boundary/is)
    expect(inspection).toMatch(/Every pass.*affected consumers/is)
    expect(inspection).toContain("assumptions")
    expect(inspection).toMatch(/cross-task (composition|integration)/i)
    expect(inspection).toMatch(/missing material changes/i)
    expect(inspection).toMatch(/scope and boundary violations/i)
    expect(inspection).toMatch(/changed cause.*affected location/is)
  })

  it("runs only focused verification for a concrete doubt", () => {
    const verification = section(readReview(), "## Focused verification")

    expect(verification).toMatch(/only.*concrete.*doubt/is)
    expect(verification).toMatch(/narrowest focused (test|check)/i)
    expect(verification).toMatch(/does not.*full test suite|never.*full test suite/is)
    expect(verification).toMatch(/does not.*build|never.*build/is)
    expect(verification).toMatch(/hamilton-finish-work.*mandatory\s+full\s+verification/is)
  })

  it("records the canonical root review pass and material freshness range", () => {
    const artifact = readReview()

    expect(artifact).toContain("<change-dir>/review.md")
    expect(artifact).toContain("Base: <full merge base commit identifier>")
    expect(artifact).toContain("Head: <full head commit identifier>")
    expect(artifact).toContain("Verdict: approved | changes-requested")
    expect(artifact).toMatch(/latest material change commit/i)
    expect(artifact).toMatch(/root `progress\.md`.*task-N\/progress\.md.*task-N\/feedback\.md.*root `review\.md`.*root `finish\.md`/is)
    expect(artifact).toMatch(/skills.*templates.*scripts.*documentation.*material/is)
  })

  it("uses only the physically last valid and fresh review pass", () => {
    const artifact = readReview()

    expect(artifact).toMatch(/physically last pass.*governs/is)
    expect(artifact).toMatch(/base.*ancestor.*head/is)
    expect(artifact).toMatch(/head.*ancestor.*current `HEAD`/is)
    expect(artifact).toMatch(/head.*contains.*latest material change commit/is)
    expect(artifact).toMatch(/malformed last pass.*fail closed/is)
    expect(artifact).toMatch(/never.*fall back.*earlier approval/is)
  })

  it("commits only the root review artifact and never updates progress or task status", () => {
    const recording = section(readReview(), "## Record and commit")

    expect(recording).toContain("artifact-only bookkeeping commit")
    expect(recording).toMatch(/only.*root `review\.md`/is)
    expect(recording).toMatch(/no code or task artifact/i)
    expect(recording).toMatch(/Never.*root.*progress\.md/is)
    expect(recording).toMatch(/Never.*task-local progress/i)
    expect(recording).toMatch(/Never.*task implementation status/is)
  })

  it("stops task-scoped input and redirects it to hamilton-code-feedback", () => {
    const wrongScope = section(readReview(), "## Wrong scope")

    expect(wrongScope).toMatch(/task-scoped.*stop/is)
    expect(wrongScope).toMatch(/without recording a verdict/i)
    expect(wrongScope).toContain("`hamilton-code-feedback`")
  })

  it("routes final findings through re-plan or proposal revision", () => {
    const handoff = section(readReview(), "## Output and handoff")

    expect(handoff).toMatch(/changes-requested.*complete finding set.*re-plan/is)
    expect(handoff).toMatch(/independently verifiable.*multiple.*remediation tasks/is)
    expect(handoff).toMatch(/invalidates.*approved requirement or design.*hamilton-propose/is)
    expect(handoff).toMatch(/Never send whole-branch findings directly to\s+`hamilton-code`/i)
  })

  it("ships a whole-branch integration and omission quality rubric", () => {
    const skill = readReview()
    const rubric = readQualityRubric()

    expect(skill).toContain("references/code-quality.md")
    expect(rubric).toContain("# Whole-branch code-quality rubric")
    expect(rubric).toContain("## Integration and composition")
    expect(rubric).toContain("## Missing material changes")
    expect(rubric).toContain("## Affected consumers and assumptions")
    expect(rubric).toMatch(/beyond the diff/i)
  })
})
