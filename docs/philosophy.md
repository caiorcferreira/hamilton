# Philosophy

> **Hamilton is in ALPHA.** The ideas here are stable; the code that realizes them is not. See
> [The three modes](./modes.md) for what works today.

Hamilton is structured AI-assisted coding for existing codebases. It spans three modes — **Autonomous**
(an engine runs a full agent graph), **Assisted** (portable spec-driven skills guide any coding
agent), and **Ambient** (a memory layer that learns your project) — described in
[The three modes](./modes.md). This page is the rationale beneath all three.

## The problem

AI coding agents are capable but unanchored. Left with a broad prompt they drift: they skip
verification, forget constraints, and produce work that looks right and collapses under the first edge
case. A single agent operating in one wide context window cannot handle a task larger than that
window, and cannot be trusted to police itself.

Multi-agent systems help, but only with structure. Without it, agents wander, context goes stale, and
outcomes are unpredictable. The fix is not a bigger prompt — it is **structure that survives across
steps and across sessions.**

## Two core ideas

**The spec is the shared source of truth, and it accumulates.** Every change is described before it is
built — why (proposal), what (requirements), how (design) — and the decisions a change commits to are
folded back into a living per-project spec. Over time the project's `specs/` directory becomes the
consolidated truth, while each change keeps its own history. This is how historical decisions are
preserved without letting the current picture rot.

**Skills are portable knowledge; the harness is only a binding.** A skill encodes *how* to plan, code,
or review well, once. It assumes no tool and no engine internals, so the identical skill guides a
human in any editor and an autonomous agent inside a workflow. Whatever is Hamilton-specific — how an
agent reports output, how context templates render — lives in a thin wrapper around the skill, never
in the skill itself. The artifacts under a project's `.hamilton/` directory are the contract between
authoring and execution, and that contract is what makes a human-to-autonomous handoff possible.

## Design principles

These principles hold across all three modes.

### Structure over prompting

Reliability comes from a fixed sequence with explicit contracts at each boundary, not from a cleverer
one-shot prompt. Each step has a narrow remit, a defined input, and a defined output, so quality is
built up rather than hoped for.

### Right-sized rigor

The documents borrow the *spirit* of established standards — testable requirements, decisions recorded
with their alternatives — without the ceremony. Each artifact scales to the change: a few sentences
when the change is small, a full spec when it is large. "29148-inspired," not 29148-conformant.

### Match the worker to the work

The plan step does the sequencing thinking and writes test-first steps; the code step follows those
steps verbatim and adds no design of its own, so it can run on a weak, cheap model. The review step is
the strong-model quality gate. Decisions that need a human are surfaced to a human; running unattended,
the agent decides and records its reasoning.

### Humans in the loop, not out of it

Hamilton is agentic, not blindly autonomous. The Assisted pipeline gates on approval at the front door
and on a passing review at the finish. In the engine, a workflow author configures per-task retry
limits, escalation policies, and `escalate_to: human` boundaries. The human decides what to do when
automation hits its limits.

### Changes accumulate into living specs

A change proposes requirement *deltas* (ADDED / MODIFIED / REMOVED / RENAMED). The finish step folds
them into the canonical `specs/<capability>.md`, which always describes current behavior with no delta
markers. Changes are ephemeral; specs are durable.

## Autonomous-mode design

The principles above take a specific shape in the **Autonomous** engine, which runs a whole pipeline
with no human in the loop. (The engine is experimental — see [The three modes](./modes.md).)

### Workflows as DAGs

Every workflow is a directed acyclic graph of tasks. Each task has a specific role, a specific agent,
and a specific output contract. Tasks execute in dependency order, each receiving the accumulated
context of all predecessors — a natural chain of evidence, where the verifier can see what the triager
found, what the investigator concluded, and what the fixer changed.

```
                ┌─────────┐
                │  triage  │
                └────┬─────┘
                     │
                ┌────▼─────┐
                │investigate│
                └────┬─────┘
                     │
                ┌────▼─────┐
                │  setup   │
                └────┬─────┘
                     │
                ┌────▼─────┐
                │   fix    │
                └────┬─────┘
                     │
                ┌────▼─────┐
                │  verify  │
                └──────────┘
```

For parallelizable work (multiple stories, multiple vulnerabilities), a single task definition is
expanded into N instances via template/forEach expansion, one per array item.

### Context, not chat

Engine agents don't chat. Each receives a structured system prompt (persona + instructions + context)
and a specific task prompt, and produces structured JSON output validated against a schema. Context
flows forward through the DAG as template variables.

### Durable execution

Every state transition is written to SQLite. A run can survive reboots, crashes, and network
interruptions; `hamilton workflow resume` restores the full execution context from the database and
picks up where it left off. Given the same spec and inputs, the engine produces the same execution
plan every time — the DAG is topologically sorted at load time.

### Two-tier persona system

The engine resolves agent personas from two locations. **Workflow-local** agents
(`~/.hamilton/workflows/<slug>/agents/<name>/`) are specific to one workflow; the **shared pool**
(`~/.hamilton/agents/<name>/`) is reusable across workflows. Workflow-local takes precedence, so a
workflow can override a shared agent's instructions without touching the shared copy.

## Beyond coding

While Hamilton is built for software engineering, the architecture is general-purpose: a workflow is
a DAG of tasks executed by agents with structured input/output contracts, and a skill is tool-agnostic
knowledge. The same machinery could orchestrate documentation pipelines, data processing, or any other
multi-step agentic task.
