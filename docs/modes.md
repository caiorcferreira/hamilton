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
- `src/workbench/` — the workflow-mechanics implementation distributed through the CLI.
- a project's `.hamilton/` — per-project specs and change artifacts, created by the `hamilton-init`
  skill.

The distributed workbench is the supported workflow-mechanics surface. Its operations are:

- `hamilton workbench isolate` — check, create, or verify an isolated workspace.
- `hamilton workbench diff` — record checkpoints and package task or change diffs.
- `hamilton workbench precondition` — evaluate finish-work gates.
- `hamilton workbench context` — inspect change artifacts and lifecycle state.
- `hamilton workbench prototype` — create, resume, or verify prototype branches.
- `hamilton workbench lint` — validate one file or one change directory.

For lint, provide exactly one of `--file <file>` or `--change-dir <dir>`:

```bash
hamilton workbench lint --file <file>
hamilton workbench lint --change-dir <dir>
```

The file selector validates only the named regular file. The change-directory selector recursively
visits regular files within that directory and does not cross its boundary. Unrelated files are
reported as skipped; conventional artifact filenames without frontmatter produce warnings, and
malformed recognized artifacts fail closed. Lint succeeds only when no errors or warnings remain.

Upgrade the Assisted bundle only between changes. Finish an active change with the Hamilton
generation that created it, update the CLI and the agent-loaded skills together from one release,
run `hamilton setup`, verify `hamilton workbench --help`, and then start the next change. Setup does
not delete stale helper files from an older generation; use `hamilton purge` for explicit cleanup
when desired. See [Upgrading to the split workflow](./sdd-framework.md#upgrading-to-the-split-workflow)
for the exact checks. Never replace one part of the installed generation while a change is active.
