# Token Reporting, Step-Level Timeout, and Run ID UX Fixes

## Problem 1: Token Delta from Session Stats

The Pi SDK `turn_end` event schema is `{ type: "turn_end"; message: AgentMessage; toolResults: ToolResultMessage[] }` — it carries no token usage data. The `subscribePiEvents` handler reads `event.tokenUsage?.input ?? 0` / `event.tokenUsage?.output ?? 0`, which is always undefined, producing `tokens_in: 0, tokens_out: 0` on every log entry and runner token accumulation.

### Fix

Pass a `getSessionStats` callback into `subscribePiEvents`. On each `turn_end`, call it to get cumulative session stats from the Pi session, diff against the previous snapshot to compute per-turn deltas.

**`src/observability/streaming.ts` — `SubscribeConfig`**

Add:
```ts
getSessionStats: () => { inputTokens: number; outputTokens: number }
```

**`src/observability/streaming.ts` — `subscribePiEvents`**

Hold a local accumulator:
```ts
let lastStats = { inputTokens: 0, outputTokens: 0 }
```

In the `turn_end` case, replace the dead `tokenUsage` fallback with:
```ts
case "turn_end":
  const current = config.getSessionStats()
  const tokensIn = current.inputTokens - lastStats.inputTokens
  const tokensOut = current.outputTokens - lastStats.outputTokens
  lastStats = current
  yield* config.onLog({ event: "turn_end", tokens_in: tokensIn, tokens_out: tokensOut, step_id: config.stepId })
  yield* config.onTokenEvent({ runId: config.runId, stepId: config.stepId, tokensIn, tokensOut })
  break
```

**`src/agent/pi-executor.ts` — `executeWithPi`**

In `subscribePiEvents` call, add:
```ts
getSessionStats: () => {
  const s = session.getSessionStats?.() ?? { inputTokens: 0, outputTokens: 0 }
  return { inputTokens: s.inputTokens, outputTokens: s.outputTokens }
}
```

---

## Problem 2: Step-Level Timeout

Timeout is resolved from `agent.timeoutSeconds` → `spec.polling.timeoutSeconds` → hardcoded 300. There is no per-step override, forcing all steps using the same agent to share one timeout.

### Fix

Add an optional `timeoutSeconds` field to `WorkflowStep`. Resolution order becomes step → agent → polling → default (300).

**`src/types.ts` — `WorkflowStep`**

Add:
```ts
timeoutSeconds?: number
```

**`src/schemas.ts` — `WorkflowStepSchema`**

Add:
```ts
timeoutSeconds: Schema.optional(Schema.Number)
```

**`src/workflow/engine.ts` — `resolveStepTimeout`**

Change signature from `resolveStepTimeout(spec, agentSlug)` to `resolveStepTimeout(spec, stepSlug)`:

```ts
export function resolveStepTimeout(spec: WorkflowSpec, stepSlug: string): number {
  const step = spec.steps.find((s) => s.slug === stepSlug)
  if (step?.timeoutSeconds !== undefined) return step.timeoutSeconds
  const agent = spec.agents.find((a) => a.slug === step?.agent)
  if (agent?.timeoutSeconds !== undefined) return agent.timeoutSeconds
  if (spec.polling?.timeoutSeconds !== undefined) return spec.polling.timeoutSeconds
  return 300
}
```

**`src/workflow/runner.ts` line 103**

Change call from `resolveStepTimeout(spec, agent.slug)` to `resolveStepTimeout(spec, step.slug)`.

---

## Problem 3: Run ID Visibility

The run ID is printed only after the workflow completes (`run.ts:108`). If a run hangs or is interrupted, the user cannot inspect logs or status.

### Fix

Print the run ID in the `workflow_started` event formatter, making it visible as soon as the run begins.

**`src/cli/commands/run.ts` — `formatEvent`**

Change:
```
case "workflow_started":
  return `Workflow started`
```
To:
```
case "workflow_started":
  return `Workflow started [${event.runId}]`
```

Keep the post-run `Run ID:` line as-is for discoverability.

---

## Follow-up (Roadmap)

- Refactor event architecture to use Effect event bus instead of callbacks (`onLog`, `onTokenEvent`, `onTokenUsage`). Decouple into single-responsibility subscribers: logger, DB writer, CLI renderer.
