import * as Fs from "node:fs"
import { describe, expect, it } from "vitest"
import { readSkill, section } from "./helpers.js"

const skill = readSkill("kepler-orchestrate")
const referenceUrl = (name: string) =>
  new URL(`../../skills/kepler-orchestrate/references/${name}`, import.meta.url)
const readReference = (name: string): string => {
  const path = referenceUrl(name)
  return Fs.existsSync(path) ? Fs.readFileSync(path, "utf-8") : ""
}
const singleLine = (content: string): string => content.replace(/\s+/g, " ")

describe("kepler-orchestrate task resume contract", () => {
  const matrix = singleLine(section(skill, "## Task resume matrix"))

  it("dispatches code for a pending task", () => {
    expect(matrix).toMatch(/\| `pending` \| any \| Dispatch `kepler-code`/)
  })

  it("dispatches code for a blocked task", () => {
    expect(matrix).toMatch(/\| `blocked` \| any \| Dispatch `kepler-code`/)
  })

  it("inspects an interrupted in-progress task before dispatch", () => {
    expect(matrix).toMatch(
      /\| `in-progress` \| any \| Inspect Task N's git state and task-local log before resuming or resolving it/,
    )
  })

  it("dispatches code feedback when feedback is absent", () => {
    expect(matrix).toMatch(
      /\| `done` \| absent \| Dispatch `kepler-code-feedback`/,
    )
  })

  it("dispatches code feedback when feedback is stale", () => {
    expect(matrix).toMatch(
      /\| `done` \| stale or lint-invalid \| Dispatch `kepler-code-feedback`/,
    )
  })

  it("keeps a lint-valid skipped task pass from authorizing advancement", () => {
    expect(matrix).toMatch(
      /\| `done` \| fresh `skipped` \| Dispatch `kepler-code-feedback`.*artifact is valid but does not approve the task/,
    )
  })

  it("returns ordinary fresh changes-requested feedback to code", () => {
    expect(matrix).toMatch(
      /\| `done` \| fresh `changes-requested` with no canonical unresolved `cannot verify from diff` Blocking item \| Dispatch `kepler-code` with `tasks\/task-N\/feedback\.md`/,
    )
  })

  it("adjudicates a canonical unresolved feedback item before routing", () => {
    expect(matrix).toMatch(
      /\| `done` \| fresh `changes-requested` with a canonical unresolved `cannot verify from diff` Blocking item \| Driver adjudicates the concrete named risk before code or advancement/,
    )
  })

  it("advances only after fresh task approval", () => {
    expect(matrix).toMatch(
      /\| `done` \| durable, fresh `approved` with no blocking findings \| Advance to the next active task or the whole-branch gate/,
    )
  })

  it("routes worktree-only and mixed-commit approvals back to feedback", () => {
    expect(matrix).toMatch(
      /\| `done` \| feedback untracked or changed from `HEAD` \| Dispatch `kepler-code-feedback`/,
    )
    expect(matrix).toMatch(
      /\| `done` \| latest feedback-touching commit is mixed \| Dispatch `kepler-code-feedback`/,
    )
  })
})

describe("kepler-orchestrate TDD refactor handoff contract", () => {
  const handoff = singleLine(section(skill, "## TDD refactor handoff"))
  const process = singleLine(section(skill, "## Process"))
  const implementer = singleLine(readReference("implementer-prompt.md"))
  const codeFeedback = singleLine(readReference("code-feedback-prompt.md"))

  it("names code feedback as the refactor-phase gate after green implementation", () => {
    expect(handoff).toMatch(
      /green implementation.*not an advancement point.*existing `kepler-code-feedback` dispatch.*refactor-phase review/is,
    )
  })

  it("requires task-local red-green-refactor or exception evidence", () => {
    expect(implementer).toMatch(
      /task-local.*red\/green\/refactor.*commands and observed results/is,
    )
    expect(implementer).toMatch(
      /conventional red check.*exception reason.*repeatable alternative verification/is,
    )
  })

  it("supplies TDD evidence and bounded context to feedback", () => {
    expect(codeFeedback).toContain("[TDD_EVIDENCE]")
    expect(codeFeedback).toContain("[PROJECT_STANDARDS]")
    expect(codeFeedback).toMatch(
      /task acceptance.*stable task diff.*project standards.*bounded located-risk context/is,
    )
  })

  it("routes requested refactors through correction verification and fresh feedback", () => {
    expect(handoff).toMatch(
      /changes-requested.*same Task N.*kepler-code.*relevant verification.*fresh.*kepler-code-feedback/is,
    )
    expect(process).toMatch(
      /refactor-phase review.*changes-requested.*same Task N.*relevant verification/is,
    )
  })

  it("advances only after a fresh durable approved feedback pass", () => {
    expect(handoff).toMatch(
      /Only a fresh durable `approved` feedback pass.*another task or the whole-branch gate/is,
    )
    expect(implementer).toContain("refactor-phase review")
    expect(codeFeedback).toContain("refactor-phase review")
  })
})

describe("kepler-orchestrate whole-branch resume contract", () => {
  const matrix = singleLine(section(skill, "## Whole-branch resume matrix"))

  it("dispatches whole-branch review when review is absent", () => {
    expect(matrix).toMatch(/\| absent \| Dispatch `kepler-review`/)
  })

  it("dispatches whole-branch review when review is malformed or stale", () => {
    expect(matrix).toMatch(/\| stale or lint-invalid \| Dispatch `kepler-review`/)
  })

  it("keeps a lint-valid skipped branch pass from authorizing finish", () => {
    expect(matrix).toMatch(
      /\| fresh `skipped` \| Dispatch `kepler-review`.*artifact is valid but does not approve the branch/,
    )
  })

  it("routes fresh requested changes through classification", () => {
    expect(matrix).toMatch(
      /\| fresh `changes-requested` \| Classify the complete finding set for re-plan or the upstream-defect stop/,
    )
  })

  it("hands fresh approval to finish-work", () => {
    expect(matrix).toMatch(
      /\| fresh `approved` with no blocking findings \| Hand off to `kepler-finish-work`/,
    )
  })
})

describe("kepler-orchestrate checkpoint and evidence contract", () => {
  const process = singleLine(section(skill, "## Process"))
  const checkpointRules = singleLine(
    section(skill, "## Checkpoint establishment and recovery"),
  )
  const codeFeedback = readReference("code-feedback-prompt.md")
  const wholeBranch = readReference("whole-branch-review-prompt.md")

  it("orders the stable checkpoint, code, feedback, and next task", () => {
    const checkpoint = process.indexOf("Resolve and validate the task checkpoint")
    const code = process.indexOf("Dispatch `kepler-code`")
    const packageDiff = process.indexOf("Package the task diff")
    const feedback = process.indexOf("Dispatch `kepler-code-feedback`")
    const commit = process.indexOf("Confirm the feedback artifact-only commit")
    const advance = process.indexOf("Select the next active task")

    expect(checkpoint).toBeGreaterThanOrEqual(0)
    expect(code).toBeGreaterThan(checkpoint)
    expect(packageDiff).toBeGreaterThan(code)
    expect(feedback).toBeGreaterThan(packageDiff)
    expect(commit).toBeGreaterThan(feedback)
    expect(advance).toBeGreaterThan(commit)
  })

  it("creates a task-local base only before a genuine first attempt", () => {
    expect(skill).toContain("<change-dir>/tasks/task-N/.base")
    expect(process).toContain(
      "kepler workbench diff --record --task N --change-dir <change-dir>",
    )
    expect(checkpointRules).toMatch(
      /only when.*root row is `pending`.*task log has no `## Attempt`.*feedback.*absent.*no task-owned implementation changes/is,
    )
    expect(checkpointRules).toMatch(/record current `HEAD` as the checkpoint/i)
    expect(process).not.toMatch(
      /before any first attempt, retry, or correction dispatch.*--record/is,
    )
    expect(process).not.toContain("~/.kepler/scripts/")
  })

  it("reconstructs or stops instead of rebasing historical work", () => {
    expect(checkpointRules).toMatch(
      /historical evidence exists when.*status.*other than `pending`.*`## Attempt`.*feedback/is,
    )
    expect(checkpointRules).toMatch(
      /missing or malformed.*unambiguous durable git, task, and feedback evidence/is,
    )
    expect(checkpointRules).toMatch(
      /valid feedback `Base:`.*first parent.*earliest commit.*first task attempt/is,
    )
    expect(checkpointRules).toMatch(/every available candidate.*same full commit/i)
    expect(checkpointRules).toMatch(
      /existing checkpoint.*historical evidence.*match.*candidate.*precede the first implementation attempt/is,
    )
    expect(checkpointRules).toMatch(/otherwise stop.*intervention/i)
    expect(checkpointRules).toMatch(/never.*current `HEAD`.*historical evidence/is)
  })

  it("makes the implementer preserve rather than create a checkpoint", () => {
    const implementer = singleLine(readReference("implementer-prompt.md"))
    expect(implementer).not.toMatch(/preserve or create/i)
    expect(implementer).toMatch(
      /validate and preserve the already-recorded task-local checkpoint.*never create/is,
    )
  })

  it("uses task progress as the sole detailed implementer report", () => {
    const implementer = singleLine(readReference("implementer-prompt.md"))
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

  it("defines one exact durable task approval predicate", () => {
    const approval = singleLine(section(skill, "## Durable task approval"))

    expect(approval).toMatch(/tracked at current `HEAD`.*`git ls-files --error-unmatch`/is)
    expect(approval).toMatch(
      /index.*unchanged from current `HEAD`.*`git diff --cached --quiet HEAD --`/is,
    )
    expect(approval).toMatch(
      /worktree.*unchanged from the index.*`git diff --quiet --`/is,
    )
    expect(approval).toMatch(
      /staged.*differs.*worktree.*matches.*`HEAD`.*fail/is,
    )
    expect(approval).toMatch(/latest commit that touched.*feedback.*artifact-only/is)
    expect(approval).toMatch(/commit's path list.*only.*tasks\/task-N\/feedback\.md/is)
    expect(approval).toMatch(
      /lint accepts the feedback artifact.*physical last pass.*`approved`.*no blocking findings.*fresh/is,
    )
    expect(approval).toMatch(/any failed condition.*dispatch `kepler-code-feedback`/is)
  })

  it("rechecks durable approval at every advancement boundary", () => {
    expect(process).toMatch(/Load durable state.*evaluate.*durable task approval/is)
    expect(process).toMatch(
      /Confirm the feedback artifact-only commit.*re-evaluate.*durable task approval/is,
    )
    expect(process).toMatch(
      /before.*recording.*next task checkpoint.*re-evaluate.*durable task approval/is,
    )
    expect(process).toMatch(
      /before.*whole-branch gate.*re-evaluate.*durable task approval.*every active task/is,
    )
    expect(process).toMatch(/never.*transient.*subagent output.*worktree text.*advance/is)
  })
})

describe("kepler-orchestrate prompt scopes", () => {
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
    expect(codeFeedback).toContain("kepler-code-feedback")
    expect(codeFeedback).toContain("Task [N]")
    expect(codeFeedback).toContain("Base: [BASE_SHA]")
    expect(codeFeedback).toContain("Head: [HEAD_SHA]")
    expect(codeFeedback).toContain("<change-dir>/tasks/task-N/progress.md")
    expect(codeFeedback).toContain("<change-dir>/tasks/task-N/feedback.md")
    expect(codeFeedback).toContain("kepler workbench lint --change-dir <change-dir>")
    expect(codeFeedback).toMatch(/only lint decides whether their format is valid/is)
    expect(codeFeedback).toMatch(/follow kepler-code-feedback's.*append.*commit rules/is)
    expect(codeFeedback).toMatch(/do not impose a second template or pass-shape validator/is)
    expect(codeFeedback).toMatch(/bounded inspection/i)
  })

  it("supplies optional located evidence for a same-head feedback pass", () => {
    const process = singleLine(section(skill, "## Process"))

    expect(codeFeedback).toContain("## Located evidence")
    expect(codeFeedback).toContain("[LOCATED_EVIDENCE_OR_NONE]")
    expect(codeFeedback).toMatch(/exact named cross-task evidence/i)
    expect(codeFeedback).toMatch(/same supplied `Head`/i)
    expect(codeFeedback).toMatch(/new physical pass/i)
    expect(process).toMatch(
      /located evidence resolves.*re-dispatch.*same Base and Head.*new physical pass/is,
    )
  })

  it("routes a confirmed unresolved gap back to code", () => {
    const process = singleLine(section(skill, "## Process"))

    expect(process).toMatch(
      /confirmed code gap.*dispatch `kepler-code`.*feedback.*located gap/is,
    )
  })

  it("binds whole-branch review to the complete branch and root destination", () => {
    expect(wholeBranch).toContain("kepler-review")
    expect(wholeBranch).toContain("Base: [MERGE_BASE_SHA]")
    expect(wholeBranch).toContain("Head: [HEAD_SHA]")
    expect(wholeBranch).toMatch(/complete branch diff/i)
    expect(wholeBranch).toContain("<change-dir>/review.md")
    expect(wholeBranch).toContain("kepler workbench lint --change-dir <change-dir>")
    expect(wholeBranch).toMatch(/only lint decides whether their format is valid/is)
    expect(wholeBranch).toMatch(/follow kepler-review's.*append.*commit rules/is)
    expect(wholeBranch).toMatch(/do not impose a second template or pass-shape\s+validator/is)
    expect(wholeBranch).toMatch(/broader repository/i)
  })

  it("delegates pass formatting to lint instead of duplicating a producer validator", () => {
    for (const prompt of [codeFeedback, wholeBranch]) {
      expect(prompt).toMatch(/only lint decides whether their format is valid/is)
      expect(prompt).toMatch(/do not impose a second template or pass-shape\s+validator/is)
      expect(prompt).not.toMatch(/fail closed for partial globals/i)
      expect(prompt).not.toMatch(/each appended pass records exactly one full/i)
    }
  })
})

describe("kepler-orchestrate whole-branch findings", () => {
  const findings = singleLine(section(skill, "## Whole-branch findings"))

  it("re-plans implementation findings as numbered remediation tasks", () => {
    expect(findings).toMatch(/complete finding set.*`kepler-plan` in re-plan mode/is)
    expect(findings).toMatch(/one or more.*numbered remediation tasks/is)
    expect(findings).toMatch(/each.*ordinary `kepler-code`.*`kepler-code-feedback` loop/is)
    expect(findings).toMatch(/repeat.*whole-branch review/is)
  })

  it("stops upstream when findings invalidate approved artifacts", () => {
    expect(findings).toMatch(
      /requires changing an approved requirement or design decision.*stop.*`kepler-propose`/is,
    )
  })

  it("forbids ownerless, retroactive, and synthetic fixes", () => {
    expect(findings).not.toMatch(/fix wave/i)
    expect(findings).toMatch(/Frozen completed tasks remain unchanged/i)
    expect(findings).toMatch(/every correction.*numbered active task present in `plan\.md`/i)
  })
})
