# Hamilton CLI v2 — Design Spec

Migrate the CLI from manual `process.argv` parsing to `@effect/cli`, add `workflow runs`, improve `workflow list` output, and replace `rtk verify` with a general `doctor` command.

## Scope

Three roadmap tasks in one CLI overhaul:
1. Full CLI rewrite using `@effect/cli` (`Command` API, typed args/options, auto-generated `--help`)
2. New `hamilton workflow runs [--status <status>] [--limit <n>]` command
3. Improved `hamilton workflow list` — tabular output with flat color coding

## Command Hierarchy

```
hamilton
├── init [--force]
├── doctor                          (was "rtk verify")
└── workflow
    ├── run <slug> <prompt...>
    ├── status <id>
    ├── list                        (improved output)
    ├── runs [--status] [--limit]   (NEW)
    ├── logs <id> [--step <id>] [--follow]
    ├── pause <id>
    ├── resume <id>
    ├── install <id> [--force] | --all [--force]
    └── uninstall <id>
```

## File Structure

```
src/cli/
  main.ts                        # Compose top-level Command tree → CliApp.run()
  commands/
    workflow.ts                  # Parent "workflow" command, collects subcommands
    workflow/
      run.ts
      status.ts
      list.ts                    # Improved output: flat table with color
      runs.ts                    # NEW
      logs.ts
      pause.ts
      resume.ts
      install.ts
      uninstall.ts
    init.ts
    doctor.ts                    # Was rtk.ts; structured for future checks
  formatting/
    table.ts                     # renderTable<T>(items, columns): string
    colors.ts                    # ANSI wrappers + categoryColor(id)
```

### Code removed
- `src/cli/commands/rtk.ts` — replaced by `doctor.ts`
- `src/cli/commands/list.ts` — replaced by `workflow/list.ts`
- The remaining `src/cli/commands/` files move to `src/cli/commands/workflow/` (run, status, logs, pause, resume, install, init — paths updated)

## Composition Pattern

Each command file exports a `Command<Effect<...>>`. The callback in `Command.make` wraps existing Effect functions with `Console.log`/`Console.error` for output. Existing Effect functions keep their pure signatures — only the CLI binding layer changes.

### Parent composition (`main.ts`)

```typescript
const workflowCommand = Command.make("workflow").pipe(
  Command.withSubcommands([
    runCommand, statusCommand, listCommand, runsCommand,
    logsCommand, pauseCommand, resumeCommand, installCommand, uninstallCommand,
  ])
)

const cli = Command.make("hamilton", {
  options: {}, args: {},
  handler: () => Console.log("Hamilton - Workflow-based agentic execution engine\n\nUse --help for available commands")
}).pipe(Command.withSubcommands([initCommand, doctorCommand, workflowCommand]))

const app = CliApp.make({ name: "Hamilton", version: "0.1.0", command: cli })
app.run(process.argv, (exitCode) => process.exit(exitCode))
```

### Subcommand example (`list.ts`)

```typescript
export const listCommand = Command.make("list", { options: {}, args: {} }, () =>
  listWorkflows.pipe(
    Effect.flatMap((items) =>
      items.length === 0
        ? Console.log("No workflows installed. Run `hamilton workflow install --all`")
        : Console.log(renderWorkflowTable(items))
    )
  )
).pipe(Command.withDescription("List installed workflows"))
```

## Command Interfaces

### `hamilton doctor`
Replaces `rtk verify`. Structured as an array of `Check` objects to support future checks (DB reachable, home dir exists, etc.).

```
$ hamilton doctor
  rtk    ✓ 0.23.0   /usr/local/bin/rtk
```

```
$ hamilton doctor
  rtk    ✗ not found (install: npm install -g @rtk-ai/rtk)
```

Implementation: a `checks` array of `{ name: string; run: Effect<CheckResult> }`. `doctor` runs all checks, prints results. Currently contains only `checkRtk` (ported from `rtk.ts`). Green checkmark on pass, red cross on fail.

### `hamilton workflow runs`
```
Usage: hamilton workflow runs [--status running|completed|failed|paused] [--limit <n>]
```

Options:
- `--status` — filter by run status (default: show all)
- `--limit` — max runs shown (default: 20, most recent first)

Output (tabular):
```
  bug-fix-x8k2s1      bug-fix         completed   2 hours ago      verify
  sec-audit-p3m9q4    security-audit  failed      5 minutes ago    fix
```

Columns: `RUN ID`, `WORKFLOW`, `STATUS`, `STARTED`, `CURRENT STEP`. Status colored: green (completed), red (failed), yellow (paused), cyan (running). Run ID truncated at 20 chars. Relative time for STARTED.

### `hamilton workflow list` (improved)
```
Usage: hamilton workflow list
```

Output (flat, color-coded by category):
```
  bug-fix              Bug Fix Workflow (local-only)               v1   5 steps   5 agents
  bug-fix-github-pr    Bug Fix Workflow (GitHub PR)                 v1   6 steps   6 agents
  bug-fix-merge        Bug Fix Workflow + Merge                     v1   6 steps   6 agents
  bug-fix-merge-...    Bug Fix Workflow + Merge (Worktree)          v1   6 steps   6 agents
  bug-fix-worktree     Bug Fix Workflow (Worktree)                  v1   5 steps   5 agents
  feature-dev          Feature Development Workflow (local-only)    v5   5 steps   5 agents
  ...
```

Color scheme:
- `bug-fix-*` → red
- `feature-dev-*` → green
- `quarantine-*` → yellow
- `security-audit-*` → cyan

Applied to the workflow ID column. Version and step/agent counts in `dim`.

### Other commands
All other commands keep their existing behavior and argument structure. Only the parsing layer changes:
- `run <slug> <prompt...>` — slug is a positional arg (string), prompt is rest args (variadic string)
- `status <id>` — positional arg id (string)
- `logs <id>` — positional arg id (string), options `--step <id>` (repeated string), `--follow` (boolean)
- `pause <id>`, `resume <id>` — positional arg id (string)
- `init [--force]` — option `--force` (boolean)
- `install <id> [--force]` — positional arg id (optional string), `--force` (boolean), `--all` (boolean). Validation: exactly one of `<id>` or `--all` required.
- `uninstall <id>` — positional arg id (string)

## Output Formatting

### colors.ts
ANSI escape codes. No external dependency.

```typescript
red, green, yellow, cyan, dim, bold: (s: string) => string
categoryColor(id: string): (s: string) => string  // maps prefix → color
statusColor(status: string): (s: string) => string // maps status → color
```

### table.ts
```typescript
type Column<T> = { header: string; width: number; render: (item: T) => string }
function renderTable<T>(items: T[], columns: Column<T>[]): string
```

Left-aligns columns. Header row in `dim`. Data rows follow. No ANSI border characters — columns separated by 2 spaces.

Status-specific helpers:
- `renderWorkflowTable(items: WorkflowListItem[]): string`
- `renderRunsTable(items: RunSummary[]): string`

## DB Changes

### New query: `listRuns`

`src/db/queries.ts`:
```typescript
export type RunSummary = {
  id: string
  workflow_id: string
  status: string
  started_at: string
  current_step: string | null
}

export function listRuns(
  db: Database,
  opts?: { status?: string; limit?: number }
): RunSummary[]
```

SQL:
```sql
SELECT id, workflow_id, status, started_at, current_step
FROM runs
WHERE (? IS NULL OR status = ?)
ORDER BY started_at DESC
LIMIT ?
```

## Help System

Generated automatically by `@effect/cli`. Each command provides a description via `Command.withDescription(...)`. No custom formatting needed.

```
$ hamilton --help
$ hamilton workflow --help
$ hamilton workflow run --help
```

## Testing Strategy

- **Existing 133 tests**: untouched — they test Effect functions directly, not CLI parsing
- **New tests**:
  - `tests/cli/formatting/table.test.ts` — `renderTable`, `renderWorkflowTable`, `renderRunsTable`
  - `tests/cli/formatting/colors.test.ts` — `categoryColor`, `statusColor`
  - `tests/db/queries.test.ts` — add `listRuns` test cases (all, filtered by status, limited)
- **No CLI integration tests** — `@effect/cli` parsing is tested upstream; our `Command.make` callbacks are thin wrappers around tested Effects

## Dependencies Added

- `@effect/cli` — version to be pinned (check latest compatible with effect 3.21.3)

## Migration Steps

1. Add `@effect/cli` dependency
2. Create `src/cli/formatting/table.ts` and `colors.ts`
3. Create `src/cli/commands/workflow.ts` + all `workflow/*.ts` command files
4. Create `src/cli/commands/doctor.ts` (ported from `rtk.ts` + `checks` array)
5. Rewrite `src/cli/main.ts` to use `@effect/cli` composition
6. Add `listRuns` query to `src/db/queries.ts`
7. Add tests for formatting + `listRuns`
8. Remove `src/cli/commands/rtk.ts`, old `src/cli/commands/list.ts`
9. Run build + 133 existing tests + new tests
