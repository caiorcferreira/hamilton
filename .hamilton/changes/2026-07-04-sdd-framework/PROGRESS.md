# Progress — SDD framework

Working ledger for building Hamilton's spec-driven-development framework (skills +
artifacts). We are dogfooding: this change folder is itself the framework's first
change.

## Core principles

- **Skills are the single source of truth** for how to do each step, and are
  **tool-agnostic** — usable by a human in Claude Code/Opencode, by a Hamilton
  agent, or a mix (human runs step 1, hands off the rest to Hamilton). A skill must
  never assume Hamilton mechanics.
- **Agent INSTRUCTIONS.md is a thin wrapper**: "load skill X, then emit
  `write_task_output` per this schema." Hamilton-specific concerns (write_task_output,
  context templates, output schemas) live in the agent/task prompt, never in the skill.
- **Start-anywhere**: the PRD/SRS/SDD front door is optional. Every downstream skill
  degrades gracefully — consumes the upstream artifact if present, else works from the
  raw change description. Only `plan.md` is required.
- **Orchestrator owns the loop** (human or Hamilton DAG). review→code retries are
  driven by review feedback, mirroring Hamilton's existing verifier/retry model.

## Decisions (2026-07-04)

1. **Living specs + sync at finish.** `.hamilton/specs/<capability>.md` is durable
   truth. Requirements inside a change use delta headers (ADDED/MODIFIED/REMOVED/
   RENAMED); `hamilton-finish-work` folds them into the canonical spec. No separate
   sync skill.
2. **Standards mapping:** proposal = PRD (why), requirements = SRS (what,
   ISO/IEC/IEEE 29148-inspired), design = SDD (how, IEEE 1016-inspired). The
   normative "what" lives in requirements/, not design.
3. **29148-inspired, not conformant** — take the spirit (testable, unambiguous,
   normative requirements + scenarios), drop the heavy section apparatus.
4. **Pipeline:** propose → plan → code → review → finish-work. Loops handled by the
   orchestrator, not encoded as linear steps.
5. **Skills invoked by agents/tasks** — agents and task prompts still exist and matter;
   they bind skills to Hamilton.

## Pipeline (target)

| Step | Skill                  | Consumes                    | Produces            |
|------|------------------------|-----------------------------|---------------------|
| 0    | `hamilton-init`        | existing project            | AGENTS.md + `.hamilton/` scaffold (one-time) |
| 1    | `hamilton-propose`     | idea / prompt               | proposal, design, requirements |
| 2    | `hamilton-plan`        | design (or prompt)          | plan.md             |
| 3    | `hamilton-code`        | one task from plan.md       | code + self-review  |
| 4    | `hamilton-review`      | code changes                | review feedback     |
| 5    | `hamilton-finish-work` | approved work               | merge/PR/no-op + spec sync |

## Artifacts produced

- `.hamilton/templates/` — document templates (provisional location; move into skill
  package later). **Awaiting review.**
  - `proposal.md` (PRD), `design.md` (SDD)
  - `requirements-change.md` (SRS delta, lives in changes/) +
    `requirements-spec.md` (SRS canonical, lives in specs/) — split per review
  - `plan.md` (required handoff contract — TDD-sized tasks, one-task-at-a-time
    consumption, depends-on for DAG parallelism, done-when block)
  - `README.md` (index)

## Article takeaways — "How to write a good spec for AI agents" (Addy Osmani)

Source: `~/.folio/capture/how-to-write-a-good-spec-for-ai-agents.md`

Validated (already in our design): changes accumulate → consolidate into living specs;
optional heavyweight front door / start-anywhere; code self-review; reviewer-as-judge;
scale detail to task complexity.

Adopted:

- **Three-tier boundaries (Always / Ask-first / Never).** Added to design.md as a
  change-scoped section. "Ask first" is NOT `escalate_to` (that's an unimplemented early
  artifact — ignore it): a skill resolves an ask-first item by asking the user, or, when
  running unattended, the agent auto-reflects — answers the question itself and records
  the reasoning before proceeding.
- **Six core areas are project-level, not per-change.** Commands, testing, project
  structure, code style, git workflow, boundaries belong in project standards
  (AGENTS.md / guidelines / memory), consumed by hamilton-code and hamilton-review —
  never in proposal/design. A new **`hamilton-init`** skill should create AGENTS.md and
  scaffold the `.hamilton/` folder following this six-area pattern — it is the
  project-standards source.
- **Spec-referenced self-verification.** hamilton-code and hamilton-review must check
  each requirement/scenario against the output and list any unaddressed — scenarios
  (WHEN/THEN) are proto-conformance tests.
- **Plan-first, read-only exploration** in hamilton-plan before any code.
- **Small, independently-testable tasks; pull only the relevant slice** ("curse of
  instructions"). Directly shapes the plan.md schema.

## Deferred / open tasks

## Deferred / open tasks

- [x] **plan.md schema** — drafted at `.hamilton/templates/plan.md`. Awaiting review.
- [ ] Fix `requeriments` → `requirements` in the existing `hamilton-propose` skill
  (references + folder names + skill contract).
- [ ] Decide final home for templates (inside skill package) and relocate.
- [ ] **Skill↔agent unification** — refactor `feature-dev` agents (planner/developer/
  tester/verifier) and merge/pr/worktree variants to *invoke* these skills instead of
  embedding their own instructions. (Phase 4.)
- [ ] Implement the spec-sync behavior inside `hamilton-finish-work`.
- [ ] **Consolidate legacy spec systems** — `openspec/`, `.superpowers/`,
  `docs/superpowers/` all coexist. Pick canonical home (`.hamilton/`), decide
  migration/deprecation.
- [ ] Author skills one at a time, dogfooding each on a small real Hamilton change.
- [ ] End-to-end validation: run one roadmap item through the full human→Hamilton
  pipeline; log friction.
- [ ] Author **`hamilton-init`** skill — creates AGENTS.md (six core areas) and scaffolds
  `.hamilton/` (specs/, changes/, templates). This is the project-standards source that
  hamilton-code / hamilton-review load. Bridges to the guidelines/memory work.
- [ ] Encode **spec-referenced self-verification** in hamilton-code and hamilton-review
  (check each requirement/scenario, list unaddressed).
- [ ] hamilton-plan: **plan-first read-only exploration**; plan.md tasks small and
  independently testable.

## Next step

Nail the `plan.md` schema.
