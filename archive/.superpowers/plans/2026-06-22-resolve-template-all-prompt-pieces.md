# Resolve Template for All System Prompt Pieces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply `resolveTemplate()` to INSTRUCTIONS.md and SOUL.md in `buildAgentPrompt`, matching the template resolution already applied to CONTEXT.md.

**Architecture:** Two additional `resolveTemplate()` calls in `buildAgentPrompt` — one for `params.agentFile`, one for `params.soulFile` — with the same context (`{ inputs: params.env }`) and same `options` already used for CONTEXT.md. No interface changes.

**Tech Stack:** TypeScript, bun, vitest

---

### Task 1: Add failing tests for persona file template resolution

**Files:**
- Modify: `tests/prompts/builder.test.ts`

- [ ] **Step 1: Add test for template resolution in agentFile (INSTRUCTIONS.md)**

```typescript
it("resolves template expressions in agentFile via env", () => {
  const env: WorkflowEnv = { tasks: { setup: { outputs: { repo: "hamilton" } } } }
  const params: PromptParams = {
    agentFile: "You are a coder for {{inputs.tasks.setup.outputs.repo}}.",
    soulFile: "",
    prompt: { content: "Fix the bug" },
    env,
    agentConfig: {}
  }
  const result = buildAgentPrompt(params)
  expect(result.systemPrompt).toContain("You are a coder for hamilton.")
})
```

- [ ] **Step 2: Verify the new test fails**

```bash
bun --bun vitest run tests/prompts/builder.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: FAIL. Output will contain `You are a coder for {{inputs.tasks.setup.outputs.repo}}` (unresolved).

- [ ] **Step 3: Add test for template resolution in soulFile (SOUL.md)**

```typescript
it("resolves template expressions in soulFile via env", () => {
  const env: WorkflowEnv = { cwd: "/tmp/repo" }
  const params: PromptParams = {
    agentFile: "You are a coder.",
    soulFile: "Working from {{inputs.cwd}}",
    prompt: { content: "Fix the bug" },
    env,
    agentConfig: {}
  }
  const result = buildAgentPrompt(params)
  expect(result.systemPrompt).toContain("<persona>")
  expect(result.systemPrompt).toContain("Working from /tmp/repo")
})
```

- [ ] **Step 4: Verify the new test fails**

```bash
bun --bun vitest run tests/prompts/builder.test.ts --reporter=verbose 2>&1 | tail -20
```
Expected: 2 new failures. SoulFile content appears with unresolved `{{inputs.cwd}}`.

- [ ] **Step 5: Commit failing tests**

```bash
git add tests/prompts/builder.test.ts
git commit -m "test: add failing tests for persona file template resolution"
```

---

### Task 2: Implement template resolution for agentFile and soulFile

**Files:**
- Modify: `src/prompts/builder.ts:56-86`

- [ ] **Step 1: Resolve agentFile through resolveTemplate before building persona block**

Replace lines 61-63:

```typescript
  const persona = params.soulFile
    ? `<persona>\n${params.soulFile}\n</persona>`
    : ""
```

With:

```typescript
  const resolvedAgentFile = resolveTemplate(params.agentFile, { inputs: params.env }, options)

  const resolvedSoul = params.soulFile
    ? resolveTemplate(params.soulFile, { inputs: params.env }, options)
    : ""

  const persona = resolvedSoul
    ? `<persona>\n${resolvedSoul}\n</persona>`
    : ""
```

- [ ] **Step 2: Use resolvedAgentFile instead of raw params.agentFile in systemTemplate resolution**

Replace line 72:

```typescript
    instructions: params.agentFile,
```

With:

```typescript
    instructions: resolvedAgentFile,
```

- [ ] **Step 3: Verify the full builder.ts matches the expected final state**

The complete `buildAgentPrompt` function should be:

```typescript
export function buildAgentPrompt(
  params: PromptParams,
  guidelineFiles: Array<{ name: string; content: string }> = [],
  options: TemplateOptions = { strict: false }
): BuiltPrompt {
  const resolvedAgentFile = resolveTemplate(params.agentFile, { inputs: params.env }, options)

  const resolvedSoul = params.soulFile
    ? resolveTemplate(params.soulFile, { inputs: params.env }, options)
    : ""

  const persona = resolvedSoul
    ? `<persona>\n${resolvedSoul}\n</persona>`
    : ""

  const template = params.contextTemplate || defaultContextTemplate
  const contextForTemplate = params.contextTemplate
    ? { inputs: params.env }
    : { inputs: JSON.stringify(params.env) }
  const renderedContext = resolveTemplate(template, contextForTemplate, options)

  const resolvedSystem = resolveTemplate(systemTemplate, {
    instructions: resolvedAgentFile,
    persona,
    context: renderedContext,
  }, options)

  const resolvedInput = params.prompt.skipTemplate
    ? (params.prompt.content ?? "")
    : resolveTemplate(params.prompt.content ?? "", { inputs: params.env }, options)

  return {
    systemPrompt: resolvedSystem.trim(),
    taskPrompt: resolvedInput.trim(),
    guidelineFiles
  }
}
```

- [ ] **Step 4: Run the full test suite**

```bash
bun --bun vitest run tests/prompts/builder.test.ts --reporter=verbose
```
Expected: All 11 tests pass (9 existing + 2 new).

- [ ] **Step 5: Run full build and test suite**

```bash
bun run build && bun --bun vitest run
```
Expected: Build succeeds, 155+ tests pass.

- [ ] **Step 6: Commit implementation**

```bash
git add src/prompts/builder.ts
git commit -m "feat: resolve templates in INSTRUCTIONS.md and SOUL.md persona files"
```
