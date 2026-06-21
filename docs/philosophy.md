# Philosophy

Hamilton is a **workflow-based agentic execution engine**. It orchestrates AI agents through structured, repeatable pipelines for software engineering tasks.

## The Problem

AI coding agents are powerful but unreliable when left to their own devices. A single agent operating in a broad context window makes mistakes: it skips verification, forgets constraints, produces incomplete work, and can't handle tasks larger than its context window.

Multi-agent systems help, but they need structure. Without it, agents drift, context gets stale, and outcomes are unpredictable.

## The Core Idea

Hamilton imposes **structure on multi-agent work** through three mechanisms:

1. **Workflows as DAGs** -- Every workflow is a directed acyclic graph of tasks. Each task has a specific role, a specific agent, and a specific output contract. Tasks execute in dependency order, each receiving the accumulated context from all predecessors.

2. **Agents with explicit contracts** -- Each agent has a defined role, a finite scope, and a structured output format. Agents don't "figure it out" -- they follow instructions (INSTRUCTIONS.md), maintain a personality (SOUL.md), and produce validated JSON output (schema-checked via Ajv).

3. **State machine persistence** -- Every run, task, token, and context is persisted in SQLite. Runs can be paused and resumed across processes. Failed tasks retry with escalating context. The engine knows what's been done and what's left.

## Design Principles

### Finite Scope per Agent

Agents know what they're responsible for and nothing else. The Setup agent creates branches and discovers build commands. The Fixer agent implements changes. The Verifier agent confirms correctness. Each has a narrow, testable remit.

### Deterministic Orchestration

Given the same workflow spec and the same inputs, Hamilton produces the same execution plan every time. The DAG is topologically sorted at load time. Variant composition is deterministic. Even dynamic tasks (forEach loops) produce predictable task IDs.

### Context, Not Chat

Agents don't chat. They receive a structured system prompt (persona + instructions + context) and a specific task prompt. They produce structured JSON output validated against a schema. Context flows forward through the DAG -- completed task outputs are available as template variables for downstream tasks.

### Durable Execution

Every state transition is written to SQLite. A run can survive machine reboots, process crashes, and network interruptions. The `hamilton workflow resume` command restores the full execution context from the database and picks up where it left off.

### Humans in the Loop

Hamilton is agentic, not autonomous. The engine stops at `escalate_to: human` boundaries. A workflow author can configure per-task retry limits, escalation policies, and exhausted-retry behaviors. The human decides what to do when automation hits its limits.

## The DAG Execution Model

Unlike sequential step-by-step scripts, Hamilton workflows are directed acyclic graphs:

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

Tasks execute in topological order. Each task receives the outputs of all completed predecessor tasks as template variables. This creates a natural chain of evidence: the verifier can see what the triager found, what the investigator concluded, and what the fixer changed.

For parallelizable work (implementing multiple stories, fixing multiple vulnerabilities), Hamilton supports **template/forEach expansion** -- a single task definition is expanded into N instances, one per array item, all receiving the same agent context.

## Two-Tier Persona System

Hamilton resolves agent personas from two locations:

1. **Workflow-local agents** (`~/.hamilton/workflows/<slug>/agents/<name>/`) -- specific to one workflow. A bug-fix workflow defines a Triager agent that knows how to triage bugs. A feature-dev workflow defines a Planner that knows how to decompose specs.

2. **Shared agent pool** (`~/.hamilton/agents/<name>/`) -- reusable across workflows. The Setup, Verifier, and PR agents are used by multiple workflows without duplication.

Workflow-local agents take precedence. This means a workflow can override a shared agent's instructions without modifying the shared copy.

## Beyond Coding

While Hamilton is built for software engineering workflows, the architecture is general-purpose. A workflow is just a DAG of tasks executed by agents with structured input/output contracts. The same engine could orchestrate documentation pipelines, data processing, infrastructure provisioning, or any other multi-step agentic task.

The constraint is Pi SDK integration -- agents must execute through Pi's agent framework. But the workflow format, state machine, and orchestration layer are tool-agnostic.
