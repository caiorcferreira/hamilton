# Roadmap Items 1-6: Design Spec

Date: 2026-06-09

## Overview

Implement 6 roadmap items in a single batch:

1. Change progress file location to `./.hamilton/workflows/progress-<YYYY-MM-DD>.txt` with active management
2. Create Pi configs on init with `--copy-pi-configs` flag fallback to sensible defaults
3. Refactor `output.schema` to `output.schema.content`
4. Support `output.schema.file` to read schemas from files
5. Support `prompt.file` to read prompts from files
6. Load context files based on file type from `~/.hamilton/instruction/`

All 6 are batched together because items 3-5 constitute a single YAML schema migration that touches all 20 workflow YAMLs; splitting them would cause repeated churn.

---

## Section 1: YAML Schema Changes (Items 3, 4, 5)

### Schema Changes in `src/schemas.ts`

**PromptSchema** — change from required `content` to optional `content` + optional `file`, mutually exclusive:

```ts
const PromptSchema = Schema.Struct({
  content: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String)
}).pipe(
  Schema.filter(
    (p: any) => (p.content ? !p.file : !!p.file),
    { message: () => "prompt must have exactly one of 'content' or 'file'" }
  )
)
```

**OutputConfigSchema** — nest `schema` under `content` and add `file`:

```ts
const SchemaConfigSchema = Schema.Struct({
  content: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  file: Schema.optional(Schema.String)
}).pipe(
  Schema.filter(
    (s: any) => s.content || s.file,
    { message: () => "schema must have at least one of 'content' or 'file'" }
  )
)

const OutputConfigSchema = Schema.Struct({
  schema: Schema.optional(SchemaConfigSchema)
})
```

### Type Changes in `src/types.ts`

```ts
export interface SchemaConfig {
  content?: Record<string, unknown>
  file?: string
}

export interface OutputConfig {
  schema?: SchemaConfig
}

export interface Prompt {
  content?: string
  file?: string
}
```

### Resolution in `src/workflow/loader.ts`

Add `resolveWorkflowSpec(workflowDir: string, spec: WorkflowSpec): WorkflowSpec` called after `Schema.decodeUnknownSync`:

1. Walk all tasks recursively
2. If `task.agent.prompt.file` is set, read the file relative to `workflowDir`, assign contents to `task.agent.prompt.content`
3. If `task.agent.output.schema.file` is set, read the JSON file relative to `workflowDir`, parse, assign to `task.agent.output.schema.content`
4. After resolution, all downstream code only deals with `prompt.content` and `output.schema.content`

This keeps `runner.ts`, `activity.ts`, and `pi-executor.ts` unchanged in their logic — they still read `.content`.

### YAML Migration

All 20 workflow YAMLs under `workflows/` get updated:

```yaml
# Before
output:
  schema:
    type: object
    required: [status]
    properties: ...

# After
output:
  schema:
    content:
      type: object
      required: [status]
      properties: ...
```

### File Reference Examples

```yaml
# Prompt from file
agent:
  ref: agents.planner
  prompt:
    file: prompts/plan-prompt.md

# Schema from file
agent:
  ref: agents.planner
  output:
    schema:
      file: schemas/plan-output.json
```

Schema files are JSON Schema objects stored as `.json` files under the workflow directory.

---

## Section 2: Progress File Management (Item 1)

### New Path Functions in `src/paths.ts`

```ts
export function progressDir(): string {
  return Path.join(process.cwd(), ".hamilton", "workflows")
}

export function progressFile(): string {
  const day = new Date().toISOString().slice(0, 10)
  return Path.join(progressDir(), `progress-${day}.txt`)
}
```

Progress files live in the target project's `.hamilton/workflows/` directory (relative to `process.cwd()`), not under `~/.hamilton/`.

### New Function in `src/observability/run-dir.ts`

`ensureProgressFile(runId: string): Effect.Effect<string, RunDirError>`

- Creates `.hamilton/workflows/` directory if missing
- If `progress-<YYYY-MM-DD>.txt` doesn't exist, seeds it with a header containing the date and initial run ID
- Returns the absolute path to the progress file

### Context Injection in `runner.ts`

Before the task loop, after `createRunDir`:

```ts
const progressFilePath = yield* _(ensureProgressFile(runId))
const progressContent = Fs.existsSync(progressFilePath)
  ? Fs.readFileSync(progressFilePath, "utf-8")
  : ""
```

Inject into `runningContext`:

```ts
runningContext.progress_file = progressFilePath
runningContext.progress = progressContent
```

The `{{progress_file}}` and `{{progress}}` template variables are now always available.

### Prompt Template Updates

In all workflow YAML prompt templates, change instructions from:

```
Read progress-{{run_id}}.txt
```

to:

```
Read {{progress_file}}
```

---

## Section 3: Pi Configs on Init (Item 2)

### New Flag on initCommand

`--copy-pi-configs` (boolean, optional, default false)

### New Function: `createDefaultPiConfigs()`

In `src/cli/commands/init.ts`:

- Writes `settings.json` to `piAgentDir()`:
  ```json
  { "defaultProvider": "openai", "defaultModel": "glm-5.1" }
  ```
- Writes `models.json` to `piAgentDir()` with a minimal provider registry
- Writes `auth.json` to `piAgentDir()` as `{}`
- Only creates each file if it doesn't already exist (idempotent)

### New Function: `copyPiConfigs()`

- When `--copy-pi-configs` is true, copies `settings.json` and `models.json` from `~/.pi/agent/` to `piAgentDir()`
- Also copies `auth.json` if it exists at source
- Overwrites existing files at destination (force)
- Skips files that don't exist at source (no error)

### Integration into `initHamilton()`

After `ensureHamiltonHome()`:

1. If `--copy-pi-configs` is true, call `copyPiConfigs()`
2. Always call `createDefaultPiConfigs()` as fallback for any files not created by copy

### `paths.ts` Update

Add `instructionDir()` to `ensureHamiltonHome()`:

```ts
export function instructionDir(): string {
  return Path.join(hamiltonHome(), "instruction")
}
```

Add `instructionDir()` to the `dirs` array in `ensureHamiltonHome()`.

---

## Section 4: Instruction Files by File Type (Item 6)

### Directory Structure

```
~/.hamilton/instruction/
  typescript.md
  python.md
  rust.md
  ...
```

Each file is markdown with YAML frontmatter:

```markdown
---
name: TypeScript
extensions: [".ts", ".tsx"]
---
TypeScript conventions and patterns go here...
```

### New Module `src/agent/instructions.ts`

`loadInstructionFiles(cwd: string): Effect.Effect<Array<{name: string; content: string}>, never>`

1. Read `~/.hamilton/instruction/` directory — return `[]` if missing (feature is opt-in)
2. For each `*.md` file, parse YAML frontmatter by splitting on `---`
3. Extract `name` (string) and `extensions` (string array) from frontmatter
4. Scan the target project (`cwd`) recursively for file extensions
5. Skip directories: `node_modules/`, `.git/`, `dist/`, `build/`, `.hamilton/`
6. Collect unique extensions via `Set<string>`
7. Return instruction files whose `extensions` list intersects with found extensions
8. Each result includes `name` and content (frontmatter stripped)

### Frontmatter Parsing

Simple split on `---` boundaries. No external library:

```ts
function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null
  const frontmatter = Yaml.parse(match[1]) as Record<string, unknown>
  return { frontmatter, body: match[2] }
}
```

Reuse the `yaml` package already imported in `loader.ts`.

### Integration into `pi-executor.ts`

Add `instructionFiles` to `PiExecutorConfig`:

```ts
instructionFiles?: Array<{name: string; content: string}>
```

Use `agentsFilesOverride` on `DefaultResourceLoader`:

```ts
agentsFilesOverride: (current) => ({
  agentsFiles: [
    ...current.agentsFiles,
    ...(config.instructionFiles ?? []).map(f => ({ path: f.name, content: f.content }))
  ]
})
```

### Integration into `runner.ts`

Call `loadInstructionFiles(process.cwd())` once before the task loop:

```ts
const instructionFiles = yield* _(loadInstructionFiles(process.cwd()))
```

Pass `instructionFiles` through to `executeWithPi()` via its config.

---

## Error Handling

| Feature | Error Strategy |
|---------|---------------|
| Schema file not found | `WorkflowParseError` with filepath |
| Prompt file not found | `WorkflowParseError` with filepath |
| Progress file creation failure | `RunDirError` with runId |
| Pi config creation failure | `InitError` with descriptive message |
| Instruction dir missing | Silent — return empty array, feature is opt-in |
| Frontmatter parse failure | Skip that instruction file, log warning |
| No matching extensions | Return empty array, no instructions loaded |

---

## Testing Strategy

| Feature | Test Approach |
|---------|--------------|
| Schema changes | Unit tests for `resolveWorkflowSpec` with file fixtures |
| Prompt file loading | Temp workflow dir with `.md` file, verify prompt.content populated |
| Schema file loading | Temp workflow dir with `.json` schema file, verify schema.content populated |
| Progress file management | Temp home dir override, verify file creation and context injection |
| Pi config defaults | Temp home dir override, verify file contents |
| Pi config copy | Temp home with source `~/.pi/agent/`, verify copy |
| Instruction loading | Temp instruction dir with frontmatter files, temp project dir with extensions |
| Extension scanning | Project dir with mixed extensions, verify correct instructions matched |
| All YAMLs valid | After migration, load each workflow spec and verify schema decode succeeds |

---

## Files Modified

| File | Changes |
|------|---------|
| `src/schemas.ts` | PromptSchema, OutputConfigSchema, new SchemaConfigSchema |
| `src/types.ts` | Prompt, OutputConfig, new SchemaConfig |
| `src/workflow/loader.ts` | Add resolveWorkflowSpec post-load resolution |
| `src/workflow/runner.ts` | Progress file context, instruction files loading |
| `src/paths.ts` | progressDir, progressFile, instructionDir functions |
| `src/observability/run-dir.ts` | ensureProgressFile function |
| `src/agent/pi-executor.ts` | instructionFiles param, agentsFilesOverride |
| `src/agent/instructions.ts` | New module: loadInstructionFiles |
| `src/cli/commands/init.ts` | createDefaultPiConfigs, copyPiConfigs, --copy-pi-configs flag |
| `workflows/*/workflow.yml` | All 20 YAMLs: output.schema → output.schema.content |
| `tests/` | New tests mirroring all above changes |