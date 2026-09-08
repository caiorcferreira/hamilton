# Hamilton mode

> **Hamilton is in ALPHA.** Everything here can change without notice, and there are no
> backward-compatibility guarantees.

Hamilton is a coding toolbox focused on producing high-quality code and architecture. As of 0.3.0 it
has a single mode: **Assisted** — a portable, tool-agnostic bundle of spec-driven skills that carry a
change from idea to merge, driven by you and any coding agent. The Autonomous workflow engine and
Ambient memory layer were removed; the last full-feature state is preserved on the
`archive/full-feature-pre-cleanup` branch and the `pre-cleanup-0.2.1` tag.

## Assisted — the working core

**Status: working. Start here.**

Assisted mode is a bundle of **seven core spec-driven development skills** that guide any coding
agent (Claude Code, or any agent that can load a `SKILL.md`) — or a person — through a change, one
disciplined step at a time:

```
init ──▶ [ propose ] ──▶ plan ──▶ ( code ◀──▶ code-feedback ) ──▶ review ──▶ finish-work
  0        1 optional      2          3             4                5            6
                                     repeat per task              once per change
```

Wayfinder is an optional pre-change planning stage, and `hamilton-critique` is an optional
design-phase gate. Neither belongs to the seven-skill core sequence. Planning writes the declarative
`plan.md`, initializes root `progress.md` as the current task ledger, and creates each
`tasks/task-N/progress.md`. Code and code-feedback then loop per task, with verdicts in
`tasks/task-N/feedback.md`; one whole-branch review writes root `review.md`; finish-work records its
paired history in root `finish.md`.

Each step is a self-contained skill that names no tool and depends on no engine internals — only on
the project's standards (`AGENTS.md`) and the shared artifacts under the project's `.hamilton/`
directory. The same skill guides a human in an editor and a coding agent.

See **[Skills reference](./skills.md)** for what each skill does and how to run it, and
**[SDD framework](./sdd-framework.md)** for the design rationale.

The code and skills live in:

- `skills/hamilton-*/` — the seven pipeline skills.
- `bundle/templates/` — the artifact templates, installed to `~/.hamilton/templates/` by
  `hamilton setup`.
- `bundle/guidelines/` — coding guidelines, installed to `~/.hamilton/guidelines/` by
  `hamilton setup`.
- `bundle/scripts/` — the helper entry points and shared artifact-contract library, installed
  executable to `~/.hamilton/scripts/` by `hamilton setup`. The split workflow requires them for
  stable checkpoints, diff packaging, change context, and finish gates except where an individual
  skill supplies a complete explicit fallback.
- a project's `.hamilton/` — per-project specs and change artifacts, created by the `hamilton-init`
  skill.

Upgrade the Assisted bundle only between changes. Finish an active old-format change with the
generation that created it, update the CLI bundle and agent-loaded skills from one release, run
`hamilton setup`, verify the installed split templates, all six script files, and the seven-step
skill catalog, then start the next change. See
[Upgrading to the split workflow](./sdd-framework.md#upgrading-to-the-split-workflow) for the exact
checks. There is no blanket manual fallback for a missing required helper.
