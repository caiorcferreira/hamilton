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

Assisted mode is a bundle of **spec-driven development skills** that guide any coding agent (Claude
Code, or any agent that can load a `SKILL.md`) — or a person — through a change, one disciplined
step at a time:

```
init ──▶ [ propose ] ──▶ plan ──▶ code ──▶ review ──▶ finish-work
 (once)   optional                  ▲         │
                                    └─────────┘
                          review requests changes → code
```

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
- a project's `.hamilton/` — per-project specs and change artifacts, created by the `hamilton-init`
  skill.
