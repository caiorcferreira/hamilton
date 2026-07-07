---
name: hamilton-init
description: "Set up an existing project for the spec-driven pipeline: explore the codebase, write an AGENTS.md capturing the project's standards, and scaffold the .hamilton/ workspace. Run once per project."
---

# Initializing a project

Prepare an existing project for the pipeline: capture how the project works in `AGENTS.md`
and create the `.hamilton/` workspace the other steps rely on. Run this once, up front.

The **pipeline** is Hamilton's spec-driven sequence for a change: propose → plan → code →
review → finish-work. Each step is a skill a person or an agent can run. This skill is
**step 0** — it runs before any change, and produces the standing project standards every
later step reads.

## What it produces

- `AGENTS.md` at the project root — the project's standing standards.
- `.hamilton/` workspace: `specs/` and `changes/`.

It does not create templates: the artifact templates are global, installed at
`~/.hamilton/templates/` by the `hamilton setup` command, and shared across projects.

## Inputs

- An existing project (a git repository).
- Anything the user wants emphasized in the standards (optional).

## Process

1. **Explore (read-only).** Learn the project: languages and versions, how it builds and
   tests, its directory layout, its conventions, and any CI. Read package manifests, config,
   and a sample of the code — do not guess. Make no edits in this step.
2. **Write `AGENTS.md`.** Cover the six standing areas below. Create the file if missing; if
   it exists, extend it rather than overwrite the user's content.
   - **Commands** — the exact build / test / lint commands, with flags.
   - **Testing** — the framework, where tests live, how to run them, coverage expectations.
   - **Project structure** — where source, tests, and docs live.
   - **Code style** — naming and formatting rules, plus one short real example from the code.
   - **Git workflow** — branch naming, commit format, pull-request conventions.
   - **Boundaries** — three tiers: Always / Ask first / Never (e.g. "Never commit secrets").
3. **Scaffold `.hamilton/`.**
   - `specs/` — canonical capability truth (starts empty).
   - `changes/` — one directory per change (starts empty).
4. **Confirm or record.** Working with a person, show the drafted `AGENTS.md` for correction
   before finishing — these standards steer every later step, so accuracy matters. Running
   unattended, record any assumptions you made.

## Principles

- **Read, don't guess.** `AGENTS.md` must reflect the real project. Wrong standards mislead
  every downstream step.
- **Don't clobber.** If `AGENTS.md` already exists, extend it and preserve what's there.
- **Idempotent.** Re-running updates `AGENTS.md` and fills any missing `.hamilton/` pieces
  without touching existing specs or changes.

## Output

`AGENTS.md` written or updated, and `.hamilton/{specs,changes}/` in place. The project is
ready for `hamilton-propose` (or `hamilton-plan` for tactical changes).

## Process flow

```dot
digraph hamilton_init {
    "Explore project (read-only)" [shape=box];
    "Write AGENTS.md\n(six standing areas)" [shape=box];
    "Scaffold .hamilton/\n(specs, changes)" [shape=box];
    "Interactive?" [shape=diamond];
    "Confirm AGENTS.md with user" [shape=box];
    "Record assumptions" [shape=box];
    "Project ready for the pipeline" [shape=doublecircle];

    "Explore project (read-only)" -> "Write AGENTS.md\n(six standing areas)";
    "Write AGENTS.md\n(six standing areas)" -> "Scaffold .hamilton/\n(specs, changes)";
    "Scaffold .hamilton/\n(specs, changes)" -> "Interactive?";
    "Interactive?" -> "Confirm AGENTS.md with user" [label="yes"];
    "Interactive?" -> "Record assumptions" [label="no"];
    "Confirm AGENTS.md with user" -> "Project ready for the pipeline";
    "Record assumptions" -> "Project ready for the pipeline";
}
```
