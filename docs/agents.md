# Agent System

Hamilton agents are AI personas with defined roles, instructions, and output contracts. Each
agent is a directory containing a manifest (`agent.yml`) and persona files (`INSTRUCTIONS.md`,
`SOUL.md`, optionally `CONTEXT.md`). The engine resolves agents through a two-tier system and
builds structured prompts from their persona files.

## Agent Directory Structure

```
agents/<agent-name>/
  agent.yml          # Manifest: name, model, settings
  INSTRUCTIONS.md    # Core behavioral instructions (STAR format)
  SOUL.md            # Personality, voice, and values
  CONTEXT.md         # Optional custom context template
```

All files are markdown. The engine reads them at workflow load time and caches the parsed
personas for the duration of the run.

## agent.yml

Kubernetes-style manifest for an agent:

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: setup
spec:
  settings:
    model: default
    skills:
      - agent-browser
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `apiVersion` | `string` | Yes | Must be `dag.hamiltonai.dev/v1alpha1` |
| `kind` | `string` | Yes | Must be `Agent` |
| `metadata.name` | `string` | Yes | Unique agent name. Used as `executorRef` in workflow tasks. |
| `spec.settings.model` | `string` | No | Model reference. Defaults to `"default"` (resolves via model aliases). |
| `spec.settings.skills` | `string[]` | No | RTK skill names to load for this agent. |

The `model` field supports model aliases from settings.yaml. Use `"default"` for the Pi SDK
default model, or any registered alias like `"sonnet"` or `"flash"`.

Model resolution chain:
1. Check `models.aliases` in settings.yaml for a matching key
2. Recursively resolve until a non-alias value is found
3. Return `"default"` or the raw value if no alias matches

## INSTRUCTIONS.md

The core behavioral file. Written in **STAR format** (Situation, Task, Action, Result).

### STAR Structure

```markdown
# Agent Name

## Situation
You are the **<role>** in a multi-agent workflow.
Context, constraints, what's at stake.

## Task
Your mission: specific, measurable outcome.

## Action
1. Ordered execution steps
2. Each step with concrete commands or checks
3. Clear pass/fail criteria

## Progress
How to write progress entries to the progress file.

## Result
Exact `write_step_output` JSON format with required keys.

## Constraints
What NOT to do.
```

### Example: Verifier Agent (excerpt)

```markdown
## Situation
You are the **quality gate** in a multi-agent workflow. Before any change
reaches production, it must pass through you.

## Task
Your mission: Independently verify that the proposed changes are correct,
complete, secure, and free of regressions.

## Action
### Phase 1: Security Scan
1. Verify .gitignore exists. If missing → reject immediately.
2. List all changed files: git diff main..<branch> --name-only
3. Reject if sensitive files appear in diff.

### Phase 2: Diff Inspection
1. Inspect actual diff: git diff main..<branch> --stat
2. Verify diff is non-trivial
3. Cross-reference against claimed changes

### Phase 3: Build & Test Verification
1. Run full test suite
2. Run typecheck/build
3. Verify tests are meaningful

### Phase 4: Acceptance Criteria
1. Check each criterion against actual code
2. Verify work was actually done (no TODOs, stubs, placeholders)

## Result
Approve:
{"status": "done", "verified": "what you confirmed"}

Reject:
{"status": "retry", "issues": ["specific issue 1", "specific issue 2"]}
```

### Output Contract

All agents MUST produce a JSON object with a `status` field. The supported status values:

| Status | Meaning |
|--------|---------|
| `done` | Task completed successfully. All criteria met. |
| `failed` | Task failed irrecoverably. Escalates to `on_failure` policy. |
| `retry` | Task partially complete. Retry with feedback. |

Agents call `write_step_output` (or `write_task_output`) to submit their output. The output is
validated against the task's output schema (if defined) using Ajv.

### Validation Failure Handling

If an agent's output fails schema validation:
1. The engine increments the retry counter
2. A reminder prompt is injected (up to 2 reminders)
3. The task is re-executed with the validation error as feedback
4. If `max_retries` is exhausted, the task escalates to the `on_failure` policy

## SOUL.md

The agent's personality, voice, and values. Short (3-7 lines). Defines character and working
style.

### Example: Setup Agent SOUL

```markdown
# Soul

You are practical and systematic. You prepare the environment so other
agents can focus on their work, not setup.

You are NOT a coder — you are a setup agent. Your job is to create the
branch, figure out how to build and test the project, and verify the
baseline is clean.

You value reliability: if the build is broken before work starts, you say
so clearly. You give the team the ground truth they need.
```

### Example: Verifier Agent SOUL

```markdown
# Soul

You are a skeptical quality gate. You trust evidence, not claims. "I did
it" means nothing — passing tests and actual code mean everything.

You are thorough but fair. You don't nitpick style. You verify
correctness: does the work meet the requirements? Do tests pass?

When something is wrong, you are specific and actionable. "It's broken"
is useless. "The test asserts on the wrong field" is useful.
```

## CONTEXT.md (Optional)

Custom template for the context section of the system prompt. If not present, the default
context template is used:

```handlebars
## Inputs
{{inputs}}
```

A custom CONTEXT.md can structure the context differently, select specific fields, or add
explanatory text around the context data.

## Two-Tier Agent Resolution

Agents live in two locations with a clear precedence order:

### 1. Workflow-Local Agents (Priority)

```
~/.hamilton/workflows/<workflow-slug>/agents/<agent-name>/
```

Defined per workflow. A bug-fix workflow might define `triager`, `investigator`, and `fixer`.
A feature-dev workflow might define `planner`, `developer`, and `tester`.

These agents are specific to their workflow and are not shared.

### 2. Shared Agent Pool (Fallback)

```
~/.hamilton/agents/<agent-name>/
```

Used by multiple workflows. The bundled shared agents are:

| Agent | Role | Used By |
|-------|------|---------|
| `setup` | Environment preparation, branch creation, build/test discovery | bug-fix, feature-dev, security-audit, quarantine-broken-tests |
| `verifier` | Quality gate: correctness, security, completeness | bug-fix, feature-dev, security-audit, quarantine-broken-tests, scaffold |
| `do` | General-purpose single-task execution | do |
| `pr` | Pull request creation via `gh pr create` | *-github-pr variants |

### Resolution Logic

1. Look for the agent in `~/.hamilton/workflows/<slug>/agents/<name>/`
2. If not found, look in `~/.hamilton/agents/<name>/`
3. If not found in either location, the workflow fails to load with `AgentNotFoundError`

This means a workflow can override a shared agent by providing a workflow-local version with
the same name.

### Duplicate Detection

Loading all workflows' agents into the registry detects duplicate names across workflows.
If two workflows define an agent with the same name in their workflow-local directories,
loading fails with a `DuplicateAgentError`.

Shared agents never cause duplicates -- they are the fallback, and only one copy exists.

## Prompt Building

When an agent task executes, the engine builds a structured prompt:

```
<platform>
  Hamilton orchestration instructions
</platform>

<instructions>
  [Contents of INSTRUCTIONS.md]
</instructions>

<persona>
  [Contents of SOUL.md]
</persona>

<context>
  [Rendered context: workflow environment as JSON or custom CONTEXT.md]
</context>

<expected_output_schema>
  [JSON schema if output.schema is configured]
</expected_output_schema>

[task prompt content]
```

The `<platform>` section injects Hamilton-specific tool usage instructions. The `<context>`
section renders the workflow environment (all accumulated task outputs) through Handlebars,
applying the `CONTEXT.md` template or the default.

Guideline files matching the project's file types are injected into `<instructions>` with
paths formatted as `<guideline-name>/<file-name>`.

## Shared vs. Workflow-Local Examples

### Shared: Setup Agent

Used by 4+ workflows. Lives at `~/.hamilton/agents/setup/`. Tasks reference it as
`executorRef: setup`. Its INSTRUCTIONS.md is generic -- it knows how to discover build
commands, create branches, and establish baselines for any project.

### Workflow-Local: Triager Agent (bug-fix)

Lives at `~/.hamilton/workflows/bug-fix/agents/triager/`. Task references it as
`executorRef: triager`. Its INSTRUCTIONS.md is specific to bug triage -- it knows how to
classify severity, reproduce issues, and produce structured triage reports.

### Overriding: Custom Verifier

A workflow can provide `~/.hamilton/workflows/<slug>/agents/verifier/` to override the
shared verifier. This is useful when a workflow needs workflow-specific verification steps
(e.g., the security-audit workflow needs bypass-scenario thinking that a generic verifier
wouldn't include).

## Bundled Agents Reference

### setup

| File | Purpose |
|------|---------|
| INSTRUCTIONS.md | Branch creation, build/test command discovery, .gitignore hygiene, baseline establishment |
| SOUL.md | Practical, systematic, reliable |
| Output | `{ status, original_branch, build_cmd, test_cmd, ci_notes, baseline }` |

### verifier

| File | Purpose |
|------|---------|
| INSTRUCTIONS.md | 5-phase verification: security scan, diff inspection, build/test, acceptance criteria, visual (conditional) |
| SOUL.md | Skeptical, evidence-based, specific and actionable |
| Output | `{ status: "done", verified }` or `{ status: "retry", issues: [...] }` |

### do

| File | Purpose |
|------|---------|
| INSTRUCTIONS.md | General-purpose execution: understand, plan, execute, verify, report |
| SOUL.md | Resourceful, methodical, thorough |
| Output | `{ status, result, changes }` |

### pr

| File | Purpose |
|------|---------|
| INSTRUCTIONS.md | Pull request creation: title, body template, labels, reviewers |
| SOUL.md | Clear, concise, professional |
| Output | `{ status, pr_url, pr_number }` |

## Authoring Custom Agents

### 1. Create the agent directory

```
~/.hamilton/agents/my-agent/
  agent.yml
  INSTRUCTIONS.md
  SOUL.md
```

For workflow-local agents:

```
~/.hamilton/workflows/<slug>/agents/my-agent/
  agent.yml
  INSTRUCTIONS.md
  SOUL.md
```

### 2. Write agent.yml

```yaml
apiVersion: dag.hamiltonai.dev/v1alpha1
kind: Agent
metadata:
  name: my-agent
spec:
  settings:
    model: default
```

### 3. Write INSTRUCTIONS.md

Follow the STAR format. Key sections:

- **Situation**: Agent's role, what context it has, constraints
- **Task**: Mission statement with specific, measurable outcomes
- **Action**: Ordered execution steps with concrete commands
- **Progress**: How to append to the progress file
- **Result**: Exact `write_step_output` JSON format with required keys
- **Constraints**: What NOT to do

### 4. Write SOUL.md

3-7 lines defining personality and values. Use declarative statements. Example:

```markdown
# Soul

You are a careful reviewer. You catch bugs before they reach production.
You are systematic: check every file, run every test, verify every claim.

When you find an issue, you explain it clearly. The developer should know
exactly what to fix and why.
```

### 5. Reference in workflow YAML

```yaml
tasks:
  - name: review
    agent:
      executorRef: my-agent
      prompt:
        content: |
          Review the changes: {{changes}}
```

### 6. Set up output schema

Create `schemas/review.json` in the workflow directory:

```json
{
  "type": "object",
  "required": ["status"],
  "properties": {
    "status": { "type": "string", "enum": ["done", "retry"] },
    "findings": { "type": "string" },
    "issues": {
      "type": "array",
      "items": { "type": "string" }
    }
  }
}
```

Reference in the task:

```yaml
output:
  schema:
    file: schemas/review.json
```

## Agent Execution Flow

1. **Workflow loads** -- agent manifests are read and cached in the registry
2. **Task starts** -- engine resolves `executorRef` to an agent directory
3. **Prompt built** -- INSTRUCTIONS.md, SOUL.md, CONTEXT.md, guidelines, and output schema are assembled
4. **Model selected** -- `agent.spec.settings.model` is resolved through aliases
5. **Pi SDK session created** -- extensions loaded, session started
6. **Agent executes** -- receives system prompt + task prompt, calls tools, produces output
7. **Output validated** -- checked against output schema (if configured)
8. **Task completes** -- output stored in workflow environment for downstream tasks

## Documentation Conventions for Hamilton Development

When making changes to Hamilton's own codebase, keep the documentation in `docs/`
synchronized. Every code change that affects user-facing behavior, APIs, configuration,
or CLI commands must include corresponding documentation updates.

### Mapping Code to Docs

| Code change area | Doc to update |
|------------------|---------------|
| New/changed CLI command, flag, or argument | `docs/cli-reference.md` |
| New/changed YAML fields, task types, or validation rules | `docs/workflow-yaml.md` |
| New/changed settings.yaml keys | `docs/settings.md` |
| New/changed agent manifest fields or persona conventions | `docs/agents.md` |
| New/changed agent INSTRUCTIONS.md or SOUL.md in `bundle/agents/` | `docs/agents.md` (Bundled Agents Reference) |
| New/changed workflow in `bundle/workflows/` | `docs/workflows-catalog.md` |
| New workflow YAML, variant, or task type | `docs/workflows-catalog.md` |
| New features or capabilities that change how users work | `docs/use-cases.md` or `docs/advanced.md` |
| Changes to execution model, state machine, or engine behavior | `docs/philosophy.md` or `docs/advanced.md` |

### Rules

1. **Documentation is not optional.** A code change is incomplete until the relevant docs are updated.
2. **Match the real behavior.** Documentation must reflect the actual code, not aspirations.
3. **Use the existing format.** Tables, code blocks, and section structures in each doc file are consistent -- follow them.
4. **Update the README.** If a change affects the quick-start flow, available workflows, commands table, or architecture section, update `README.md`.
5. **Inline examples are live.** YAML examples in docs should be valid workflow specs that the current engine can load. If the YAML format changes, update every example.
6. **No stale content.** When deprecating or removing a feature, remove its documentation in the same changeset. Do not leave `(deprecated)` notes -- cut cleanly.
