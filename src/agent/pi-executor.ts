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
import { createWriteStepOutputTool } from "./write-step-output-tool.js"
import { stepOutputFile } from "../paths.js"

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
    retryOnTransient?: boolean
    compactionEnabled?: boolean
  }
  onTokenUsage?: (tokensIn: number, tokensOut: number) => void
}

export class PiExecutionError extends Data.TaggedError("PiExecutionError")<{
  stepId: string
  message: string
}> { }

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

function buildToolSet(explicitTools?: string[]): string[] {
  const base = explicitTools ?? ["read", "bash", "edit", "write", "grep", "find", "ls"]
  if (!base.includes("write_step_output")) {
    return [...base, "write_step_output"]
  }
  return base
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

    let sessionRef: typeof session | null = null
    const writeStepOutputTool = createWriteStepOutputTool(config.runId, config.stepId, {
      onStepComplete: () => {
        if (sessionRef) {
          sessionRef.abort().catch(() => {})
        }
      }
    })

    const sessionManager = SessionManager.inMemory()

    const { session } = yield* _(
      Effect.promise(() =>
        createAgentSession({
          model,
          thinkingLevel,
          tools: buildToolSet(config.settings?.tools),
          customTools: [writeStepOutputTool],
          agentDir,
          authStorage,
          modelRegistry,
          resourceLoader: loader,
          sessionManager,
          settingsManager
        })
      )
    )

    sessionRef = session

    if (config.settings?.compactionEnabled) {
      (session as any).setAutoCompactionEnabled?.(true)
    }

    const handlePiEvent = subscribePiEvents({
      runId: config.runId,
      stepId: config.stepId,
      onLog: (event) => appendStepLog(config.runId, config.stepId, event).pipe(
        Effect.catchAll(() => Effect.void)
      ),
      onTokenEvent: ({ runId, stepId, tokensIn, tokensOut }) =>
        Effect.gen(function* () {
          yield* appendStepLog(runId, stepId, { event: "token_usage", tokens_in: tokensIn, tokens_out: tokensOut }).pipe(
            Effect.catchAll(() => Effect.void)
          )
          if (config.onTokenUsage) {
            config.onTokenUsage(tokensIn, tokensOut)
          }
        }),
      getSessionStats: () => {
        const stats = session.getSessionStats?.()
        return {
          inputTokens: stats?.tokens?.input ?? 0,
          outputTokens: stats?.tokens?.output ?? 0
        }
      }
    })

    const unsubscribe = session.subscribe((piEvent) => {
      Effect.runPromise(handlePiEvent(piEvent as Parameters<typeof handlePiEvent>[0]))
    })

    try {
      yield* _(Effect.promise(() => session.prompt(config.taskPrompt)))

      const outputPath = stepOutputFile(config.runId, config.stepId)
      const MAX_REMINDERS = 2
      let reminders = 0
      while (!Fs.existsSync(outputPath) && reminders < MAX_REMINDERS) {
        reminders++
        yield* _(
          Effect.promise(() =>
            session.prompt("REMINDER: You must call write_step_output to save your work. Call write_step_output now with your findings.")
          )
        )
      }
      if (!Fs.existsSync(outputPath)) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              stepId: config.stepId,
              message: `Step did not call write_step_output after ${reminders} reminders`
            })
          )
        )
      }

      const raw = Fs.readFileSync(outputPath, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return parsed
    } catch (e) {
      const outputPath = stepOutputFile(config.runId, config.stepId)
      if (Fs.existsSync(outputPath)) {
        const raw = Fs.readFileSync(outputPath, "utf-8")
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return parsed
      }

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
