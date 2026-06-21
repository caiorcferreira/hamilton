# Hamilton Pi SDK Integration Design

## Overview

Replace the placeholder `pi-executor.ts` with a real implementation using `@earendil-works/pi-coding-agent`. Hamilton steps create real Pi agent sessions, execute prompts, stream events to JSONL logs, and extract structured JSON output.

## Key decisions

- **Both packages:** `@earendil-works/pi-agent-core` remains, `@earendil-works/pi-coding-agent` added as new dependency
- **In-memory sessions per step:** `SessionManager.inMemory()` — no Pi persistence, Hamilton owns durability via SQLite
- **Two-prompt split:** `systemPrompt` (persona + context) → `ResourceLoader.systemPromptOverride()`, `taskPrompt` (step input) → `session.prompt()`
- **Auth from env vars:** `AuthStorage.create()` reads `ANTHROPIC_API_KEY` and other provider keys
- **Output from messages:** Read last assistant message from `session.messages`, parse JSON with code fence extraction
- **Streaming unchanged:** `session.subscribe()` feeds existing `subscribePiEvents` handler from `streaming.ts`

---

## Architecture: `pi-executor.ts`

### Config: `PiExecutorConfig`

```typescript
export interface PiExecutorConfig {
  systemPrompt: string    // Agent persona: SOUL.md + IDENTITY.md + AGENTS.md + context
  taskPrompt: string      // Step-specific: resolved step.input
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  extensions?: Array<(pi: unknown) => void>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[]
  }
  cwd?: string
}
```

`systemPrompt` is the agent's persona compiled from persona files and accumulated context. `taskPrompt` is the resolved step input — what the agent should actually do. The same agent persona can be reused across multiple steps, each with a different task.

### Execution flow

1. Dynamic import `@earendil-works/pi-coding-agent`
2. Create `AuthStorage` (reads keys from env vars and `~/.pi/agent/auth.json`)
3. Create `ModelRegistry` from auth storage
4. Resolve model: `anthropic/claude-sonnet-4-20250514` → `getModel("anthropic", "claude-sonnet-4-20250514")`
5. Create `DefaultResourceLoader` with:
   - `systemPromptOverride: () => config.systemPrompt`
   - `extensionFactories: config.extensions` (rtk, etc.)
   - `cwd: config.cwd ?? process.cwd()`
   - `settingsManager: SettingsManager.inMemory()`
6. Call `loader.reload()`
7. Create session via `createAgentSession()`:
   - `model`, `thinkingLevel`, `tools` from config
   - `resourceLoader` from step 5
   - `sessionManager: SessionManager.inMemory()`
8. Subscribe to events → `subscribePiEvents` → JSONL logs
9. `session.prompt(config.taskPrompt)` — waits for agent completion
10. Read last assistant message from `session.messages`
11. Parse as JSON via `parseAgentOutput()` (code fence extraction)
12. Return structured output
13. `finally { unsubscribe(); session.dispose() }`

### Model mapping

```
config.model = "anthropic/claude-sonnet-4-20250514"
→ parseModelString → ["anthropic", "claude-sonnet-4-20250514"]
→ getModel("anthropic", "claude-sonnet-4-20250514")
```

### Thinking level mapping

```
config.settings.thinking = "medium"
→ Pi's thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh"
```

### Output extraction

```typescript
const assistantMsgs = session.messages.filter(m => m.role === "assistant")
const lastMsg = assistantMsgs[assistantMsgs.length - 1]
const text = extractTextContent(lastMsg)  // handles string and ContentBlock[]
const output = parseAgentOutput(text)    // existing JSON + code fence parser
```

---

## Impact on existing code

### `src/agent/activity.ts`

`buildAgentPrompt` currently returns a single combined string. It changes to return `{ systemPrompt, taskPrompt }`:

```typescript
export interface BuiltPrompt {
  systemPrompt: string
  taskPrompt: string
}

export function buildAgentPrompt(params: PromptParams): BuiltPrompt {
  const systemParts: string[] = []

  if (params.identityMd) systemParts.push(`Your role: ${params.identityMd}`)
  if (params.soulMd) systemParts.push(`Your style: ${params.soulMd}`)
  if (Object.keys(params.context).length > 0) {
    const lines = Object.entries(params.context).map(([k, v]) => `  ${k}: ${v}`).join("\n")
    systemParts.push(`Context from previous steps:\n${lines}`)
  }
  systemParts.push(params.agentsMd)

  const task = resolveTemplate(params.stepInput, params.context)

  return {
    systemPrompt: systemParts.join("\n\n"),
    taskPrompt: `${task}\n\nWhen complete, respond with a JSON object containing your results.`
  }
}
```

### `src/workflow/runner.ts`

Currently builds a single prompt and passes it as `config.prompt`. Changes:

```typescript
// Old (single prompt):
const prompt = buildAgentPrompt({ ... })
const output = yield* executeWithPi({ prompt, ... })

// New (split):
const built = buildAgentPrompt({ ... })
const output = yield* executeWithPi({
  systemPrompt: built.systemPrompt,
  taskPrompt: built.taskPrompt,
  ...
})
```

### `tests/agent/activity.test.ts`

Update assertions for `BuiltPrompt` shape instead of single string.

### Tests mocks

`tests/workflow/runner.test.ts` and `tests/e2e/workflows.test.ts` mock `executeWithPi`. Update mock signatures to accept `{ systemPrompt, taskPrompt }` instead of `{ prompt }`.

---

## Dependencies

| Package | Current | Action |
|---------|---------|--------|
| `@earendil-works/pi-agent-core` | 0.78.1 | Keep |
| `@earendil-works/pi-coding-agent` | — | Add (latest pinned version) |
| `@earendil-works/pi-ai` | — | Add (peer dep of pi-coding-agent, provides getModel) |

---

## Out of scope

- **Pi installation/configuration:** Hamilton delegates to Pi's own auth and settings
- **Session persistence:** Hamilton uses in-memory sessions; durability is in SQLite
- **Multi-turn conversations:** Each step gets a single prompt → response. No follow-ups
- **Pi session file management:** Hamilton does not create or manage Pi's session.jsonl files
- **Extension registration beyond rtk:** Additional extensions are added via `extensionFactories` only
