import { describe, it, expect } from "vitest"
import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { formatForFile, FileLogger } from "../../src/observability/subscribers.js"
import { EventBus, EventBusLive, Event } from "../../src/events/bus.js"

describe("formatForFile", () => {
  const cases: Array<{ input: Event; expected: Record<string, unknown> }> = [
    {
      input: { _tag: "TaskStarted", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_started", task_id: "t1" },
    },
    {
      input: { _tag: "TaskCompleted", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_completed", task_id: "t1" },
    },
    {
      input: { _tag: "TaskFailed", runId: "r1", taskId: "t1", taskName: "test", message: "boom" },
      expected: { event: "task_failed", task_id: "t1", message: "boom" },
    },
    {
      input: { _tag: "TaskTimedOut", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_timed_out", task_id: "t1" },
    },
    {
      input: { _tag: "TaskRetrying", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_retrying", task_id: "t1" },
    },
    {
      input: { _tag: "TaskPaused", runId: "r1", taskId: "t1", taskName: "test" },
      expected: { event: "task_paused", task_id: "t1" },
    },
    {
      input: { _tag: "PromptBuilt", runId: "r1", taskId: "t1", systemPrompt: "sys", taskPrompt: "tsk", guidelineFiles: ["g1.md", "g2.md"] },
      expected: { event: "prompt_built", task_id: "t1", system_prompt: "sys", task_prompt: "tsk", guideline_files: ["g1.md", "g2.md"] },
    },
    {
      input: { _tag: "LlmMessage", runId: "r1", taskId: "t1", text: "hi", model: "glm-5.1", provider: "openai" },
      expected: { event: "llm_message", text: "hi", task_id: "t1", model: "glm-5.1", provider: "openai" },
    },
    {
      input: { _tag: "LlmThinking", runId: "r1", taskId: "t1", text: "let me think", model: "glm-5.1", provider: "openai" },
      expected: { event: "llm_thinking", text: "let me think", task_id: "t1", model: "glm-5.1", provider: "openai" },
    },
    {
      input: { _tag: "ToolCall", runId: "r1", taskId: "t1", tool: "bash", input: { cmd: "ls" }, toolCallId: "call-1", model: "glm-5.1", provider: "openai" },
      expected: { event: "tool_call", tool: "bash", input: { cmd: "ls" }, task_id: "t1", tool_call_id: "call-1", model: "glm-5.1", provider: "openai" },
    },
    {
      input: { _tag: "ToolResult", runId: "r1", taskId: "t1", tool: "bash", isError: false, toolCallId: "call-1" },
      expected: { event: "tool_result", tool: "bash", isError: false, task_id: "t1", tool_call_id: "call-1" },
    },
    {
      input: { _tag: "TurnEnd", runId: "r1", taskId: "t1", tokensIn: 10, tokensOut: 20, stopReason: "toolUse", cacheRead: 100, cacheWrite: 0, model: "glm-5.1", provider: "openai" },
      expected: { event: "turn_end", tokens_in: 10, tokens_out: 20, task_id: "t1", stop_reason: "toolUse", cache_read: 100, cache_write: 0, model: "glm-5.1", provider: "openai" },
    },
    {
      input: { _tag: "TokenUsage", runId: "r1", taskId: "t1", tokensIn: 10, tokensOut: 20 },
      expected: { event: "token_usage", tokens_in: 10, tokens_out: 20, task_id: "t1" },
    },
    {
      input: { _tag: "TurnStarted", runId: "r1", taskId: "t1", turnId: "x1", turnIndex: 0, timestamp: "2025-01-01T00:00:00Z" },
      expected: { event: "turn_started", task_id: "t1", turn_id: "x1", turn_index: 0, timestamp: "2025-01-01T00:00:00Z" },
    },
    {
      input: { _tag: "ProviderRequestStarted", runId: "r1", taskId: "t1", turnId: "x1", requestId: "req1", provider: "openai", model: "gpt-4", payloadSummary: "short", timestamp: "2025-01-01T00:00:00Z" },
      expected: { event: "provider_request_started", task_id: "t1", turn_id: "x1", request_id: "req1", provider: "openai", model: "gpt-4", payload_summary: "short", timestamp: "2025-01-01T00:00:00Z" },
    },
    {
      input: { _tag: "ModelSelected", runId: "r1", taskId: "t1", provider: "openai", model: "gpt-4", timestamp: "2025-01-01T00:00:00Z" },
      expected: { event: "model_selected", task_id: "t1", provider: "openai", model: "gpt-4", timestamp: "2025-01-01T00:00:00Z" },
    },
    {
      input: { _tag: "LspDiagnostic", runId: "r1", taskId: "t1", filePath: "/src/test.ts", text: "error: unused variable" },
      expected: { event: "lsp_diagnostic", file_path: "/src/test.ts", text: "error: unused variable", task_id: "t1" },
    },
  ]

  for (const { input, expected } of cases) {
    it(`maps ${input._tag} to event="${(expected.event as string)}"`, () => {
      const result = formatForFile(input)
      expect(result).toEqual(expected)
      expect("_tag" in result).toBe(false)
    })
  }
})

describe("FileLogger", () => {
  it("writes task-scoped events to appendTaskLog via JSONL", async () => {
    const tmpHome = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-filelogger-"))
    const origHome = process.env.HOME
    process.env.HOME = tmpHome

    try {
      Fs.mkdirSync(Path.join(tmpHome, ".hamilton", "runs", "r1", "logs"), { recursive: true })

      const program = Effect.scoped(
        Effect.gen(function* (_) {
          yield* FileLogger
          yield* _(Effect.sleep("10 millis"))
          const bus = yield* _(EventBus)
          yield* _(bus.publish({ _tag: "LlmMessage", runId: "r1", taskId: "s1", text: "hello" }))
          yield* _(bus.publish({ _tag: "ToolCall", runId: "r1", taskId: "s1", tool: "bash", input: { cmd: "ls" }, toolCallId: "call-1" }))
          yield* _(Effect.sleep("50 millis"))
        })
      )

      await Effect.runPromise(program.pipe(Effect.provide(EventBusLive)))

      const logPath = Path.join(tmpHome, ".hamilton", "runs", "r1", "logs", "s1.jsonl")
      const content = Fs.readFileSync(logPath, "utf-8").trim().split("\n")
      expect(content).toHaveLength(2)

      const e1 = JSON.parse(content[0]!)
      expect(e1.event).toBe("llm_message")
      expect(e1.text).toBe("hello")

      const e2 = JSON.parse(content[1]!)
      expect(e2.event).toBe("tool_call")
      expect(e2.tool).toBe("bash")
    } finally {
      process.env.HOME = origHome
      Fs.rmSync(tmpHome, { recursive: true, force: true })
    }
  })
})