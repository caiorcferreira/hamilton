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
import { piAgentDir } from "../paths.js"
import { subscribePiEvents } from "../observability/streaming.js"
import { appendStepLog } from "../observability/run-dir.js"

import * as Fs from "node:fs"
import * as Path from "node:path"

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

function readDefaults(agentDir: string): { defaultProvider: string; defaultModel: string } {
  try {
    const settingsPath = Path.join(agentDir, "settings.json")
    const raw = Fs.readFileSync(settingsPath, "utf-8")
    const settings = JSON.parse(raw)
    return {
      defaultProvider: settings.defaultProvider ?? "openai",
      defaultModel: settings.defaultModel ?? "glm-5.1"
    }
  } catch {
    return { defaultProvider: "openai", defaultModel: "glm-5.1" }
  }
}

function parseModelString(
  model: string | undefined,
  defaults: { defaultProvider: string; defaultModel: string }
): [string, string] {
  if (model) {
    const parts = model.split("/")
    if (parts.length === 2) return [parts[0]!, parts[1]!]
  }
  return [defaults.defaultProvider, defaults.defaultModel]
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
    const agentDir = piAgentDir()
    const defaults = readDefaults(agentDir)

    const authStorage = AuthStorage.create(Path.join(agentDir, "auth.json"))
    const modelRegistry = ModelRegistry.create(authStorage, Path.join(agentDir, "models.json"))
    const settingsManager = SettingsManager.create(cwd, agentDir)

    const [provider, modelId] = parseModelString(config.model, defaults)
    const model = getModel(provider as "openai", modelId as Parameters<typeof getModel>[1])
    const thinkingLevel = mapThinkingLevel(config.settings?.thinking)

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
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
          agentDir,
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

      try {
        const parsed: Record<string, unknown> = JSON.parse(text)
        if (typeof parsed !== "object" || parsed === null || !("status" in parsed)) {
          return yield* _(
            Effect.fail(
              new PiExecutionError({
                stepId: config.stepId,
                message: "Agent output must be a JSON object with a \"status\" field"
              })
            )
          )
        }
        return parsed
      } catch (e) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              stepId: config.stepId,
              message: e instanceof Error ? e.message : String(e)
            })
          )
        )
      }
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
