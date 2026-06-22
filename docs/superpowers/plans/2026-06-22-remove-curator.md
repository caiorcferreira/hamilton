# Remove Curator Agent & Refactor Progress Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the curator agent, remove `next-id.txt` and daily progress file mechanisms, and shift `progress.md` ownership to the feature-dev planner agent.

**Architecture:** The planner deduces the change-id from the user prompt by scanning `.hamilton/changes/` directories, creates `progress.md`, and outputs its absolute path in the plan JSON. Downstream agents reference `{{inputs.tasks.plan.outputs.progress_file}}`. The runner becomes a pure DAG executor — no curator, no next-id, no change directory creation, no daily progress file.

**Tech Stack:** TypeScript, bun, Effect-TS, vitest, bun:sqlite

---

### Task 1: Delete the curator module

**Files:**
- Delete: `src/curator/change-id.ts`
- Delete: `tests/curator/change-id.test.ts`

- [ ] **Step 1: Delete the curator source file**

```bash
rm src/curator/change-id.ts
```

- [ ] **Step 2: Delete the curator test file**

```bash
rm tests/curator/change-id.test.ts
```

- [ ] **Step 3: Remove empty curator directory if it becomes empty**

```bash
rmdir src/curator 2>/dev/null || true
rmdir tests/curator 2>/dev/null || true
```

- [ ] **Step 4: Verify `bun run build` still passes (curator imports were only in runner + test)**

```bash
bun run build
```

Expected: exit 0, no errors referencing curator.

- [ ] **Step 5: Commit**

```bash
git add src/curator/ tests/curator/ -A
git commit -m "feat: delete curator agent module"
```

---

### Task 2: Remove next-id functions from change-dir

**Files:**
- Modify: `src/observability/change-dir.ts`
- Modify: `tests/observability/change-dir.test.ts`

- [ ] **Step 1: Remove `readNextId` and `writeNextId` from change-dir.ts**

Read `src/observability/change-dir.ts`. Remove lines 1-34 (the imports for `nextIdFile`, and the functions `readNextId` and `writeNextId` completely). Keep the `ChangeDirError` class, `ensureChangeDir`, and `writeWorkflowMetadata`. The file should look like:

```typescript
import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { changeDir, changeMetadataFile } from "../paths.js"

export class ChangeDirError extends Data.TaggedError("ChangeDirError")<{
  message: string
}> {}

export function ensureChangeDir(changeId: string, projectDir?: string): Effect.Effect<void, ChangeDirError> {
  return Effect.try({
    try: () => {
      const dir = changeDir(changeId, projectDir)
      if (Fs.existsSync(dir)) {
        throw new Error(`Change directory already exists: ${dir}`)
      }
      Fs.mkdirSync(dir, { recursive: true })
    },
    catch: (e) => new ChangeDirError({ message: e instanceof Error ? e.message : `Failed to create change directory for ${changeId}` })
  })
}

export function writeWorkflowMetadata(changeId: string, metadata: Record<string, unknown>, projectDir?: string): Effect.Effect<void, ChangeDirError> {
  return Effect.try({
    try: () => {
      const file = changeMetadataFile(changeId, projectDir)
      const dir = Path.dirname(file)
      Fs.mkdirSync(dir, { recursive: true })
      Fs.writeFileSync(file, JSON.stringify(metadata, null, 2))
    },
    catch: () => new ChangeDirError({ message: `Failed to write workflow metadata for ${changeId}` })
  })
}
```

- [ ] **Step 2: Remove next-id tests from change-dir.test.ts**

Read `tests/observability/change-dir.test.ts`. Remove lines 1-74 (replace the entire file). Also update the import to only import `ensureChangeDir` and `writeWorkflowMetadata`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import {
  ensureChangeDir,
  writeWorkflowMetadata
} from "../../src/observability/change-dir.js"

describe("change directory management", () => {
  let tmpCwd: string
  const originalCwd = process.cwd

  beforeEach(() => {
    tmpCwd = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-changedir-"))
    process.cwd = () => tmpCwd
  })

  afterEach(() => {
    process.cwd = originalCwd
    Fs.rmSync(tmpCwd, { recursive: true, force: true })
  })

  it("ensureChangeDir creates the change directory", async () => {
    const exit = await Effect.runPromiseExit(ensureChangeDir("change-1"))
    expect(Exit.isSuccess(exit)).toBe(true)

    const dir = Path.join(tmpCwd, ".hamilton", "changes", "change-1")
    expect(Fs.existsSync(dir)).toBe(true)
  })

  it("ensureChangeDir returns error if directory already exists", async () => {
    const dir = Path.join(tmpCwd, ".hamilton", "changes", "change-1")
    Fs.mkdirSync(dir, { recursive: true })

    const exit = await Effect.runPromiseExit(ensureChangeDir("change-1"))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it("writeWorkflowMetadata writes metadata.json", async () => {
    Fs.mkdirSync(Path.join(tmpCwd, ".hamilton", "changes", "change-1"), { recursive: true })

    const exit = await Effect.runPromiseExit(writeWorkflowMetadata("change-1", { workflow: "plan", status: "running" }))
    expect(Exit.isSuccess(exit)).toBe(true)

    const file = Path.join(tmpCwd, ".hamilton", "changes", "change-1", "workflow.metadata.json")
    const content = JSON.parse(Fs.readFileSync(file, "utf-8"))
    expect(content).toEqual({ workflow: "plan", status: "running" })
  })
})
```

- [ ] **Step 3: Run the change-dir tests to verify they pass**

```bash
bun --bun vitest run tests/observability/change-dir.test.ts
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/observability/change-dir.ts tests/observability/change-dir.test.ts
git commit -m "refactor: remove next-id functions from change-dir"
```

---

### Task 3: Remove daily progress file from run-dir

**Files:**
- Modify: `src/observability/run-dir.ts`
- Modify: `tests/observability/run-dir.test.ts`

- [ ] **Step 1: Remove `ensureProgressFile` and its path imports from run-dir.ts**

Read `src/observability/run-dir.ts`. Remove the `ensureProgressFile` function (lines 83-97). Remove `progressDir` and `progressFile` from the import block at line 13-14. The import at line 4-15 should become:

```typescript
import {
  runDir,
  taskOutputsDir,
  taskLogsDir,
  taskOutputFile,
  taskLogFile,
  inputFile,
  summaryFile,
  eventsFilePath
} from "../paths.js"
```

Delete the entire `ensureProgressFile` function (lines 83-97, the empty line 82, and the closing line 97 plus any trailing whitespace).

- [ ] **Step 2: Remove `ensureProgressFile` from the test file's import and test cases**

Read `tests/observability/run-dir.test.ts`. Remove `ensureProgressFile` from the import on line 12. Remove the two test cases that reference `ensureProgressFile`: the test starting at line 90 (`"ensureProgressFile creates directory and seeds file"`) through line 113, and the test starting at line 115 (`"ensureProgressFile returns file path"`) through the remainder of the file (line 131). The file should end at line 88 with the `writeSummary` test's closing `})`.

Update the import to:
```typescript
import {
  createRunDir,
  writeInput,
  writeTaskOutput,
  appendTaskLog,
  writeSummary
} from "../../src/observability/run-dir.js"
```

- [ ] **Step 3: Run the run-dir tests to verify they pass**

```bash
bun --bun vitest run tests/observability/run-dir.test.ts
```

Expected: 5 tests pass (createRunDir, writeInput, writeTaskOutput, appendTaskLog, writeSummary), 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/observability/run-dir.ts tests/observability/run-dir.test.ts
git commit -m "refactor: remove daily progress file from run-dir"
```

---

### Task 4: Remove progress path helpers from paths.ts

**Files:**
- Modify: `src/paths.ts`
- Modify: `tests/paths.test.ts`

- [ ] **Step 1: Remove `progressDir`, `progressFile`, and `nextIdFile` from paths.ts**

Read `src/paths.ts`. Remove lines 66-74 (`progressDir` function), lines 71-74 (`progressFile` function), and lines 85-88 (`nextIdFile` function). Also remove the trailing empty line separating them. The functions to remove are:

- `progressDir` (lines 66-69)
- `progressFile` (lines 71-74)
- `nextIdFile` (lines 85-88)

After removal, the `changeDir` function (line 80-83) should be followed directly by `changeMetadataFile` (line 90-92) with only one blank line between them.

- [ ] **Step 2: Remove path helper tests from paths.test.ts**

Read `tests/paths.test.ts`. Remove the `progressDir` import from line 15, `progressFile` from line 16. Remove the test cases:

- `"progressDir returns .hamilton/workflows relative to cwd"` (lines 85-93)
- `"progressFile returns dated filename"` (lines 95-111)

The file should have no remaining reference to `progressDir`, `progressFile`, or `nextIdFile` (which was not imported in the test file). After removal, the test on line 113 (`"guidelinesDir returns ~/.hamilton/guidelines"`) should follow the `summaryFile` test directly.

- [ ] **Step 3: Run the paths tests to verify they pass**

```bash
bun --bun vitest run tests/paths.test.ts
```

Expected: 11 tests pass (all except the 2 removed), 0 fail.

- [ ] **Step 4: Commit**

```bash
git add src/paths.ts tests/paths.test.ts
git commit -m "refactor: remove progress and next-id path helpers"
```

---

### Task 5: Remove progress fields from WorkflowEnv type

**Files:**
- Modify: `src/workflow/env.ts`

- [ ] **Step 1: Remove `progress_file` and `progress` fields**

Read `src/workflow/env.ts`. Remove lines 5-6:
```typescript
  progress_file?: string
  progress?: string
```

The file should be:

```typescript
export interface WorkflowEnv {
  cwd?: string
  user_input?: string
  run_id?: string
  change_dir?: string
  tasks?: Record<string, { outputs: Record<string, unknown> }>
  parameters?: Record<string, unknown>
  currentIteration?: {
    tasks?: Record<string, { outputs: Record<string, unknown> }>
  }
  [key: string]: unknown
}
```

- [ ] **Step 2: Commit**

```bash
git add src/workflow/env.ts
git commit -m "refactor: remove progress fields from WorkflowEnv type"
```

---

### Task 6: Refactor runner — remove curator, next-id, progress logic; add project_dir

**Files:**
- Modify: `src/workflow/runner.ts`

- [ ] **Step 1: Remove curator and change-dir imports**

Read `src/workflow/runner.ts`. On line 26, remove the entire line:
```typescript
import { readNextId, writeNextId, ensureChangeDir, writeWorkflowMetadata } from "../observability/change-dir.js"
```

On line 27, remove the entire line:
```typescript
import { determineChangeId } from "../curator/change-id.js"
```

On line 24, remove `ensureProgressFile` from the import (keep the other five imports):
```typescript
import {
  createRunDir,
  writeInput,
  writeTaskOutput,
  writeSummary,
  appendEngineLog
} from "../observability/run-dir.js"
```

- [ ] **Step 2: Remove the curator + next-id + change-dir block (lines 93-120)**

Read `src/workflow/runner.ts`. Remove the entire block starting at line 93 (`let changeId: string | null = null`) through line 120 (`}).pipe(Effect.catchAll(() => Effect.void)))`). This removes:
- `let changeId: string | null = null` (line 93)
- The entire `Effect.gen` block (lines 94-120)
- The empty line 121 before `if (fileEnabled)`

- [ ] **Step 3: Remove the progress file creation block (lines 146-158)**

Read `src/workflow/runner.ts`. Remove lines 146-157 (the `ensureProgressFile` call and `progressContent` read). Replace the workflowEnv construction at lines 151-158 with:

```typescript
    const workflowEnv: WorkflowEnv = {
      ...initialParameters,
      project_dir: config.projectDir ?? process.cwd(),
      tasks: {},
      run_id: runId
    }
```

Ensure the surrounding blank lines are preserved — the workflowEnv construction should be preceded by the `skillRegistry` line and followed by the `resolveMaxRecursionDepth` line.

Also remove line 30:
```typescript
import * as Fs from "node:fs"
```

It was only used by the progressContent read (now removed). Check that no other code in runner.ts references `Fs` — the only usage was `Fs.existsSync` and `Fs.readFileSync` in the progress block.

- [ ] **Step 4: Verify build passes**

```bash
bun run build
```

Expected: exit 0, no errors.

- [ ] **Step 5: Check that vtests still pass (will fail, this is expected — we update the run test next)**

```bash
bun --bun vitest run tests/cli/run.test.ts
```

Expected: might fail due to curator mock being removed or undefined variables. This is expected — we'll fix in the next task.

- [ ] **Step 6: Commit**

```bash
git add src/workflow/runner.ts
git commit -m "refactor: remove curator, next-id, and progress logic from runner"
```

---

### Task 7: Update CLI run test after runner changes

**Files:**
- Modify: `tests/cli/run.test.ts`

- [ ] **Step 1: Remove curator mock**

Read `tests/cli/run.test.ts`. Remove the entire curator mock block (lines 23-29):
```typescript
vi.mock("../../src/curator/change-id.js", () => {
  const { Effect: E } = require("effect")
  return {
    determineChangeId: vi.fn(() => E.succeed("test-change")),
    CURATOR_SYSTEM_PROMPT: ""
  }
})
```

- [ ] **Step 2: Remove `vi` import if no longer needed**

The `vi` import on line 1 is still needed for `vi.mock` and `vi.mocked` (used by executeWithPi mock). Keep it.

- [ ] **Step 3: Run CLI run test to verify it passes**

```bash
bun --bun vitest run tests/cli/run.test.ts
```

Expected: 3 tests pass, 0 fail.

- [ ] **Step 4: Commit**

```bash
git add tests/cli/run.test.ts
git commit -m "test: remove curator mock from CLI run test"
```

---

### Task 8: Add progress_file to plan output schema

**Files:**
- Modify: `bundle/workflows/feature-dev/schemas/plan.json`

- [ ] **Step 1: Add progress_file field to the properties**

Read `bundle/workflows/feature-dev/schemas/plan.json`. Add a new property after the existing `change_id` field (after line 10):

```json
    "progress_file": { "type": "string" },
```

The properties block should show:
```json
    "change_id": { "type": "string" },
    "progress_file": { "type": "string" },
    "artifacts": {
```

- [ ] **Step 2: Verify the JSON is valid**

```bash
bun -e "console.log(JSON.parse(require('fs').readFileSync('bundle/workflows/feature-dev/schemas/plan.json','utf8')))"
```

Expected: prints the parsed JSON without errors.

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/feature-dev/schemas/plan.json
git commit -m "feat: add progress_file to plan output schema"
```

---

### Task 9: Update planner INSTRUCTIONS.md

**Files:**
- Modify: `bundle/workflows/feature-dev/agents/planner/INSTRUCTIONS.md`

- [ ] **Step 1: Add change-id deduction and progress.md creation to the Output section**

Read `bundle/workflows/feature-dev/agents/planner/INSTRUCTIONS.md`. Replace the entire "## Output" section (lines 141-158) with:

```markdown
## Output

Before writing your JSON task output:

1. **Deduce the change-id** from the user prompt. Scan `{{project_dir}}/.hamilton/changes/` for subdirectories. Match the user prompt against directory contents (proposal.md title, design.md context). If no matching directory is found, output `status: "failed"` with the message "No matching change directory found in .hamilton/changes/ — run hamilton-propose first".

2. **Write the plan** to `{{project_dir}}/.hamilton/changes/<change-id>/plan.md` — use the markdown format from this document (header, file structure, tasks with steps). Include ALL task details — no placeholders. This is the canonical record of the plan for this change.

3. **Create `progress.md`** at `{{project_dir}}/.hamilton/changes/<change-id>/progress.md` with this initial content:

```markdown
# Progress Log

## Change: <change-id>

---
```

4. After writing both files, call `write_step_output` with this JSON:

```json
{
  "status": "done",
  "change_id": "<deduced-change-id>",
  "progress_file": "<absolute path to progress.md>",
  "artifacts": ["<path to plan.md>"],
  "tasks": [ {...} ]
}
```
```

- [ ] **Step 2: Update the Plan Schema example to include progress_file**

In the same file, under `## Plan Schema` (line 53), update the JSON example to include `progress_file`:

Replace the `"Every plan MUST have the following general fields:"` JSON block (lines 53-59) with:

```json
{
  "change_id": "<change id for which the plan is being built.>",
  "progress_file": "<absolute path to .hamilton/changes/<change-id>/progress.md>",
  "artifacts": ["/path/to/proposal.md", "/path/to/design.md", "/path/to/requeriments/capability1/requeriments.md", "/path/to/requeriments/capability2/requeriments.md"],
  "tasks": [{...}]
}
```

- [ ] **Step 3: Commit**

```bash
git add bundle/workflows/feature-dev/agents/planner/INSTRUCTIONS.md
git commit -m "feat: add change-id deduction and progress.md creation to planner"
```

---

### Task 10: Update developer INSTRUCTIONS.md

**Files:**
- Modify: `bundle/workflows/feature-dev/agents/developer/INSTRUCTIONS.md`

- [ ] **Step 1: Replace progress file references in the developer instructions**

Read `bundle/workflows/feature-dev/agents/developer/INSTRUCTIONS.md`. Make these changes:

**In Phase 1 (line 21):** Replace:
```markdown
1. **Read `{{inputs.progress_file}}`** — start with the **Codebase Patterns** section at the top; these are patterns discovered by previous sessions that you should follow.
2. **Locate the relevant codebase** for your story.
3. **Check git status** is clean. Pull latest if needed.
4. **Understand the task fully** before writing any code. Review the Story Plan section in `{{inputs.progress_file}}` to see how your story fits into the broader feature.
```

With:
```markdown
1. **Read `{{inputs.tasks.plan.outputs.progress_file}}`** — this contains context from previous sessions and the overall plan structure.
2. **Locate the relevant codebase** for your story.
3. **Check git status** is clean. Pull latest if needed.
4. **Understand the task fully** before writing any code. Review the plan structure in the progress file to see how your story fits into the broader feature.
```

**In Phase 7 (line 72):** Replace the entire Phase 7 block (lines 70-92) with:

```markdown
### Phase 7 — Document Learnings

12. **Append to `{{inputs.tasks.plan.outputs.progress_file}}`** with a completion block:

    ```markdown
    ## <date/time> - <story-id>: <title>
    - What was implemented
    - Files changed
    - **Learnings:** codebase patterns, gotchas, useful context
    ---
    ```

13. **Update the codebase patterns section** in `{{inputs.tasks.plan.outputs.progress_file}}` if you discovered reusable patterns. Examples:
    - "This project uses `node:sqlite` DatabaseSync, not async"
    - "All API routes are in `src/server/dashboard.ts`"
    - "Tests use node:test, run with `node --test`"

14. **Update `AGENTS.md`** if you learned something structural about the codebase:
    - Project stack/framework
    - How to run tests
    - Key file locations
    - Dependencies between modules
    - Gotchas
```

**In Progress section (lines 100-120):** Replace:
```markdown
After completing your work, you MUST append a progress entry to `{{inputs.change_dir}}/progress.md`:
```

With:
```markdown
After completing your work, you MUST append a progress entry to `{{inputs.tasks.plan.outputs.progress_file}}`:
```

**In Result section (line 142):** Remove the stale references to `progress_file` in the closing note. Lines 137-142:
```markdown
Before finalizing, ask yourself:
- Did I learn something about this codebase?
- Did I find a pattern that works well here?
- Did I discover a gotcha future developers should know?

If yes, ensure you've updated `AGENTS.md` or `{{inputs.progress_file}}` accordingly.
```

Replace with:
```markdown
Before finalizing, ask yourself:
- Did I learn something about this codebase?
- Did I find a pattern that works well here?
- Did I discover a gotcha future developers should know?

If yes, ensure you've updated `AGENTS.md` or `{{inputs.tasks.plan.outputs.progress_file}}` accordingly.
```

**Delete the Reference section (lines 146-178):** Remove the entire `## Reference: progress.txt Format` section. The progress format is now defined by the planner and documented inline above.

- [ ] **Step 2: Commit**

```bash
git add bundle/workflows/feature-dev/agents/developer/INSTRUCTIONS.md
git commit -m "feat: update developer agent to use plan output for progress tracking"
```

---

### Task 11: Update tester INSTRUCTIONS.md

**Files:**
- Modify: `bundle/workflows/feature-dev/agents/tester/INSTRUCTIONS.md`

- [ ] **Step 1: Replace progress file references in the tester instructions**

Read `bundle/workflows/feature-dev/agents/tester/INSTRUCTIONS.md`. Replace the `## Progress` section (lines 64-86). Change all occurrences of `{{inputs.change_dir}}/progress.md` to `{{inputs.tasks.plan.outputs.progress_file}}`:

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.tasks.plan.outputs.progress_file}}`:

```markdown
## <iso-timestamp> — tester (<model-used>)

- What you accomplished
- Files changed

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---
```

Then append your entry.
```

- [ ] **Step 2: Commit**

```bash
git add bundle/workflows/feature-dev/agents/tester/INSTRUCTIONS.md
git commit -m "feat: update tester agent to use plan output for progress tracking"
```

---

### Task 12: Update verifier INSTRUCTIONS.md (shared agent, used by feature-dev)

**Files:**
- Modify: `bundle/agents/verifier/INSTRUCTIONS.md`

- [ ] **Step 1: Replace progress file references in the verifier instructions**

Read `bundle/agents/verifier/INSTRUCTIONS.md`. Replace the `## Progress` section (lines 90-112). Change all occurrences of `{{inputs.change_dir}}/progress.md` to `{{inputs.tasks.plan.outputs.progress_file}}`:

```markdown
## Progress

After completing your work, you MUST append a progress entry to `{{inputs.tasks.plan.outputs.progress_file}}`:

```markdown
## <iso-timestamp> — verifier (<model-used>)

- What you accomplished
- Files changed

---
```

If the file doesn't exist yet, create it with a header:

```markdown
# Progress Log

---
```

Then append your entry.
```

- [ ] **Step 2: Commit**

```bash
git add bundle/agents/verifier/INSTRUCTIONS.md
git commit -m "feat: update verifier agent to use plan output for progress tracking"
```

---

### Task 13: Clean up docs

**Files:**
- Modify: `docs/advanced.md`
- Modify: `docs/settings.md`

- [ ] **Step 1: Update docs/advanced.md — remove next-id and progress file references**

Read `docs/advanced.md`. Replace the "Project Files" section (lines 451-458):

```markdown
Hamilton creates and reads project-local files:

```
<repo>/.hamilton/
  changes/
    <change-id>/workflow.metadata.json  # Per-change metadata
    <change-id>/progress.md             # Append-only agent progress log
    <change-id>/plan.md                 # Implementation plan
```
```

- [ ] **Step 2: Update docs/settings.md — remove progress file and next-id sections**

Read `docs/settings.md`. Replace the "Progress Files" section (lines 267-271) and "Change Directories" section (lines 273-277) with:

```markdown
### Change Directories (`./.hamilton/changes/`)

Change directories track per-change artifacts. Located at
`./.hamilton/changes/<change-id>/`. Each directory contains:

- `progress.md` — append-only log written by workflow agents
- `plan.md` — implementation plan written by the planner agent
- `workflow.metadata.json` — workflow execution metadata
```

- [ ] **Step 3: Commit**

```bash
git add docs/advanced.md docs/settings.md
git commit -m "docs: remove next-id and daily progress file references"
```

---

### Task 14: Run full test suite and build

- [ ] **Step 1: Run the full test suite**

```bash
bun --bun vitest run
```

Expected: All 155 tests pass (minus the removed curator + next-id + progress tests, plus any from the updated test files).

- [ ] **Step 2: Run the build**

```bash
bun run build
```

Expected: exit 0, no errors.

- [ ] **Step 3: Run install-local to verify CLI works**

```bash
bun run install-local
```

Expected: exit 0, symlink created.

- [ ] **Step 4: Commit any final adjustments**

```bash
git add -A
git commit -m "chore: final verification after full test suite run"
```
