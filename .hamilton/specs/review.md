# Capability: review

## Overview

Hamilton separates tactical feedback on one implemented task from the final review of a complete branch. Each scope has its own inspection boundary, verdict history, freshness rules, and orchestration handoff; both approvals remain independent inputs to the finish gate.

## Contract

### Task feedback

`hamilton-code-feedback` accepts exactly one plan task, its task-local implementation evidence, its stable diff range, binding constraints, and project standards. It writes append-only passes to `tasks/task-N/feedback.md`. Each pass identifies the task, records full `Base:` and `Head:` revisions, uses `approved` or `changes-requested`, and separates located blocking findings from suggestions. A whole-branch request is outside this contract and directs the caller to `hamilton-review`.

Task feedback treats the task diff as its inspection boundary. It may inspect one concrete named risk outside the diff, but an unverified impact remains a blocking `cannot verify from diff` finding until evidence or code resolves it.

### Whole-branch review

`hamilton-review` accepts the complete branch range from its merge base, the change intent and task ledger, relevant task evidence and feedback, project standards, and the full branch diff. It writes append-only passes to root `review.md`, with full `Base:` and `Head:` revisions, the same verdict vocabulary, and separate located blocking findings and suggestions. A task-only request is rejected and directs the caller to `hamilton-code-feedback`.

The branch diff is the starting evidence, not the inspection boundary. Whole-branch review covers affected consumers and assumptions, cross-task composition, requirement and design completeness, missing documentation or specification updates, scope boundaries, and behavior that should have changed but did not. Focused verification is available for a concrete doubt; the mandatory full suite and build belong to finish-work.

### Freshness and finish gate

A task feedback pass is fresh when its full range is valid and on the current branch, and its reviewed head contains the latest commit touching that task's progress file. A whole-branch pass is fresh when its range is valid and on the current branch, its head contains the latest material change commit, and its physically last pass is valid and unblocked. Material change excludes only operational progress, task feedback, root review, and root finish bookkeeping for the active change; plan, requirements, design, specifications, maps, source, tests, skills, templates, scripts, and documentation remain material.

The finish gate requires a structurally valid all-done task ledger, fresh approved feedback without blocking findings for every active task, and a fresh approved whole-branch pass without blocking findings. The explicit freshness waiver can bypass only the whole-branch head's containment of the latest material commit; it does not waive range validity, task feedback freshness, missing artifacts, or verdicts.

## Behavior

Code feedback reviews one task against its acceptance criteria and changed lines, records a verdict in a task-owned artifact-only commit, and leaves implementation status and progress untouched. A requested change returns the same task to code; a fresh approval permits the next task. A malformed latest pass never falls back to an earlier approval.

After all active tasks have fresh approved feedback, orchestration submits the complete branch to whole-branch review. The reviewer deliberately broadens inspection, records only the root review artifact in its bookkeeping commit, and leaves task state unchanged. A requested change that fits approved intent goes through re-planning as one or more numbered remediation tasks, each using the normal code and feedback loop. A finding that invalidates approved requirements or design returns upstream instead of being hidden in implementation work.

On resume, orchestration combines the root task status, latest task feedback, and freshness before dispatching code, feedback, review, or finish. It does not reimplement approved current work merely because conversational context was lost.

**Examples**

- submit Task 3's diff -> code feedback reads Task 3's evidence, inspects only the diff plus a named risk, and appends to `tasks/task-3/feedback.md`
- a task diff cannot establish a named consumer impact -> feedback records `changes-requested` with a blocking `cannot verify from diff` item
- later code updates Task 3's progress -> its earlier feedback becomes stale and must be repeated even if it was approved
- all task feedback is fresh and approved -> orchestration sends the complete branch to whole-branch review
- an unchanged consumer still relies on an altered contract -> whole-branch review records a located blocking finding even though that consumer is outside the diff
- whole-branch findings fit approved design -> re-plan appends remediation tasks and the branch returns through code and code feedback
- whole-branch findings require a new requirement or architecture -> the flow returns to proposal rather than planning around the defect
- a fresh whole-branch approval exists -> finish-work may proceed only after its independent ledger, feedback, test, build, and cleanliness gates pass

## Invariants

- Task feedback MUST review exactly one task, and whole-branch review MUST review the complete branch; neither scope may silently act as the other.
- Verdicts MUST be `approved` or `changes-requested`, and a latest pass with blocking findings or malformed structure MUST NOT count as approved.
- Feedback and review passes MUST be committed as artifact-only bookkeeping before handoff and MUST NEVER mutate progress or sibling task artifacts.
- Stale task feedback MUST NEVER be waived by the whole-branch freshness waiver.
- Whole-branch review MUST inspect affected repository context beyond the diff and MUST NOT claim that task approvals prove branch composition.
- Finish MUST NEVER proceed from implementation completion alone; every active task and both approval classes must be current and approved.

## Decisions

- **Scope is a named contract.** Separate skills and artifacts make it impossible to confuse fast task feedback with the final merge gate without receiving an explicit boundary failure.
- **The physically last valid pass governs.** Append-only history preserves the path to approval, while fail-closed parsing prevents an older approval from hiding a malformed or contradictory latest record.
- **Freshness is commit-bound.** A verdict is meaningful only for the code and branch range it actually inspected, so task and whole-branch passes record full revisions and are checked against current ancestry.
- **Re-plan owns final remediation.** Whole-branch findings become numbered plan tasks only when they fit approved intent; architectural or requirement defects return to proposal instead of creating ownerless fixes.
- **Review focuses on uncertainty, not duplicate gates.** Whole-branch review may run the narrowest focused check for a concrete doubt, while finish-work owns mandatory full verification.
