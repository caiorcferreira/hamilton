# The three modes

> **Hamilton is in ALPHA.** Everything here can change without notice, and there are no
> backward-compatibility guarantees. This page describes what exists today and what is still
> emerging — read the status line on each mode before you rely on it.

AI-assisted coding happens at three different tempos, and a person moves between them all day:
sometimes you want the machine to just *go*, sometimes you want to stay in the loop and shape the
work, and sometimes you want the tool to quietly get better at *your* codebase over time. Hamilton
is organized around those three modes.

| Mode | Who drives | What it is | Status |
|------|-----------|-----------|--------|
| **Autonomous** | The engine | A workflow engine runs a full multi-agent graph end-to-end from a single prompt | **Experimental** |
| **Assisted** | You + any coding agent | A portable, tool-agnostic bundle of spec-driven skills that carry a change from idea to merge | **Working** — the recommended way to use Hamilton today |
| **Ambient** | The tool, in the background | A memory layer that learns from your work and feeds your guidelines and past decisions into future changes | **Early** |

The modes are complementary layers of one system, not competing products. The Assisted skills are
the core: the Autonomous engine's long-term direction is to *run* those same skills automatically,
and the Ambient memory layer feeds context into both.

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
directory. The same skill guides a human in an editor and, eventually, an autonomous agent inside a
workflow.

This is the only layer you can rely on today. See **[Skills reference](./skills.md)** for what each
skill does and how to run it, and **[SDD framework](./sdd-framework.md)** for the design rationale.

The code and skills live in:

- `skills/hamilton-*/` — the seven pipeline skills.
- `bundle/templates/` — the artifact templates, installed to `~/.hamilton/templates/` by
  `hamilton setup`.
- a project's `.hamilton/` — per-project specs and change artifacts, created by the `hamilton-init`
  skill.

## Autonomous — the workflow engine

**Status: experimental.** The engine runs today (`hamilton workflow run` executes real multi-agent
pipelines), but it predates the Assisted skills and is being reworked to *invoke* them rather than
embed its own copies of the instructions. Treat it as a preview: the workflow format, agent
personas, and CLI surface can change without notice.

Autonomous mode takes a single prompt and runs a whole pipeline with no human in the loop: it loads
a YAML workflow spec, resolves agent personas, builds a DAG of tasks, and executes them in order,
passing structured context forward. Every run is persisted in SQLite and can be paused and resumed
across processes.

```bash
cd /path/to/your/git/repo
hamilton workflow run bug-fix "The login page crashes on an empty email"
```

The engine is built on the Pi SDK. See **[Getting started](./getting-started.md)** (Autonomous
section) and the engine docs — [How workflows run](./how-workflows-run.md),
[Workflow YAML](./workflow-yaml.md), [CLI reference](./cli-reference.md),
[Agent system](./agents-system.md) — for the full surface. Each carries an experimental banner.

The code lives in `src/workflow/`, `src/agent/`, `src/cli/`, and `bundle/workflows/`.

## Ambient — the memory layer

**Status: early.** A phase-1 guideline-ingestion pipeline exists; the broader learning loop is
planned, not built.

Ambient mode is the layer that makes Hamilton get better at *your* project over time. Today, project
guidelines are ingested as canonical atoms into a dual-layer memory store (markdown + SQLite) and
retrieved via hybrid full-text/vector search, so relevant standards can be injected into an agent's
context. Failure is graceful — everything else runs without it.

The intended direction is a real learning pipeline: store historical decisions, changes,
preferences, and facts per project (with support for forgetting), and feed them back into future
changes automatically. See **[ROADMAP](../ROADMAP.md)** for where this is headed.

The code lives in `src/memory/` and `src/curator/`.
