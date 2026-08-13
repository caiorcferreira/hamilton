---
name: hamilton-propose
description: "Turn an idea into a change's proposal, requirements, and design through collaborative dialogue — proposal.md (why), requirements/ (what), design.md (how). The heavyweight front door; tactical changes skip it and start at hamilton-plan."
---

# Proposing a change

Turn an idea into a well-formed change by writing its proposal (why), requirements (what),
and design (how) — refined with the user through dialogue before any implementation begins.

The **pipeline** is Hamilton's spec-driven sequence for a change: propose → plan → code →
review → finish-work. Each step is a skill a person or an agent can run. This skill is
**step 1** — the optional heavyweight front door that produces the PRD, the SRS, and the
SDD. A change that does not warrant that depth skips this step and starts at `hamilton-plan`.

**Gate.** Do not move to implementation — no `hamilton-plan`, no code — until the artifacts
are approved and the design clears the `references/code-quality.md` self-review: for a
non-trivial change, an unresolved structural smell blocks the gate (see step 10).

## What it produces

In `.hamilton/changes/<YYYY-MM-DD-title>/`, using the templates at `~/.hamilton/templates/`:

- `proposal.md` — the PRD: why, what changes, and the capabilities affected.
- `requirements/<capability>.md` — the SRS (delta form) for each capability.
- `design.md` — the SDD: how it will be built.

## Inputs

- A change idea or request. If none is given, ask what to build.
- The project's canonical specs (`.hamilton/specs/`) — the current requirement truth for each
  capability. Read them to tell new capabilities from modified ones, and to keep the proposal
  and requirements consistent with the conventions and decisions already committed.
- Project standards (`AGENTS.md`).

## References

This skill ships with a `references/` folder. Read reference files using the Read tool on
the skill's own directory — they are co-located with this SKILL.md, **not** at
`~/.hamilton/` or `~/.hamilton/templates/`.

- `references/code-quality.md` — the self-review rubric for design quality.

## Principles

- **Collaborate.** Refine through dialogue — confirm each section before moving on.
- **High-level first.** Start from the user's goal; draft, then elaborate together.
- **YAGNI.** Cut unnecessary scope from every artifact.
- **Explore alternatives.** Offer 2–3 approaches with trade-offs and a recommendation
  before settling on a design.
- **Design for quality.** Code quality is decided here, not at review. The decomposition,
  boundaries, and dependencies the design commits to are inherited by every line the coder
  later writes — and a defect caught at review means refactoring code that already exists.
  Judge the design against `references/code-quality.md` (read it from this skill's
  references directory), proportional to the change's size.
- **Right-size.** Scale each artifact to the change; a few sentences is fine when the
  change is simple.
- **Write flowing prose.** In every artifact you produce (`proposal.md`, `requirements/`,
  `design.md`), let paragraphs run as continuous lines — do not hard-wrap text at ~80
  characters or any fixed width. Insert a line break only at a real boundary: between
  paragraphs, list items, or headings. Soft-wrapping is the reader's job, not yours.

## Process

1. **Goal discovery.** Derive a kebab-case title from the request — unless the request points
   at a `.hamilton/maps/<effort>/` folder containing a `route.md`, in which case enter
   map-aware mode: read `route.md` from the current working tree (step 2's worktree, if it
   creates one, is based off the current branch, so its copy matches what this step read),
   scan the `### N.` units in order for the first whose `Status:` line reads `pending`, and
   derive the title from that unit's name (the heading text after `### N.`); if no unit is
   `pending`, stop and tell the user that every unit is already in-progress or shipped.
2. **Ensure an isolated workspace — then confirm you are inside it.** Detect isolation: if
   you are already in a linked worktree (`git rev-parse --git-dir` differs from
   `--git-common-dir`, and you are not in a submodule) or on a dedicated branch (not the
   repo's default branch), work in place. Otherwise create a worktree on a new branch, both
   named for the change, under the git-ignored `.worktrees/` directory:

   ```bash
   git worktree add .worktrees/<title> -b <title>
   cd .worktrees/<title>
   git rev-parse --show-toplevel   # MUST print the .worktrees/<title> path
   ```

   Creating the worktree does **not** move you into it — a fresh `git worktree add` leaves your
   shell and every file tool rooted in the original checkout. You must `cd` into the worktree and
   then **verify the switch took effect** before creating any files: run
   `git rev-parse --show-toplevel` and confirm the output ends in `.worktrees/<title>`. **Do not
   proceed to step 3 until it does.** If you skip this check you will silently write every
   artifact on the default branch — the exact failure this step exists to prevent. From here on,
   the change directory and every artifact are created **inside** `.worktrees/<title>/`, never in
   the original checkout.

   In map-aware mode, now flip the selected unit's `Status:` to `in-progress` in the worktree's
   copy of `route.md` — and, if no other unit is `in-progress` or `shipped`, flip the map's
   `status:` to `shipping` in `map.md` — then commit the flips with the change scaffolding
   (step 3). The claim rides the branch, so it ships with the work it marks.
3. **Set up the change.** Create `.hamilton/changes/<YYYY-MM-DD-title>/`.
4. **Explore context (read-only).** Project structure, docs, recent commits, and the canonical
   specs (`.hamilton/specs/`). Read the specs before drafting: they hold the conventions and
   prior decisions the change inherits, so a MODIFIED capability builds on the behavior its
   canonical spec already documents (human-readable prose — Overview / Contract / Behavior /
   Invariants / Decisions) rather than contradicting it. When step 1 entered map-aware mode,
   also navigate the selected unit's `Backed by:` links — reading each linked
   `tickets/NN-slug.md` to pull the full decision context — and feed it into this exploration.
   If the unit has no `Backed by:` line, proceed with its route entry's goal paragraph alone.
   If the request spans several independent subsystems, stop and help decompose it first —
   one change per spec.
5. **Ask clarifying questions.** Draw out purpose, constraints, and success criteria from
   the requester (a person, or the calling agent). Attended, invoke `hamilton-grilling`
   with those questions as content and "intent is clear" as the exit condition.
   Unattended, record a reasonable choice as an assumption.
6. **Write the proposal (why).** Draft `proposal.md`: problem, goals/non-goals, what
   changes, and the Capabilities list (new vs modified — check `.hamilton/specs/` for
   existing names). The Capabilities list is the contract into the requirements. In
   map-aware mode, fill the header's `Route unit` field with the route path and unit
   number — it is the provenance link every downstream step follows back to the map.

   **Right-size the capabilities — coarse, durable domains, not per-aspect shards.** Each
   capability becomes one `requirements/<capability>.md` and, downstream, one spec file, so
   over-splitting here multiplies files through the whole pipeline. A capability is a
   coherent area of behavior a reader would recognize as a top-level concern of the system —
   not a mechanism, a config surface, an integration point, a single module, or a wiring/
   startup step. Aim for the fewest capabilities that cover the change without overlap. You
   have over-split when names are adjective+noun sub-aspects of one domain
   (`structured-logging`, `distributed-tracing` are both just logging/tracing), name a single
   file or bootstrap step (`server-startup`), or describe a detail shared by two others
   (`trace-log-correlation` folds into logging + tracing). Prefer the durable domain noun and
   let its requirement cover the aspects.

   | Over-split (bad) | Right-sized (good) |
   |------------------|--------------------|
   | `application-metrics.md`, `distributed-tracing.md`, `structured-logging.md`, `trace-log-correlation.md`, `http-clients.md`, `aws-config.md`, `server-startup.md` | `metrics.md`, `tracing.md`, `logging.md`, `http-client.md`, `aws.md` |
   | `login-endpoint.md`, `password-reset.md`, `jwt-refresh.md`, `oauth-google.md`, `oauth-github.md`, `role-check-middleware.md` | `authentication.md`, `authorization.md` |
   | `stripe-integration.md`, `payment-webhooks.md`, `refund-processing.md`, `invoice-generation.md`, `dunning-emails.md` | `payments.md`, `billing.md` |
7. **Write the requirements (what).** For each capability named in the proposal, write
   `requirements/<capability>.md` in delta form (ADDED / MODIFIED / REMOVED / RENAMED), with
   normative SHALL statements and WHEN/THEN scenarios. These change-side deltas keep the
   structured form regardless of how the canonical spec reads. For MODIFIED, there is no
   requirement block to copy — the canonical spec is prose; instead read the behavior its
   relevant section documents, then write a MODIFIED requirement that names the behavior it
   changes clearly enough for finish-work to locate the spec section, and states the *whole* new
   behavior (not just the diff).
8. **Propose 2–3 approaches.** Before designing, lay out two or three ways to build it
   with their trade-offs and a recommendation. Attended, invoke `hamilton-grilling` with
   the approaches as content and "an approach is chosen" as the exit condition.
   Unattended, pick the recommended approach and record the reasoning.
9. **Write the design (how).** From the chosen approach, write `design.md`: context,
   decisions (with the alternatives considered), architecture, testing strategy, risks, and
   any change-specific boundaries. As you shape the architecture and components, apply
   `references/code-quality.md` (read from this skill's references directory) — cohesive
   units with one reason to change, narrow boundaries, inverted dependencies with named
   testable seams — sized to the change, not gold-plated. Capture the outcome in the
   design's **Quality Lens** subsection (one line for a trivial change).
10. **Self-review each artifact.** First confirm the workspace: `git rev-parse --show-toplevel`
    ends in `.worktrees/<title>` (or you were legitimately working in place per step 2) and every
    artifact was written under that root, not the default checkout. Then scan for placeholders,
    contradictions, scope creep, and ambiguity; fix in place. Then run `design.md` against
    `references/code-quality.md`.
    **Blocking:** for a non-trivial change — one that adds or restructures units, not a
    mechanical or single-file edit — an unresolved structural smell (a unit with more than one
    reason to change, a leaked boundary, a hard-wired dependency with no testable seam) is a
    gate failure. Fix the structure, or, if you are deliberately accepting it, record it in
    the design's **Quality Lens** subsection (and cross-list under Risks / Trade-offs). Do
    not pass the gate with a silent smell — a weak coder cannot recover quality the design
    did not encode.
11. **Get approval.** Present the artifacts for review. Attended, invoke
    `hamilton-grilling` with the revision feedback as content and "artifacts approved"
    as the exit condition. Unattended, record open questions. Do not pass the gate
    until approved.

## Output

`proposal.md`, `requirements/<capability>.md`, and `design.md` in the change directory —
reviewed and approved, ready for `hamilton-plan`.

## Handoff

- **Disclose the workspace.** If step 2 created a worktree for this change, state its path
  (`.worktrees/<title>`) and branch — the artifacts, and all the work to come, live there, not
  in the original checkout. If you worked in place, name that branch.
- **Name the next step.** With the artifacts approved (step 11), what follows is `hamilton-plan`.
- **Hand back the decision.** The step-11 gate already requires approval before proceeding:
  ask whether to move on to `hamilton-plan` rather than declaring readiness, and never invoke
  it yourself. Running unattended, record open questions, name the next step, and return.

## Process flow

```dot
digraph hamilton_propose {
    "Goal discovery\n(title + map-aware route read)" [shape=box];
    "Ensure isolated workspace\n(worktree if on default branch)" [shape=box];
    "Set up change dir" [shape=box];
    "Explore context (read-only)" [shape=box];
    "Ask clarifying questions" [shape=box];
    "Proposal — why\n(problem, goals, capabilities)" [shape=box];
    "Requirements — what\n(SRS delta per capability)" [shape=box];
    "Propose 2–3 approaches\n(trade-offs + recommendation)" [shape=box];
    "Design — how\n(chosen approach -> design.md)" [shape=box];
    "Self-review each artifact" [shape=box];
    "Approved?" [shape=diamond];
    "Ready for hamilton-plan" [shape=doublecircle];

    "Goal discovery\n(title + map-aware route read)" -> "Ensure isolated workspace\n(worktree if on default branch)";
    "Ensure isolated workspace\n(worktree if on default branch)" -> "Set up change dir";
    "Set up change dir" -> "Explore context (read-only)";
    "Explore context (read-only)" -> "Ask clarifying questions";
    "Ask clarifying questions" -> "Proposal — why\n(problem, goals, capabilities)";
    "Proposal — why\n(problem, goals, capabilities)" -> "Requirements — what\n(SRS delta per capability)";
    "Requirements — what\n(SRS delta per capability)" -> "Propose 2–3 approaches\n(trade-offs + recommendation)";
    "Propose 2–3 approaches\n(trade-offs + recommendation)" -> "Design — how\n(chosen approach -> design.md)";
    "Design — how\n(chosen approach -> design.md)" -> "Self-review each artifact";
    "Self-review each artifact" -> "Approved?";
    "Approved?" -> "Ask clarifying questions" [label="changes requested"];
    "Approved?" -> "Ready for hamilton-plan" [label="approved"];
}
```
