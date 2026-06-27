import { Effect, Data } from "effect"
import { EventBus } from "../../events/bus.js"
import type { ThinkingLevel } from "@earendil-works/pi-agent-core"
import {
  AuthStorage,
  createAgentSession,
  createSyntheticSourceInfo,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent"
import type { Skill, ResourceDiagnostic } from "@earendil-works/pi-coding-agent"
import { getModel } from "@earendil-works/pi-ai"
import { piAgentDir } from "./paths.js"
import { subscribePiEvents } from "./streaming.js"

import * as Fs from "node:fs"
import * as Path from "node:path"
import { buildExtensions, readExtensionSettings, type ExtensionFactory } from "./extensions/extensions.js"
import { createWorkflowExtension } from "./extensions/workflow-extension.js"
import { taskOutputFile } from "../../paths.js"
import type { ResolvablePrompt } from "../../prompts/types.js"
import { createGuidelineExtension } from "./extensions/guideline-extension.js"
import { createRedactExtension } from "./extensions/redact-extension.js"
import { createLspAutocheckExtension } from "./extensions/lsp-autocheck-extension.js"
import type { CompiledRule } from "../../guidelines/types.js"
import type { HookRuntime } from "../../hook/integration.js"

export interface PiExecutorConfig {
  prompt: ResolvablePrompt
  taskId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  cwd?: string
  extensions?: Array<unknown>
  settings?: {
    thinking?: string
    tools?: string[]
    skills?: import("../../skills/registry.js").SkillEntry[] | null
    retryOnTransient?: boolean
    compactionEnabled?: boolean
  }
  outputSchema?: Record<string, unknown>
  rules?: CompiledRule[]
  hookRuntime?: HookRuntime
}

export class PiExecutionError extends Data.TaggedError("PiExecutionError")<{
  taskId: string
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
  if (!base.includes("write_task_output")) {
    return [...base, "write_task_output"]
  }
  return base
}

export function executeWithPi(
  config: PiExecutorConfig
): Effect.Effect<Record<string, unknown>, PiExecutionError, EventBus> {
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

    const { systemTemplate, taskTemplate, guidelineFiles, memoryContext } = config.prompt

    let systemPrompt = Effect.runSync(systemTemplate.render())
    if (memoryContext) {
      systemPrompt += "\n\n" + memoryContext
    }
    const taskPrompt = Effect.runSync(taskTemplate.render())

    const bus = yield* _(EventBus)

    yield* _(bus.publish({
      _tag: "PromptBuilt",
      runId: config.runId,
      taskId: config.taskId,
      systemPrompt,
      taskPrompt,
      guidelineFiles: guidelineFiles.map(g => g.name)
    }))

    const extSettings = readExtensionSettings()
    const extensionFactories = buildExtensions(extSettings, cwd)

    let sessionRef: typeof session | null = null

    if (config.rules && config.rules.length > 0) {
      extensionFactories.push(createGuidelineExtension(config.rules) as ExtensionFactory)
    }

    extensionFactories.push(
      createWorkflowExtension(
        config.runId,
        config.taskId,
        config.outputSchema,
        () => { sessionRef?.abort().catch(() => { }) },
        bus
      )
    )

    extensionFactories.push(createRedactExtension())

    const resolvedSkills = config.settings?.skills ?? null
    const loaderOptions: any = {
      cwd,
      agentDir,
      appendSystemPrompt: () => systemPrompt,
      agentsFilesOverride: (current: any) => ({
        agentsFiles: current?.agentsFiles ?? []
      }),
      extensionFactories,
      settingsManager
    }

    if (!resolvedSkills || resolvedSkills.length === 0) {
      loaderOptions.noSkills = true
    } else {
      loaderOptions.skillsOverride = (base: { skills: Skill[]; diagnostics: ResourceDiagnostic[] }) => {
        const skills: Skill[] = resolvedSkills.map((entry) => ({
          name: entry.name,
          description: entry.description,
          filePath: entry.filePath,
          baseDir: entry.baseDir,
          sourceInfo: createSyntheticSourceInfo(entry.filePath, {
            source: "hamilton",
            scope: "user" as const,
            origin: "package" as const,
            baseDir: entry.baseDir
          }),
          disableModelInvocation: false
        }))
        return { skills, diagnostics: base.diagnostics }
      }
    }

    const loader = new DefaultResourceLoader(loaderOptions)

    yield* _(Effect.promise(() => loader.reload()))

    const sessionManager = SessionManager.inMemory()

    const { session } = yield* _(
      Effect.promise(() =>
        createAgentSession({
          model,
          thinkingLevel,
          tools: buildToolSet(config.settings?.tools),
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

    if (config.hookRuntime) {
      const enterResult = yield* _(config.hookRuntime.run("on_agent_enter", {
        runId: config.runId,
        taskId: config.taskId,
        agentId: config.agentId,
        session,
        prompt: taskPrompt
      }))
      if (enterResult.action === "cancel" || enterResult.action === "fail") {
        return {}
      }
    }

    if (config.settings?.compactionEnabled) {
      (session as any).setAutoCompactionEnabled?.(true)
    }

    const handlePiEvent = subscribePiEvents(
      config.runId,
      config.taskId,
      () => {
        const stats = session.getSessionStats?.()
        return {
          inputTokens: stats?.tokens?.input ?? 0,
          outputTokens: stats?.tokens?.output ?? 0
        }
      }
    )

    const lspEntry = extSettings.extensions?.find((e) => e.name === "lsp")
    if (lspEntry && lspEntry.enabled !== false && lspEntry.parameters?.autoCheck !== false) {
      extensionFactories.push(createLspAutocheckExtension(bus, config.runId, config.taskId))
    }

    const unsubscribe = session.subscribe((piEvent) => {
      Effect.runPromise(handlePiEvent(piEvent as Parameters<typeof handlePiEvent>[0]).pipe(
        Effect.provideService(EventBus, bus)
      ))
    })

    try {
      yield* _(Effect.promise(() => session.prompt(taskPrompt)))

      if (config.hookRuntime) {
        yield* _(config.hookRuntime.run("on_agent_exit", {
          runId: config.runId,
          taskId: config.taskId,
          session
        }))
      }

      const outputPath = taskOutputFile(config.runId, config.taskId)
      if (!Fs.existsSync(outputPath)) {
        return yield* _(
          Effect.fail(
            new PiExecutionError({
              taskId: config.taskId,
              message: "Task did not call write_task_output"
            })
          )
        )
      }

      const raw = Fs.readFileSync(outputPath, "utf-8")
      const parsed = JSON.parse(raw) as Record<string, unknown>
      return parsed
    } catch (e) {
      const outputPath = taskOutputFile(config.runId, config.taskId)
      if (Fs.existsSync(outputPath)) {
        const raw = Fs.readFileSync(outputPath, "utf-8")
        const parsed = JSON.parse(raw) as Record<string, unknown>
        return parsed
      }

      return yield* _(
        Effect.fail(
          new PiExecutionError({
            taskId: config.taskId,
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
