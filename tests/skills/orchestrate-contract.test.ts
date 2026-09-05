import * as Fs from "node:fs"
import { describe, expect, it } from "vitest"
import { readSkill, section } from "./helpers.js"

const skill = readSkill("hamilton-orchestrate")
const referenceUrl = (name: string) =>
  new URL(`../../skills/hamilton-orchestrate/references/${name}`, import.meta.url)
const readReference = (name: string): string => {
  const path = referenceUrl(name)
  return Fs.existsSync(path) ? Fs.readFileSync(path, "utf-8") : ""
}
const singleLine = (content: string): string => content.replace(/\s+/g, " ")

describe("hamilton-orchestrate task resume contract", () => {
  const matrix = singleLine(section(skill, "## Task resume matrix"))

  it("dispatches code for a pending task", () => {
    expect(matrix).toMatch(/\| `pending` \| any \| Dispatch `hamilton-code`/)
  })

  it("dispatches code for a blocked task", () => {
    expect(matrix).toMatch(/\| `blocked` \| any \| Dispatch `hamilton-code`/)
  })

  it("inspects an interrupted in-progress task before dispatch", () => {
    expect(matrix).toMatch(
      /\| `in-progress` \| any \| Inspect Task N's git state and task-local log before resuming or resolving it/,
    )
  })

  it("dispatches code feedback when feedback is absent", () => {
    expect(matrix).toMatch(
      /\| `done` \| absent \| Dispatch `hamilton-code-feedback`/,
    )
  })

  it("dispatches code feedback when feedback is stale", () => {
    expect(matrix).toMatch(
      /\| `done` \| stale or malformed \| Dispatch `hamilton-code-feedback`/,
    )
  })

  it("returns fresh changes-requested feedback to code", () => {
    expect(matrix).toMatch(
      /\| `done` \| fresh `changes-requested` \| Dispatch `hamilton-code` with `tasks\/task-N\/feedback\.md`/,
    )
  })

  it("advances only after fresh task approval", () => {
    expect(matrix).toMatch(
      /\| `done` \| fresh `approved` with no blocking findings \| Advance to the next active task or the whole-branch gate/,
    )
  })
})

describe("hamilton-orchestrate whole-branch resume contract", () => {
  const matrix = singleLine(section(skill, "## Whole-branch resume matrix"))

  it("dispatches whole-branch review when review is absent", () => {
    expect(matrix).toMatch(/\| absent \| Dispatch `hamilton-review`/)
  })

  it("dispatches whole-branch review when review is malformed or stale", () => {
    expect(matrix).toMatch(/\| stale or malformed \| Dispatch `hamilton-review`/)
  })

  it("routes fresh requested changes through classification", () => {
    expect(matrix).toMatch(
      /\| fresh `changes-requested` \| Classify the complete finding set for re-plan or the upstream-defect stop/,
    )
  })

  it("hands fresh approval to finish-work", () => {
    expect(matrix).toMatch(
      /\| fresh `approved` with no blocking findings \| Hand off to `hamilton-finish-work`/,
    )
  })
})

describe("hamilton-orchestrate checkpoint and evidence contract", () => {
  const process = singleLine(section(skill, "## Process"))
  const implementer = readReference("implementer-prompt.md")
  const codeFeedback = readReference("code-feedback-prompt.md")
  const wholeBranch = readReference("whole-branch-review-prompt.md")

  it("orders the stable checkpoint, code, feedback, and next task", () => {
    const checkpoint = process.indexOf("Record or reuse the task checkpoint")
    const code = process.indexOf("Dispatch `hamilton-code`")
    const packageDiff = process.indexOf("Package the task diff")
    const feedback = process.indexOf("Dispatch `hamilton-code-feedback`")
    const commit = process.indexOf("Confirm the feedback artifact-only commit")
    const advance = process.indexOf("Select the next active task")

    expect(checkpoint).toBeGreaterThanOrEqual(0)
    expect(code).toBeGreaterThan(checkpoint)
    expect(packageDiff).toBeGreaterThan(code)
    expect(feedback).toBeGreaterThan(packageDiff)
    expect(commit).toBeGreaterThan(feedback)
    expect(advance).toBeGreaterThan(commit)
  })

  it("records one task-local base and preserves it across corrections", () => {
    expect(skill).toContain("<change-dir>/tasks/task-N/.base")
    expect(process).toContain(
      "hamilton-diff-package.sh --record --task N --change-dir <change-dir>",
    )
    expect(skill).toMatch(/recorded once.*never overwritten/is)
  })

  it("uses task progress as the sole detailed implementer report", () => {
    expect(skill).toMatch(/task progress is the only detailed implementer report/i)
    expect(implementer).toContain("<change-dir>/tasks/task-N/progress.md")
    expect(implementer).toMatch(/return only.*status.*commit/is)
    expect([skill, implementer, codeFeedback, wholeBranch].join("\n")).not.toContain(
      "[REPORT_FILE]",
    )
  })

  it("requires each feedback artifact to be committed before the next checkpoint", () => {
    expect(process).toMatch(
      /Confirm the feedback artifact-only commit.*only `tasks\/task-N\/feedback\.md`.*before.*Select the next active task/is,
    )
  })
})

describe("hamilton-orchestrate prompt scopes", () => {
  const implementer = readReference("implementer-prompt.md")
  const codeFeedback = readReference("code-feedback-prompt.md")
  const wholeBranch = readReference("whole-branch-review-prompt.md")

  it("ships distinct task-feedback and whole-branch prompt files", () => {
    expect(Fs.existsSync(referenceUrl("code-feedback-prompt.md"))).toBe(true)
    expect(Fs.existsSync(referenceUrl("whole-branch-review-prompt.md"))).toBe(true)
    expect(Fs.existsSync(referenceUrl("reviewer-prompt.md"))).toBe(false)
    expect(skill).toContain("references/code-feedback-prompt.md")
    expect(skill).toContain("references/whole-branch-review-prompt.md")
    expect(codeFeedback).not.toBe(wholeBranch)
  })

  it("binds task feedback to one task range and destination", () => {
    expect(codeFeedback).toContain("hamilton-code-feedback")
    expect(codeFeedback).toContain("Task [N]")
    expect(codeFeedback).toContain("Base: [BASE_SHA]")
    expect(codeFeedback).toContain("Head: [HEAD_SHA]")
    expect(codeFeedback).toContain("<change-dir>/tasks/task-N/progress.md")
    expect(codeFeedback).toContain("<change-dir>/tasks/task-N/feedback.md")
    expect(codeFeedback).toMatch(/bounded inspection/i)
  })

  it("binds whole-branch review to the complete branch and root destination", () => {
    expect(wholeBranch).toContain("hamilton-review")
    expect(wholeBranch).toContain("Base: [MERGE_BASE_SHA]")
    expect(wholeBranch).toContain("Head: [HEAD_SHA]")
    expect(wholeBranch).toMatch(/complete branch diff/i)
    expect(wholeBranch).toContain("<change-dir>/review.md")
    expect(wholeBranch).toMatch(/broader repository/i)
  })
})

describe("hamilton-orchestrate whole-branch findings", () => {
  const findings = singleLine(section(skill, "## Whole-branch findings"))

  it("re-plans implementation findings as numbered remediation tasks", () => {
    expect(findings).toMatch(/complete finding set.*`hamilton-plan` in re-plan mode/is)
    expect(findings).toMatch(/one or more.*numbered remediation tasks/is)
    expect(findings).toMatch(/each.*ordinary `hamilton-code`.*`hamilton-code-feedback` loop/is)
    expect(findings).toMatch(/repeat.*whole-branch review/is)
  })

  it("stops upstream when findings invalidate approved artifacts", () => {
    expect(findings).toMatch(
      /requires changing an approved requirement or design decision.*stop.*`hamilton-propose`/is,
    )
  })

  it("forbids ownerless, retroactive, and synthetic fixes", () => {
    expect(findings).not.toMatch(/fix wave/i)
    expect(findings).toMatch(/Frozen completed tasks remain unchanged/i)
    expect(findings).toMatch(/every correction.*numbered active task present in `plan\.md`/i)
  })
})
