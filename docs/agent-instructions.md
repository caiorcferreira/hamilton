# Agent Instructions

How Hamilton constructs the prompts sent to Pi agents. Covers the persona system (agent
identity), project instruction files (auto-discovered conventions), and the prompt
assembly pipeline.

## The three layers

Every agent prompt is assembled from three layers:

```
<identity>         IDENTITY.md  (optional)
<style>            SOUL.md      (optional)
<context>          JSON context  (auto)
<harness>          Hardcoded block
<agent>            AGENTS.md    (required)
```

## Persona files (AGENTS.md, SOUL.md, IDENTITY.md)

Each agent has three persona files. They live in one of two places:

1. **Workflow-local**: `~/.hamilton/workflows/<slug>/agents/<name>/` — overrides shared.
2. **Shared pool**: `~/.hamilton/agents/<name>/` — fallback, accessed via symlink.

Defined in workflow YAML under `agents[].settings.systemPrompt`:

```yaml
agents:
  - name: planner
    role: analysis
    settings:
      systemPrompt:
        agent: agents/planner/AGENTS.md       # required
        soul: agents/planner/SOUL.md           # optional
        identity: agents/planner/IDENTITY.md   # optional
```

Paths are resolved relative to the workflow directory. Shared agents use `shared/agents/`
(via symlink to `~/.hamilton/agents/`).

### AGENTS.md (required)

Core behavioral instructions. Tells the agent:
- The process it should follow (numbered steps)
- Decision criteria and what to prioritize
- Exact output format (JSON schema via `write_step_output`)
- What NOT to do (explicit prohibitions)

Example: `agents/shared/do/AGENTS.md`

```markdown
# Your Process
1. Understand the task
2. Plan your approach
3. Execute step by step
4. Verify against requirements
5. Report results via write_step_output

# Output Format
Call write_step_output with: {"status": "done", "result": "..."}

# What NOT To Do
- Don't skip verification
- Don't leave unfinished work
```

### SOUL.md (optional — defaults to empty)

Agent personality, voice, values. Short (2-5 lines).

Example:

```markdown
You are a capable and efficient worker.
Plan first, then execute decisively.
When stuck, state what you know and what you need.
```

### IDENTITY.md (optional — defaults to empty)

Agent name and role. 1-2 lines.

Example:

```markdown
Name: Doer
Role: General-purpose agent for executing arbitrary tasks.
```

## The harness block

Every agent receives the same hardcoded harness block injected between context and
AGENTS.md content. It tells the agent it's one step in a multi-step pipeline and defines
the output contract:

```markdown
# Hamilton Workflow
You are executing a task within a Hamilton workflow. A workflow is a sequence
of tasks that pass context between them. Your job is to complete one task and
save your result.

### How to finish your task
When you have completed your work, call the write_step_output tool with a JSON
object containing your results. The object MUST include a "status" field (string)
indicating your completion state. Other fields are freeform and will be passed
as context to subsequent tasks.

IMPORTANT:
- You MUST call write_step_output exactly once — it will reject duplicate calls
- The tool validates that your output is valid JSON with a "status" field
```

The harness block is always present and cannot be customized per-workflow or per-agent.

## Project instruction files (`~/.hamilton/instruction/`)

Optional markdown files that inject project-specific conventions into every agent in a
workflow. They are auto-discovered by scanning the project directory for file extensions.

### How they work

1. At workflow startup, Hamilton scans the project directory (skipping `node_modules`,
   `.git`, `dist`, `build`, `.hamilton`) and collects all file extensions present (e.g.
   `[".ts", ".tsx", ".json"]`).
2. It reads files from `~/.hamilton/instruction/*.md` with YAML frontmatter.
3. If a file's `extensions` list overlaps with the project's extensions, the file body is
   included for every agent in the workflow.

### File format

Each instruction file must have YAML frontmatter with `name` (string) and `extensions`
(string array):

```markdown
---
name: TypeScript
extensions: [".ts", ".tsx"]
---

- Use `import type` for type-only imports
- Prefer `const` over `let`
- No `any` — always provide explicit types
- Use `Data.TaggedError` for custom errors (not `class extends Error`)
```

```markdown
---
name: React
extensions: [".tsx", ".jsx"]
---

- Components use functional style with hooks
- One component per file
- Colocate tests with component files
```

### Matching logic

An instruction file is included if at least one of its `extensions` matches the project.
For example, if the project has `.ts` and `.tsx` files:

- A `TypeScript` instruction with `extensions: [".ts", ".tsx"]` → included (`.ts` matches).
- A `React` instruction with `extensions: [".tsx", ".jsx"]` → included (`.tsx` matches).
- A `Python` instruction with `extensions: [".py"]` → skipped (no match).

### Placement in the prompt

Instruction files are passed to the Pi executor as `instructionFiles` — separate from the
system prompt. The Pi SDK handles injecting them appropriately (e.g. as workspace files
the agent can read).

## Prompt assembly order

For each task in the workflow, the runner:

1. **Resolves persona** — loads `AGENTS.md` (required), `SOUL.md` and `IDENTITY.md`
   (optional) from the workflow directory.
2. **Builds context** — merges outputs from completed tasks + iteration variables
   (`vars.*`).
3. **Assembles system prompt** in this exact order:

   ```
   <identity>IDENTITY.md</identity>       ← only if non-empty
   <style>SOUL.md</style>                 ← only if non-empty
   <context>JSON.stringify(context)</context>  ← only if non-empty
   <harness>Hardcoded block</harness>     ← always present
   <agent>AGENTS.md</agent>               ← always present
   ```

   Parts are joined with `\n\n`.

4. **Resolves task prompt** — replaces `{{...}}` template variables in
   `task.agent.prompt.content` with values from the context.
5. **Loads instruction files** — once per workflow run (not per-task), from
   `~/.hamilton/instruction/`.
6. **Returns `BuiltPrompt`** with `{ systemPrompt, taskPrompt, instructionFiles }`.
7. **Passes to Pi executor** — which feeds all three to the Pi SDK session.

## Installing shared agents

`hamilton init` copies agent personas from the bundled `agents/shared/` directory into
`~/.hamilton/agents/`. Currently bundled: `do`, `setup`, `verifier`, `pr`.

To add a new shared agent, create three files under `~/.hamilton/agents/<name>/`:

```
~/.hamilton/agents/my-agent/
  AGENTS.md       # required
  SOUL.md         # optional
  IDENTITY.md     # optional
```

Then reference them in workflow YAML using the `shared/agents/` path:

```yaml
agents:
  - name: my-agent
    role: coding
    settings:
      systemPrompt:
        agent: shared/agents/my-agent/AGENTS.md
```
