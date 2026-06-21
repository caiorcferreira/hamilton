# Extensions Package + Workflow Extension

## Goal

Move the flat Pi extension files into a `src/executors/pi/extensions/` package and implement a new workflow extension that provides `write_step_output` as a Pi tool via `pi.registerTool`. Align all extensions to the `ExtensionAPI` pattern from `@earendil-works/pi-coding-agent`.

## Package Structure

```
src/executors/pi/
  extensions/
    extensions.ts            # readExtensionSettings(), buildExtensions(), ExtensionFactory type
    guideline-extension.ts   # createGuidelineExtension(rules) => (pi: ExtensionAPI) => void
    rtk-extension.ts         # createRtkExtension(options?) => (pi: ExtensionAPI) => void
    workflow-extension.ts    # createWorkflowExtension(runId, stepId, outputSchema?, onComplete?) => (pi: ExtensionAPI) => void
  paths.ts
  pi-executor.ts
  streaming.ts
  reconcile.ts
```

## Deleted Files

| From `src/executors/pi/` | Replaced by |
|---|---|
| `extensions.ts` | `extensions/extensions.ts` |
| `rtk-extension.ts` | `extensions/rtk-extension.ts` |
| `guideline-extension.ts` | `extensions/guideline-extension.ts` |
| `write-step-output-tool.ts` | `extensions/workflow-extension.ts` |

Test paths mirror source:

```
tests/executors/pi/extensions.test.ts
tests/executors/pi/rtk-extension.test.ts
tests/executors/pi/guideline-extension.test.ts
tests/executors/pi/workflow-extension.test.ts   (was write-step-output-tool.test.ts)
```

## ExtensionAPI

All extensions use the typed `ExtensionAPI` from `@earendil-works/pi-coding-agent`. No more `(pi: unknown)` casts or hand-rolled `PiExtensionApi` interfaces.

```typescript
import type { ExtensionAPI, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent"
```

Key ExtensionAPI methods used:
- `pi.on("tool_call", handler)` — intercept tool calls; handler returns `{ block: true, reason }` to block or `undefined` to allow
- `pi.registerTool(name, definition)` — register a custom tool

## Extension Details

### rtk-extension.ts

Refactored to `(pi: ExtensionAPI) => void`. Uses `pi.on("tool_call")` with async handler. `rewriteCommand` remains a standalone helper.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export function createRtkExtension(options?: { disabled?: boolean }): (pi: ExtensionAPI) => void {
  if (options?.disabled) return () => {}
  return (pi) => {
    pi.on("tool_call", async (event) => {
      if (event.toolName === "bash") {
        const command = (event.input as Record<string, unknown>).command as string | undefined
        if (command) rewriteCommand(event.input as { command: string }, command)
      }
    })
  }
}
```

`rewriteCommand` mutates `event.input.command` in place. Handler returns `undefined` — call proceeds with the rewritten command.

### guideline-extension.ts

Refactored to `(pi: ExtensionAPI) => void`. Uses `pi.on("tool_call")` returning `ToolCallEventResult | undefined`. Multiple matching rules have their reasons joined with newlines.

```typescript
import type { ExtensionAPI, ToolCallEventResult } from "@earendil-works/pi-coding-agent"

export function createGuidelineExtension(rules: CompiledRule[]): (pi: ExtensionAPI) => void {
  if (rules.length === 0) return () => {}
  return (pi) => {
    pi.on("tool_call", async (event): Promise<ToolCallEventResult | undefined> => {
      const matches = evaluateToolCall(rules, event.toolName, (event.input as Record<string, unknown> | undefined) ?? {})
      if (matches.length === 0) return undefined
      return { block: true, reason: matches.map(m => m.reason).join("\n") }
    })
  }
}
```

Internal `PiExtensionApi` interface removed. `preventDefault()` and `api.conversation.addMessage()` replaced by returning `{ block: true, reason }`.

### workflow-extension.ts

New file. Factory function accepting per-step context, returns `(pi: ExtensionAPI) => void`. Uses `pi.registerTool` to register `write_step_output`.

```typescript
import { Type } from "typebox"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { validateAndWrite } from "../../agent/write-step-output.js"

const paramsSchema = Type.Object({
  input: Type.Object({
    status: Type.String({ description: "Completion state: 'done', 'retry', or 'failed'" })
  }, { additionalProperties: true })
})

export function createWorkflowExtension(
  runId: string,
  stepId: string,
  outputSchema?: Record<string, unknown>,
  onComplete?: () => void
): (pi: ExtensionAPI) => void {
  return (pi) => {
    pi.registerTool("write_step_output", {
      label: "Write Step Output",
      description: "Save your step results. Call exactly once when your step is complete.",
      parameters: paramsSchema,
      promptSnippet: "- write_step_output: saves your step results (call once when done, input must be a JSON object with 'status' field)",
      execute: async (_toolCallId, { input }, _signal, _onUpdate, _ctx) => {
        const result = validateAndWrite(runId, stepId, outputSchema, input)
        if (!result.success) {
          return { content: [{ type: "text", text: `Error: ${result.error}` }], details: {} }
        }
        onComplete?.()
        return { content: [{ type: "text", text: "Step output written successfully." }], details: {} }
      }
    })
  }
}
```

`validateAndWrite` from `src/agent/write-step-output.ts` is reused unchanged.

### extensions.ts

`ExtensionFactory` type narrows from `((pi: unknown) => void)` to `((pi: ExtensionAPI) => void)`. `buildExtensions()` logic unchanged.

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export type ExtensionFactory = (pi: ExtensionAPI) => void

export function buildExtensions(settings: ExtensionSettings): ExtensionFactory[] {
  // unchanged logic — same switch on entry.name for rtk/lsp
}
```

## Changes in pi-executor.ts

- Import `createWorkflowExtension` from `./extensions/workflow-extension.js`
- Remove imports of `createWriteStepOutputTool` and `write-step-output-tool.js`
- Remove `customTools: [writeStepOutputTool]` from `createAgentSession` call
- After creating `extensionFactories` via `buildExtensions()`, push the workflow extension:

```typescript
extensionFactories.push(
  createWorkflowExtension(config.runId, config.stepId, config.outputSchema, () => {
    sessionRef?.abort().catch(() => {})
  })
)
```

- `write_step_output` remains in the tools list via `buildToolSet()` (already handled there)

## Testing

- **extensions.test.ts**: update `ExtensionFactory` type references, import paths
- **rtk-extension.test.ts**: use `pi.on("tool_call")` API, verify `rewriteCommand` invoked for bash, not invoked for other tools
- **guideline-extension.test.ts**: verify `{ block: true, reason }` return on match, `undefined` on no match; remove `preventDefault`/`addEventListener` assertions
- **workflow-extension.test.ts**: adapted from `write-step-output-tool.test.ts` — verify `pi.registerTool` called with correct name and definition, test execute callback (success, schema validation failure, duplicate-write error)
