import { describe, expect, it } from "vitest"
import { readSkill, section } from "./helpers.js"

const changeScopedWriters = [
  "hamilton-propose",
  "hamilton-code",
  "hamilton-code-feedback",
  "hamilton-critique",
  "hamilton-review",
  "hamilton-finish-work",
] as const

const readWriters = () =>
  Object.fromEntries(
    changeScopedWriters.map((name) => [name, readSkill(name)]),
  ) as Record<(typeof changeScopedWriters)[number], string>

const expectOrdered = (
  content: string,
  earlier: string,
  later: string,
): void => {
  const earlierIndex = content.indexOf(earlier)
  const laterIndex = content.indexOf(later, earlierIndex + earlier.length)

  expect(earlierIndex, `missing mutation marker: ${earlier}`).toBeGreaterThanOrEqual(0)
  expect(laterIndex, `missing lint marker: ${later}`).toBeGreaterThan(earlierIndex)
}

describe("change-scoped artifact lint contract", () => {
  it("covers every recognized change-scoped artifact writer", () => {
    const skills = readWriters()

    for (const name of changeScopedWriters) {
      expect(skills[name]).toContain("hamilton workbench lint")
      expect(skills[name]).toMatch(/nonzero.*lint|lint.*nonzero/is)
    }
  })

  it("uses complete-tree lint for change mutations and file lint for owned histories", () => {
    const skills = readWriters()

    for (const name of [
      "hamilton-propose",
      "hamilton-code",
    ] as const) {
      expect(skills[name]).toContain(
        "hamilton workbench lint --change-dir <change-dir>",
      )
    }

    expect(skills["hamilton-critique"]).toContain(
      "hamilton workbench lint --file <change-dir>/critique.md",
    )
    expect(skills["hamilton-code-feedback"]).toContain(
      "hamilton workbench lint --file <change-dir>/tasks/task-N/feedback.md",
    )
    expect(skills["hamilton-review"]).toContain(
      "hamilton workbench lint --file <change-dir>/review.md",
    )
    expect(skills["hamilton-finish-work"]).toContain(
      "hamilton workbench lint --file <file>",
    )
    expect(skills["hamilton-finish-work"]).toContain(
      "hamilton workbench lint --file <change-dir>/finish.md",
    )
    expect(skills["hamilton-propose"]).toContain(
      "hamilton workbench lint --file <path>",
    )
    expect(skills["hamilton-finish-work"]).toContain(
      "hamilton workbench lint --file <path>",
    )
  })

  it("runs lint after each recognized mutation and before handoff or commit", () => {
    const skills = readWriters()

    expectOrdered(
      section(skills["hamilton-propose"], "## Process"),
      "After every proposal artifact mutation",
      "hamilton workbench lint --change-dir <change-dir>",
    )
    expectOrdered(
      section(skills["hamilton-code"], "## Process"),
      "root-row transition",
      "hamilton workbench lint --change-dir <change-dir>",
    )
    expectOrdered(
      section(skills["hamilton-code-feedback"], "## Record and commit"),
      "After appending the complete pass",
      "hamilton workbench lint --file <change-dir>/tasks/task-N/feedback.md",
    )
    expectOrdered(
      section(skills["hamilton-critique"], "## Process"),
      "write the report",
      "hamilton workbench lint --file <change-dir>/critique.md",
    )
    expectOrdered(
      section(skills["hamilton-review"], "## Record and commit"),
      "After appending the complete pass",
      "hamilton workbench lint --file <change-dir>/review.md",
    )
    expectOrdered(
      section(skills["hamilton-finish-work"], "## Process"),
      "Append the template-defined `Attempt N`",
      "hamilton workbench lint --file <change-dir>/finish.md",
    )
    const proposeProcess = section(skills["hamilton-propose"], "## Process")
    const codeProcess = section(skills["hamilton-code"], "## Process")
    const feedbackRecording = section(
      skills["hamilton-code-feedback"],
      "## Record and commit",
    )
    const critiqueProcess = section(skills["hamilton-critique"], "## Process")
    const reviewRecording = section(skills["hamilton-review"], "## Record and commit")
    const finishProcess = section(skills["hamilton-finish-work"], "## Process")

    expectOrdered(
      proposeProcess,
      "hamilton workbench lint --change-dir <change-dir>",
      "the next mutation or handoff",
    )
    expectOrdered(
      codeProcess,
      "hamilton workbench lint --change-dir <change-dir>",
      "without committing or claiming compliance",
    )
    expectOrdered(
      feedbackRecording,
      "hamilton workbench lint --file <change-dir>/tasks/task-N/feedback.md",
      "before staging or",
    )
    expectOrdered(
      critiqueProcess,
      "hamilton workbench lint --file <change-dir>/critique.md",
      "before printing it or handing it off",
    )
    expectOrdered(
      reviewRecording,
      "hamilton workbench lint --file <change-dir>/review.md",
      "before staging or",
    )
    expectOrdered(
      finishProcess,
      "hamilton workbench lint --file <change-dir>/finish.md",
      "Commit that attempt alone",
    )
  })

  it("preserves semantic and authorship gates around lint", () => {
    const skills = readWriters()

    expect(skills["hamilton-propose"]).toMatch(
      /git config user\.name[\s\S]*git config user\.email/i,
    )
    expect(skills["hamilton-propose"]).toMatch(
      /On a revision[\s\S]*preserve.*existing.*author attribution/i,
    )
    expect(skills["hamilton-finish-work"]).toMatch(
      /git config user\.name[\s\S]*git config user\.email/i,
    )
    expect(skills["hamilton-finish-work"]).toMatch(
      /existing canonical spec[\s\S]*preserve.*author metadata exactly/i,
    )
    expect(skills["hamilton-code-feedback"]).toMatch(
      /lint.*before stag(?:e|ing).*commit/is,
    )
    expect(skills["hamilton-review"]).toMatch(/lint.*before stag(?:e|ing).*commit/is)
    expect(skills["hamilton-finish-work"]).toMatch(
      /lint.*does not replace.*(?:freshness|ancestry|completion|semantic)/is,
    )
  })
})
