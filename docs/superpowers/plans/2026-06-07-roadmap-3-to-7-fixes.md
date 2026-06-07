# Roadmap Issues 3–7 Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 issues from ROADMAP.md "Next Up": template rendering, run command output, output schemas, write_step_output JSON object, and status command ordering/formatting.

**Architecture:** Each issue is fixed independently with explicit steps. Template rendering (Task 1) is prerequisite for Task 3. All other tasks are independent and can run in parallel after Task 1.

**Tech Stack:** TypeScript, bun, Effect-TS, Pi SDK, SQLite, vitest

---

## File Map

| File | Change | Purpose |
|------|--------|---------|
| `src/workflow/context.ts` | Modify | Dotted-path template resolution, vars merging in buildAutoContext |
| `src/workflow/runner.ts` | Modify | Add `run_id` to initial runningContext |
| `workflows/*/workflow.yml` | Modify (20 files) | Update `{{key}}` placeholders to dotted paths |
| `tests/workflow/context.test.ts` | Modify | Add dotted-path + vars merging tests |
| `src/cli/commands/run.ts` | Modify | Import + wire CliRenderer |
| `src/cli/commands/resume.ts` | Modify | Import + wire CliRenderer |
| `src/agent/write-step-output-tool.ts` | Modify | Change input type from String to Object |
| `tests/agent/write-step-output-tool.test.ts` | Modify | Update tests for object input |
| `src/cli/commands/status.ts` | Modify | Topological sort, newline display, section reorder |
| `tests/cli/status.test.ts` | Modify | Add ordering + formatting tests |

---

### Task 1: Template Rendering — Code Changes

**Files:**
- Modify: `src/workflow/context.ts:17-23`
- Modify: `src/workflow/context.ts:29-47`
- Modify: `src/workflow/runner.ts:69`
- Modify: `tests/workflow/context.test.ts`

- [ ] **Step 1: Change `resolveTemplate` to support dotted paths**

Open `src/workflow/context.ts`. Replace the regex and resolution logic in `resolveTemplate` (lines 17-23):

```typescript
export function resolveTemplate(template: string, context: Context): string {
  return template.replace(/\{\{([\w.]+)\}\}/g, (match, key) => {
    const value = resolveDottedPath(context, key)
    if (value === undefined) return match
    return typeof value === "string" ? value : JSON.stringify(value)
  })
}
```

The change: `/\{\{(\w+)\}\}/g` becomes `/\{\{([\w.]+)\}\}/g` and delegates to `resolveDottedPath` instead of direct key lookup.

- [ ] **Step 2: Fix `buildAutoContext` to merge vars when no context.fields**

Open `src/workflow/context.ts`. Replace the return at line 46:

```typescript
  if (task.context) {
    const result: Context = {}
    for (const field of task.context.fields) {
      const ref = field.valueFrom.ref
      if (ref.startsWith("vars.")) {
        result[field.name] = resolveDottedPath({ vars }, ref)
      } else {
        result[field.name] = resolveDottedPath(allOutputs, ref)
      }
    }
    return result
  }
  return { ...allOutputs, ...vars }
```

The last line changes from `return allOutputs` to `return { ...allOutputs, ...vars }`. This ensures forEach loop variables (like `current_story`) are accessible via `{{vars.current_story}}` in templates.

- [ ] **Step 3: Add `run_id` to initial runningContext**

Open `src/workflow/runner.ts`. At line 69, after `const runningContext: Context = { ...initialContext, tasks: {} }`, add `run_id`:

```typescript
    const runningContext: Context = { ...initialContext, tasks: {}, run_id: runId }
```

This makes `{{run_id}}` resolve in all task prompts. `runId` is available from line 57.

- [ ] **Step 4: Add tests for dotted-path template and vars merging**

Open `tests/workflow/context.test.ts`. Add these test blocks after the existing `resolveTemplate` describe (after line 58):

```typescript
describe("resolveTemplate with dotted paths", () => {
  it("resolves dotted-path placeholders", () => {
    const ctx = {
      tasks: {
        setup: { outputs: { repo: "/tmp/repo", branch: "feature/x", build_cmd: "npm run build" } },
        plan: { outputs: { stories_json: [{ id: "US-001" }] } }
      }
    }
    expect(resolveTemplate("REPO: {{tasks.setup.repo}}", ctx)).toBe("REPO: /tmp/repo")
    expect(resolveTemplate("BRANCH: {{tasks.setup.branch}}", ctx)).toBe("BRANCH: feature/x")
    expect(resolveTemplate("BUILD: {{tasks.setup.build_cmd}}", ctx)).toBe("BUILD: npm run build")
    expect(resolveTemplate("STORIES: {{tasks.plan.outputs.stories_json}}", ctx))
      .toBe('STORIES: [{"id":"US-001"}]')
  })

  it("resolves vars.current_story from forEach vars", () => {
    const ctx = {
      vars: { current_story: { id: "US-001", title: "Add feature" } }
    }
    expect(resolveTemplate("STORY: {{vars.current_story}}", ctx))
      .toBe('STORY: {"id":"US-001","title":"Add feature"}')
    expect(resolveTemplate("ID: {{vars.current_story.id}}", ctx)).toBe("ID: US-001")
    expect(resolveTemplate("TITLE: {{vars.current_story.title}}", ctx)).toBe("TITLE: Add feature")
  })

  it("resolves multi-level dotted path", () => {
    const ctx = { tasks: { setup: { outputs: { repo: { url: "github.com/x" } } } } }
    expect(resolveTemplate("URL: {{tasks.setup.repo.url}}", ctx)).toBe("URL: github.com/x")
  })

  it("keeps unreplaced template with dotted path intact", () => {
    expect(resolveTemplate("MISSING: {{tasks.nonexistent.field}}", {})).toBe("MISSING: {{tasks.nonexistent.field}}")
  })
})
```

Add to `buildAutoContext` tests, after the existing describe (after line 126):

```typescript
  it("merges vars into allOutputs when no context.fields defined", () => {
    const allOutputs = {
      tasks: {
        setup: { outputs: { repo: "/tmp/repo" } }
      }
    }
    const vars = { current_story: { id: "US-001", title: "Add feature" } }
    const task: WorkflowTask = { name: "implement-story" }
    const result = buildAutoContext(task, allOutputs, vars)
    expect(result.setup).toEqual({ outputs: { repo: "/tmp/repo" } })
    expect(result.current_story).toEqual({ id: "US-001", title: "Add feature" })
  })
```

- [ ] **Step 5: Run context tests**

```bash
bun --bun vitest run tests/workflow/context.test.ts
```

Expected: All tests pass (existing + new 6 tests). If failures, fix before continuing.

- [ ] **Step 6: Update all workflow YAML templates**

Run a `sed` script to replace common patterns across all files. Run this from the repo root:

```bash
# Common replacements for all workflows
for f in workflows/*/workflow.yml; do
  sed -i '' \
    -e 's/{{repo}}/{{tasks.setup.repo}}/g' \
    -e 's/{{branch}}/{{tasks.setup.branch}}/g' \
    -e 's/{{build_cmd}}/{{tasks.setup.build_cmd}}/g' \
    -e 's/{{test_cmd}}/{{tasks.setup.test_cmd}}/g' \
    -e 's/{{original_branch}}/{{tasks.setup.original_branch}}/g' \
    -e 's/{{worktree_origin_repository}}/{{tasks.setup.worktree_origin_repository}}/g' \
    -e 's/{{stories_json}}/{{tasks.plan.outputs.stories_json}}/g' \
    -e 's/{{current_story}}/{{vars.current_story}}/g' \
    -e 's/{{current_story_id}}/{{vars.current_story.id}}/g' \
    -e 's/{{current_story_title}}/{{vars.current_story.title}}/g' \
    "$f"
done
```

This uses `sed -i ''` (macOS syntax). For Linux, use `sed -i` without the `''`.

- [ ] **Step 7: Verify no stray {{repo}}, {{branch}}, etc. remain**

```bash
grep -r '{{repo}}\|{{branch}}\|{{build_cmd}}\|{{test_cmd}}' workflows/
```

Expected: **zero matches**. If any remain, check which file and fix manually.

- [ ] **Step 8: Run the full test suite**

```bash
bun --bun vitest run
```

Expected: All 155+ tests pass. Fix any regressions before continuing.

- [ ] **Step 9: Commit**

```bash
git add src/workflow/context.ts src/workflow/runner.ts tests/workflow/context.test.ts workflows/
git commit -m "fix: dotted-path template rendering (issue 6)"
```

---

### Task 2: Run Command Output

**Files:**
- Modify: `src/cli/commands/run.ts`
- Modify: `src/cli/commands/resume.ts`

- [ ] **Step 1: Wire CliRenderer into executeRun**

Open `src/cli/commands/run.ts`. Add import at line 9:

```typescript
import { CliRenderer } from "../subscribers.js"
```

Modify the `Effect.scoped` block (lines 67-72) to include `CliRenderer`:

```typescript
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          yield* CliRenderer
          return yield* executeRun({ workflowSlug: slug, prompt: promptText })
        })
      ).pipe(Effect.provide(EventBusLive))
```

- [ ] **Step 2: Wire CliRenderer into resetWorkflow**

Open `src/cli/commands/resume.ts`. Add import at line 12:

```typescript
import { CliRenderer } from "../subscribers.js"
```

Modify the `Effect.scoped` block (lines 66-75) to include `CliRenderer`:

```typescript
      Effect.scoped(
        Effect.gen(function* () {
          yield* FileLogger
          yield* CliRenderer
          return yield* runWorkflow(spec as unknown as WorkflowSpec, context, {
            workflowsDir: wfDir
          }, runId).pipe(
            Effect.mapError((e) => new ResumeError({ runId, message: String(e) }))
          )
        })
      ).pipe(Effect.provide(EventBusLive))
```

- [ ] **Step 3: Run tests**

```bash
bun --bun vitest run tests/cli/run.test.ts tests/cli/resume.test.ts
```

Expected: All pass. The `CliRenderer` subscriber is fork-scoped so it won't affect the test output (which mocks Pi execution and tests return values, not stdout).

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/run.ts src/cli/commands/resume.ts
git commit -m "fix: wire CliRenderer into run and resume commands (issue 4)"
```

---

### Task 3: Output Schemas — Add to All Workflow YAMLs

**Files:**
- Modify: `workflows/*/workflow.yml` (20 files, ~50-60 task agent entries)

This task adds `output.schema` to every task agent in every workflow YAML. Schemas are defined by agent role based on the documented AGENTS.md output formats.

**Schema rules for all schemas:**
- `required` includes only `["status"]`
- No `additionalProperties: false` — extra fields pass through
- `type: "object"` at root

- [ ] **Step 1: Write a bash script to add output schemas**

Create a script at `/tmp/add-output-schemas.sh`:

```bash
#!/bin/bash
set -e

add_schema() {
  local file="$1"
  local agent_ref="$2"
  local schema="$3"
  python3 -c "
import sys, re
content = open('$file').read()
agent_block_pattern = r'(agent:\s*\n(\s+ref:\s*$agent_ref\s*\n.*?))(?=\n\s+on_failure:|\n\s+\n\s+- name:|\Z)'

def insert_schema(match):
  block = match.group(0)
  if 'output:' not in block:
    lines = block.split('\n')
    ref_line_idx = next(i for i, l in enumerate(lines) if 'ref:' in l and '$agent_ref' in l)
    prompt_end_idx = ref_line_idx
    for i in range(ref_line_idx + 1, len(lines)):
      if lines[i].strip().startswith('prompt:'):
        prompt_end_idx = i
        for j in range(i + 1, len(lines)):
          if lines[j].strip() and not lines[j].startswith(' '):
            prompt_end_idx = j - 1
            break
          prompt_end_idx = j
    schema_block = '''$schema'''
    lines.insert(prompt_end_idx + 1, schema_block)
    return '\n'.join(lines)
  return block

new_content = re.sub(agent_block_pattern, insert_schema, content, flags=re.DOTALL)
open('$file', 'w').write(new_content)
" "$file" "$agent_ref" "$schema"
}

# Schema definitions by role
PLANNER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        repo:
          type: string
        branch:
          type: string
        stories_json:
          type: array'

SETUP_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        original_branch:
          type: string
        build_cmd:
          type: string
        test_cmd:
          type: string
        ci_notes:
          type: string
        baseline:
          type: string
        worktree_origin_repository:
          type: string'

DEVELOPER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        repo:
          type: string
        branch:
          type: string
        commits:
          type: string
        changes:
          type: string
        tests:
          type: string'

VERIFIER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done, retry]
        verified:
          type: string
        issues:
          type: array'

TESTER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done, retry]
        results:
          type: string
        failures:
          type: array'

FIXER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        changes:
          type: string
        tests:
          type: string'

TRIAGER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        repo:
          type: string
        branch:
          type: string
        priority:
          type: string
        assigned_to:
          type: string
        severity:
          type: string
        affected_area:
          type: string
        reproduction:
          type: string
        problem_statement:
          type: string'

INVESTIGATOR_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        root_cause:
          type: string
        affected_files:
          type: array
        severity:
          type: string
        fix_approach:
          type: string
        problem_statement:
          type: string
        regression_test:
          type: string'

SCANNER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        findings:
          type: array
        summary:
          type: string
        repo:
          type: string
        vulnerability_count:
          type: string'

PRIORITIZER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        prioritized_findings:
          type: array
        fix_plan:
          type: string
        critical_count:
          type: string
        high_count:
          type: string
        deferred:
          type: string'

SCAFFOLDER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        project_dir:
          type: string
        stack:
          type: string
        files_created:
          type: array
        build_cmd:
          type: string
        test_cmd:
          type: string'

DOER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        result:
          type: string
        changes:
          type: string'

QUARANTINER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done, failed]
        quarantined_tests:
          type: array
        reason:
          type: string
        disabled:
          type: string
        summary:
          type: string'

PR_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        pr:
          type: string'

REVIEWER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done]
        approved:
          type: boolean
        comments:
          type: string'

MERGER_SCHEMA='  output:
    schema:
      type: object
      required: [status]
      properties:
        status:
          type: string
          enum: [done, retry]
        merged_branch:
          type: string
        merged_into:
          type: string
        reason:
          type: string'

cd /Users/caio.cavalcante/ifood/playground/hamilton

# Apply schemas to each workflow

# feature-dev variants (all have planner, setup, developer, verifier, tester)
for wf in feature-dev feature-dev-merge feature-dev-worktree feature-dev-merge-worktree feature-dev-github-pr; do
  add_schema "workflows/$wf/workflow.yml" "agents.planner" "$PLANNER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.setup" "$SETUP_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.developer" "$DEVELOPER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.verifier" "$VERIFIER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.tester" "$TESTER_SCHEMA" 2>/dev/null || true
done

# feature-dev-github-pr has extra reviewer and pr agents
add_schema "workflows/feature-dev-github-pr/workflow.yml" "agents.reviewer" "$REVIEWER_SCHEMA" 2>/dev/null || true
add_schema "workflows/feature-dev-github-pr/workflow.yml" "agents.pr" "$PR_SCHEMA" 2>/dev/null || true

# feature-dev-merge variants have merger
for wf in feature-dev-merge feature-dev-merge-worktree; do
  add_schema "workflows/$wf/workflow.yml" "agents.merger" "$MERGER_SCHEMA" 2>/dev/null || true
done

# bug-fix variants (triager, investigator, setup, fixer)
for wf in bug-fix bug-fix-worktree bug-fix-merge bug-fix-merge-worktree bug-fix-github-pr; do
  add_schema "workflows/$wf/workflow.yml" "agents.triager" "$TRIAGER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.investigator" "$INVESTIGATOR_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.setup" "$SETUP_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.fixer" "$FIXER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.verifier" "$VERIFIER_SCHEMA" 2>/dev/null || true
done

# bug-fix-merge variants have merger
for wf in bug-fix-merge bug-fix-merge-worktree; do
  add_schema "workflows/$wf/workflow.yml" "agents.merger" "$MERGER_SCHEMA" 2>/dev/null || true
done

# bug-fix-github-pr has pr agent
add_schema "workflows/bug-fix-github-pr/workflow.yml" "agents.pr" "$PR_SCHEMA" 2>/dev/null || true

# security-audit variants (prioritizer, scanner, setup, fixer, verifier, tester)
for wf in security-audit security-audit-worktree security-audit-merge security-audit-merge-worktree security-audit-github-pr; do
  add_schema "workflows/$wf/workflow.yml" "agents.prioritizer" "$PRIORITIZER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.scanner" "$SCANNER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.setup" "$SETUP_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.fixer" "$FIXER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.verifier" "$VERIFIER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.tester" "$TESTER_SCHEMA" 2>/dev/null || true
done

# security-audit-merge variants have merger
for wf in security-audit-merge security-audit-merge-worktree; do
  add_schema "workflows/$wf/workflow.yml" "agents.merger" "$MERGER_SCHEMA" 2>/dev/null || true
done

# security-audit-github-pr has pr
add_schema "workflows/security-audit-github-pr/workflow.yml" "agents.pr" "$PR_SCHEMA" 2>/dev/null || true

# quarantine-broken-tests variants
for wf in quarantine-broken-tests quarantine-broken-tests-merge quarantine-broken-tests-merge-worktree; do
  add_schema "workflows/$wf/workflow.yml" "agents.setup" "$SETUP_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.quarantiner" "$QUARANTINER_SCHEMA" 2>/dev/null || true
  add_schema "workflows/$wf/workflow.yml" "agents.verifier" "$VERIFIER_SCHEMA" 2>/dev/null || true
done

# quarantine merge variants have merger
for wf in quarantine-broken-tests-merge quarantine-broken-tests-merge-worktree; do
  add_schema "workflows/$wf/workflow.yml" "agents.merger" "$MERGER_SCHEMA" 2>/dev/null || true
done

# greenfield (scaffolder, developer, tester)
add_schema "workflows/greenfield/workflow.yml" "agents.scaffolder" "$SCAFFOLDER_SCHEMA" 2>/dev/null || true
add_schema "workflows/greenfield/workflow.yml" "agents.developer" "$DEVELOPER_SCHEMA" 2>/dev/null || true
add_schema "workflows/greenfield/workflow.yml" "agents.tester" "$TESTER_SCHEMA" 2>/dev/null || true

# do (doer)
add_schema "workflows/do/workflow.yml" "agents.doer" "$DOER_SCHEMA" 2>/dev/null || true
```

- [ ] **Step 2: Run the script**

```bash
chmod +x /tmp/add-output-schemas.sh
bash /tmp/add-output-schemas.sh
```

- [ ] **Step 3: Verify schemas were added**

```bash
grep -l 'output:' workflows/*/workflow.yml | wc -l
```

Expected: 20 (all workflow YAMLs now have `output:` sections).

```bash
grep -c 'output:' workflows/*/workflow.yml
```

Check that each file has appropriate counts (e.g., feature-dev should have 5 schema blocks — one per agent task).

- [ ] **Step 4: Verify YAML parsing still works**

```bash
bun --bun vitest run tests/workflow/loader.test.ts
```

Expected: All pass. The added `output.schema` sections must be valid YAML.

- [ ] **Step 5: Run schema validation tests**

```bash
bun --bun vitest run tests/agent/write-step-output-tool.test.ts
```

Expected: All pass. Existing schema validation tests should still work.

- [ ] **Step 6: Commit**

```bash
git add workflows/
git commit -m "feat: add output schemas to all workflow task agents (issue 3)"
```

---

### Task 4: write_step_output JSON Object

**Files:**
- Modify: `src/agent/write-step-output-tool.ts`
- Modify: `tests/agent/write-step-output-tool.test.ts`

- [ ] **Step 1: Change parameter type from String to Object**

Open `src/agent/write-step-output-tool.ts`. Replace lines 8-10:

```typescript
const paramsSchema = Type.Object({
  input: Type.Object({
    status: Type.String({ description: "Completion state: 'done', 'retry', or 'failed'" })
  }, { additionalProperties: true })
})
```

This changes the parameter from `Type.String` to a `Type.Object` with required `status` field and arbitrary additional properties.

- [ ] **Step 2: Remove JSON.parse and update validation**

Replace the `execute` function body (lines 35-90) with the updated version that doesn't use `JSON.parse` and handles the object input directly:

```typescript
    execute: async (_toolCallId, { input }, _signal, _onUpdate, _ctx) => {
      const outputsDir = stepOutputsDir(runId)
      const outputPath = stepOutputFile(runId, stepId)

      if (Fs.existsSync(outputPath)) {
        return {
          content: [textContent("Error: Output already written for this step. write_step_output can only be called once.")],
          details: {}
        }
      }

      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return {
          content: [textContent("Error: Input must be a JSON object (not an array, null, or primitive value).")],
          details: {}
        }
      }

      const obj = input as Record<string, unknown>
      if (typeof obj.status !== "string" || obj.status.length === 0) {
        return {
          content: [textContent("Error: Missing required field 'status' (must be a non-empty string). Example: { \"status\": \"done\", ... }")],
          details: {}
        }
      }

      if (validate && !validate(obj)) {
        const errors = validate.errors
          ? validate.errors.map((e) => `${e.instancePath} ${e.message}`).join("; ")
          : "Unknown validation error"
        return {
          content: [textContent(`Error: Output failed schema validation: ${errors}. Please correct your output and try again.`)],
          details: {}
        }
      }

      Fs.mkdirSync(outputsDir, { recursive: true })
      Fs.writeFileSync(outputPath, JSON.stringify(obj, null, 2))

      cb?.onStepComplete()

      return {
        content: [textContent("Step output written successfully to " + outputPath)],
        details: {}
      }
    }
```

Key changes:
- `input` is now `{ status: "done", ...rest }` instead of a string
- JSON.parse removed entirely
- "Invalid JSON" error path removed (not reachable with typed input)
- "Missing status" check now also rejects empty strings

- [ ] **Step 3: Update existing tests to pass objects instead of strings**

Open `tests/agent/write-step-output-tool.test.ts`. Update all `tool.execute` calls to pass objects instead of JSON strings:

Line 30 — "executes successfully" test:
```typescript
    const result = await tool.execute("call-1", { input: { status: "done", repo: "hamilton" } }, undefined, undefined, {} as any)
```

Line 37 — Remove the "Invalid JSON" test entirely. Replace with "rejects empty status string":
```typescript
  it("returns error when status is empty string", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: { status: "" } }, undefined, undefined, {} as any)
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("Missing required field 'status'")
  })
```

Line 43 — "not an object" test:
```typescript
  it("returns error when input is an array", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: [1, 2, 3] as any }, undefined, undefined, {} as any)
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })
```

Line 52 — "missing status" test:
```typescript
    const result = await tool.execute("call-1", { input: { repo: "hamilton" } as any }, undefined, undefined, {} as any)
```

Line 59 — "duplicate call" test:
```typescript
    await tool.execute("call-1", { input: { status: "done" } }, undefined, undefined, {} as any)
    const result = await tool.execute("call-2", { input: { status: "done" } }, undefined, undefined, {} as any)
```

Line 67 — "writes to correct file" test:
```typescript
    await tool.execute("call-1", { input: { status: "done", key: "val" } }, undefined, undefined, {} as any)
```

Line 85 — "schema rejects invalid" test:
```typescript
    const result = await tool.execute("call-1", { input: { status: "done", count: "not-a-number" } }, undefined, undefined, {} as any)
```

Line 100 — "schema accepts valid" test:
```typescript
    const result = await tool.execute("call-1", { input: { status: "done", count: 42 } }, undefined, undefined, {} as any)
```

Line 108 — "no schema allows any" test:
```typescript
    const result = await tool.execute("call-1", { input: { status: "done", anyField: "anyValue" } }, undefined, undefined, {} as any)
```

Also add a new test for null input:
```typescript
  it("returns error when input is null", async () => {
    const tool = createWriteStepOutputTool("run-1", "step-1")
    const result = await tool.execute("call-1", { input: null as any }, undefined, undefined, {} as any)
    expect((result.content[0] as { type: "text"; text: string }).text).toContain("JSON object")
  })
```

- [ ] **Step 4: Run tool tests**

```bash
bun --bun vitest run tests/agent/write-step-output-tool.test.ts
```

Expected: All 9 tests pass.

- [ ] **Step 5: Run full test suite to catch regressions**

```bash
bun --bun vitest run
```

Expected: All 155+ tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/agent/write-step-output-tool.ts tests/agent/write-step-output-tool.test.ts
git commit -m "feat: change write_step_output parameter from String to Object (issue 5)"
```

---

### Task 5: Status Command — Topological Ordering and Formatting

**Files:**
- Modify: `src/cli/commands/status.ts`
- Modify: `tests/cli/status.test.ts`

- [ ] **Step 1: Update status.ts to use topological task ordering**

Open `src/cli/commands/status.ts`. Replace the imports (lines 1-5) with:

```typescript
import { Args, Command } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import { loadRunState, RunStateError } from "../../workflow/state.js"
import { hamiltonHome, runDir, workflowsDir } from "../../paths.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { collectReachableTasks, topologicalSort } from "../../workflow/engine.js"
import type { WorkflowSpec } from "../../types.js"
```

Update `formatStatus` to accept an optional `WorkflowSpec` for ordering and reorder/format sections:

```typescript
export function formatStatus(status: RunStatus, spec?: WorkflowSpec): string {
  const lines: string[] = []

  const elapsed = computeElapsed(status.startedAt, status.completedAt)

  lines.push(`Run folder: ${runDir(status.runId)}/`)

  if (status.status === "completed") {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    completed (${elapsed} total)`)
  } else if (status.status === "failed") {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    failed (${elapsed} elapsed)`)
  } else {
    lines.push(`Workflow:  ${status.workflow}`)
    lines.push(`Status:    running (${elapsed} elapsed)`)
  }

  lines.push(`Run ID:    ${status.runId}`)

  const tasksInOrder = status.tasks.map((t) => ({
    ...t,
    slug: parseTaskSlug(t.taskId, status.runId)
  }))

  if (spec) {
    const staticTasks = collectReachableTasks(spec.tasks, spec.run.entrypoint)
    const sorted = topologicalSort(staticTasks)
    const orderMap = new Map<string, number>()
    sorted.forEach((t, i) => orderMap.set(t.name, i))
    const expandedOrder = new Map<string, number>()
    tasksInOrder.forEach((t) => {
      const baseName = t.slug.includes("/")
        ? t.slug.split("/")[0]
        : t.slug
      if (orderMap.has(baseName)) {
        expandedOrder.set(t.slug, orderMap.get(baseName)!)
      } else {
        expandedOrder.set(t.slug, Infinity)
      }
    })
    tasksInOrder.sort((a, b) => {
      const aOrder = expandedOrder.get(a.slug) ?? Infinity
      const bOrder = expandedOrder.get(b.slug) ?? Infinity
      if (aOrder !== bOrder) return aOrder - bOrder
      return a.slug.localeCompare(b.slug)
    })
  }

  const currentIdx = tasksInOrder.findIndex((t) => t.status === "running")
  if (status.currentTask && currentIdx >= 0) {
    const task = tasksInOrder[currentIdx]
    lines.push(`Task:      ${task.slug} (${currentIdx + 1}/${tasksInOrder.length})`)
  }

  lines.push("")

  const tokensIn = status.totalTokensIn.toLocaleString()
  const tokensOut = status.totalTokensOut.toLocaleString()
  lines.push(`Tokens:    ${tokensIn} in / ${tokensOut} out`)

  if (status.errorMessage) {
    lines.push(`Errors:    ${status.errorMessage}`)
  } else {
    lines.push(`Errors:    none`)
  }

  lines.push("")
  lines.push("Tasks:")

  for (const t of tasksInOrder) {
    const indicator = taskIndicator(t.status)
    const isSubtask = t.slug.includes("/")
    const indent = isSubtask ? "   " : "  "
    const agentName = isSubtask ? "" : ` (${t.taskSlug})`
    lines.push(`${indent}${indicator}  ${t.slug}${agentName}`)
  }

  return lines.join("\n")
}
```

Also update `getRunStatus` to accept an optional `WorkflowSpec`:

Replace the entire `getRunStatus` function with:

```typescript
export interface GetRunStatusOpts {
  runId: string
  loadSpec?: boolean
}

export function getRunStatus(opts: GetRunStatusOpts): Effect.Effect<{ status: RunStatus; spec: WorkflowSpec | null }, RunStateError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new RunStateError({
        runId: opts.runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

    const status = yield* _(loadRunState(opts.runId))

    let spec: WorkflowSpec | null = null
    if (opts.loadSpec) {
      spec = yield* _(
        loadWorkflowSpec(workflowsDir(), status.workflow).pipe(
          Effect.catchAll(() => Effect.succeed(null))
        )
      )
    }

    return { status, spec }
  })
}
```

Update the `statusCommand` handler (lines 100-108):

```typescript
export const statusCommand = Command.make("status", { id: runIdArg }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(getRunStatus({ runId: id, loadSpec: true }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Status not found: ${id}`)
      return
    }
    yield* Console.log(formatStatus(result.value.status, result.value.spec ?? undefined))
  })
).pipe(Command.withDescription("Show run status"))
```

- [ ] **Step 2: Update status tests**

Open `tests/cli/status.test.ts`. Update the `formatStatus` import (line 10) — no change needed since it's already importing. Update the `formatStatus` tests:

In the "formats a running status" test, verify the new format has newline-separated tasks and that tasks section comes last:

```typescript
  it("formats a running status", () => {
    const status = {
      runId: "bug-fix-abc123",
      workflow: "bug-fix",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      currentTask: "fix",
      tasks: [
        { taskId: "bug-fix-abc123-triage-x1y2z", taskSlug: "triager", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: "bug-fix-abc123-investigate-x1y2z", taskSlug: "investigator", status: "completed", startedAt: "2026-01-01T00:00:30.000Z", completedAt: "2026-01-01T00:01:00.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: "bug-fix-abc123-setup-x1y2z", taskSlug: "setup", status: "completed", startedAt: "2026-01-01T00:01:00.000Z", completedAt: "2026-01-01T00:01:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: "bug-fix-abc123-fix-x1y2z", taskSlug: "fixer", status: "running", startedAt: "2026-01-01T00:01:30.000Z", completedAt: null, tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: "bug-fix-abc123-verify-x1y2z", taskSlug: "verifier", status: "pending", startedAt: null, completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: null }
      ],
      totalTokensIn: 25000,
      totalTokensOut: 8000,
      errorMessage: null
    }
    const output = formatStatus(status as any)
    expect(output).toContain("Run folder:")
    expect(output).toContain("bug-fix")
    expect(output).toContain("running")
    expect(output).toContain("bug-fix-abc123")
    expect(output).toContain("fix (4/5)")
    expect(output).toContain("triage")
    expect(output).toContain("verify")
    expect(output).toContain("25,000")
    expect(output).toContain("8,000")
    expect(output).toContain("Errors:    none")

    const lines = output.split("\n")
    const tasksIdx = lines.findIndex((l) => l === "Tasks:")
    expect(tasksIdx).toBeGreaterThan(-1)
    const taskLines = lines.slice(tasksIdx + 1)
    expect(taskLines.length).toBe(5)
    expect(taskLines[0]).toContain("triage")
    expect(taskLines[1]).toContain("investigate")
    expect(taskLines[2]).toContain("setup")
    expect(taskLines[3]).toContain("fix")
    expect(taskLines[4]).toContain("verify")
  })
```

Add a new test for subtask indentation:

```typescript
  it("indents subtask instances", () => {
    const status = {
      runId: "feature-dev-abc123",
      workflow: "feature-dev",
      status: "running",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      currentTask: null,
      tasks: [
        { taskId: "feature-dev-abc123-plan-x1y2z", taskSlug: "planner", status: "completed", startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:30.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: "feature-dev-abc123-setup-x1y2z", taskSlug: "setup", status: "completed", startedAt: "2026-01-01T00:00:30.000Z", completedAt: "2026-01-01T00:01:00.000Z", tokensIn: 500, tokensOut: 200, errorMessage: null },
        { taskId: "feature-dev-abc123-implement-stories-0-x1y2z", taskSlug: "developer", status: "pending", startedAt: null, completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: null },
        { taskId: "feature-dev-abc123-implement-stories-1-x1y2z", taskSlug: "developer", status: "pending", startedAt: null, completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: null },
        { taskId: "feature-dev-abc123-verify-stories-0-x1y2z", taskSlug: "verifier", status: "pending", startedAt: null, completedAt: null, tokensIn: 0, tokensOut: 0, errorMessage: null },
      ],
      totalTokensIn: 500,
      totalTokensOut: 200,
      errorMessage: null
    }
    const output = formatStatus(status as any)

    const lines = output.split("\n")
    const tasksIdx = lines.findIndex((l) => l === "Tasks:")
    expect(tasksIdx).toBeGreaterThan(-1)
    const taskLines = lines.slice(tasksIdx + 1)
    
    expect(taskLines[0]).toMatch(/^  .*plan/)
    expect(taskLines[1]).toMatch(/^  .*setup/)
    expect(taskLines[2]).toMatch(/^   .*implement-stories\/0/)
    expect(taskLines[4]).toMatch(/^   .*verify-stories\/0/)
  })
```

- [ ] **Step 3: Run status tests**

```bash
bun --bun vitest run tests/cli/status.test.ts
```

Expected: All 4 tests pass.

- [ ] **Step 4: Verify formatStatus still works without spec**

The `formatStatus` function's spec parameter is optional — verify it degrades gracefully:

```bash
bun --bun vitest run tests/cli/status.test.ts
```

The existing completed/failed tests should still pass (they don't pass a spec).

- [ ] **Step 5: Run full test suite**

```bash
bun --bun vitest run
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/status.ts tests/cli/status.test.ts
git commit -m "fix: topological task ordering and newline display in status command (issue 7)"
```

---

### Final Verification

- [ ] **Step: Build**

```bash
bun run build
```

Expected: Compiles without errors.

- [ ] **Step: Final full test run**

```bash
bun --bun vitest run
```

Expected: All tests pass.
