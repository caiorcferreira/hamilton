import { Effect, Data } from "effect"
import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent"
import { getModel } from "@earendil-works/pi-ai"
import { subscribePiEvents } from "../observability/streaming.js"
import { appendStepLog } from "../observability/run-dir.js"
import { parseAgentOutput } from "../agent/activity.js"

export interface PiExecutorConfig {
  systemPrompt: string
  taskPrompt: string
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  cwd?: string
  extensions?: Array<unknown>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: string[]
  }
}

export class PiExecutionError extends Data.TaggedError("PiExecutionError")<{
  stepId: string
  message: string
}> {}

function parseModelString(
  model?: string
): [string, string] {
  const defaultModel = "anthropic/claude-sonnet-4-20250514"
  const parts = (model ?? defaultModel).split("/")
  if (parts.length !== 2) {
    const fallback = defaultModel.split("/")
    return [fallback[0]!, fallback[1]!]
  }
  return [parts[0]!, parts[1]!]
}

function mapThinkingLevel(level?: string): ThinkingLevel {
  switch (level) {
    case "minimal": return "minimal"
    case "low": return "low"
    case "medium": return "medium"
    case "high": return "high"
    case "xhigh": return "xhigh"
    default: return "off"
  }
}

function extractTextContent(msg: unknown): string {
  if (typeof msg === "string") return msg
  if (msg && typeof msg === "object") {
    const candidate = msg as Record<string, unknown>
    if (typeof candidate.content === "string") return candidate.content
    if (Array.isArray(candidate.content)) {
      const texts = candidate.content
        .filter(
          (block: unknown) =>
            block && typeof block === "object" && (block as Record<string, unknown>).type === "text" && typeof (block as Record<string, unknown>).text === "string"
        )
        .map((block: unknown) => (block as Record<string, unknown>).text as string)
      return texts.join("")
    }
  }
  return ""
}

export function executeWithPi(
  config: PiExecutorConfig
): Effect.Effect<Record<string, unknown>, PiExecutionError> {
  return Effect.gen(function* (_) {
    const cwd = config.cwd ?? process.cwd()

    const authStorage = AuthStorage.create()
    const modelRegistry = ModelRegistry.create(authStorage)
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false }
    })

    const [provider, modelId] = parseModelString(config.model)
    const model = getModel(provider as "anthropic", modelId as Parameters<typeof getModel>[1])
    const thinkingLevel = mapThinkingLevel(config.settings?.thinking)

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: ".pi-agent",
      systemPromptOverride: () => config.systemPrompt,
      extensionFactories: config.extensions as Array<(pi: unknown) => void> | undefined,
      settingsManager
    })

    yield* _(Effect.promise(() => loader.reload()))

    const sessionManager = SessionManager.inMemory()

    const { session } = yield* _(
      Effect.promise(() =>
        createAgentSession({
          model,
          thinkingLevel,
          tools: config.settings?.tools ?? [],
          authStorage,
          modelRegistry,
          resourceLoader: loader,
          sessionManager,
          settingsManager
        })
      )
    )

    const handlePiEvent = subscribePiEvents({
      runId: config.runId,
      stepId: config.stepId,
      onLog: (event) => appendStepLog(config.runId, config.stepId, event).pipe(
        Effect.catchAll(() => Effect.void)
      ),
      onTokenEvent: ({ runId, stepId, tokensIn, tokensOut }) =>
        appendStepLog(runId, stepId, { event: "token_usage", tokens_in: tokensIn, tokens_out: tokensOut }).pipe(
          Effect.catchAll(() => Effect.void)
        )
    })

    const unsubscribe = session.subscribe((piEvent) => {
      Effect.runPromise(handlePiEvent(piEvent as Parameters<typeof handlePiEvent>[0]))
    })

    try {
      yield* _(Effect.promise(() => session.prompt(config.taskPrompt)))

      const messages = session.messages
      const assistantMessages = messages.filter((m) => (m as { role: string }).role === "assistant")
      const lastAssistant = assistantMessages[assistantMessages.length - 1]
      if (!lastAssistant) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              stepId: config.stepId,
              message: "No assistant response received"
            })
          )
        )
      }

      const text = extractTextContent(lastAssistant)
      if (!text) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              stepId: config.stepId,
              message: "Assistant response had no text content"
            })
          )
        )
      }

      return yield* _(
        parseAgentOutput(text).pipe(
          Effect.mapError(
            (e) =>
              new PiExecutionError({
                stepId: config.stepId,
                message: e.message
              })
          )
        )
      )
    } catch (e) {
      return yield* _(
        Effect.fail(
          new PiExecutionError({
            stepId: config.stepId,
            message: e instanceof Error ? e.message : String(e)
          })
        )
      )
    } finally {
      unsubscribe()
      session.dispose()
    }
  })
}
