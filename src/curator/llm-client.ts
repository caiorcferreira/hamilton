import { Effect } from "effect"
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent"
import { complete, getModel, type Context, type AssistantMessage } from "@earendil-works/pi-ai"
import * as Path from "node:path"
import { piAgentDir } from "../executors/pi/paths.js"
import type { EventBusService } from "../events/bus.js"

export interface LLMClient {
  complete(provider: string, modelId: string, context: Context): Promise<AssistantMessage>
}

export function createLLMClient(config?: {
  modelsJsonPath?: string
  bus?: EventBusService
}): LLMClient {
  const agentDir = piAgentDir()
  const authStorage = AuthStorage.create(Path.join(agentDir, "auth.json"))
  const registry = config?.modelsJsonPath
    ? ModelRegistry.create(authStorage, config.modelsJsonPath)
    : ModelRegistry.create(authStorage, Path.join(agentDir, "models.json"))

  return {
    async complete(provider, modelId, context) {
      const model = getModel(provider as "openai", modelId as Parameters<typeof getModel>[1])

      const auth = await registry.getApiKeyAndHeaders(model)
      if (!auth.ok) throw new Error(auth.error)

      const response = await complete(model, context, {
        apiKey: auth.apiKey,
        headers: auth.headers,
      })

      if (config?.bus) {
        Effect.runPromise(
          config.bus.publish({
            _tag: "TokenUsage" as const,
            tokensIn: response.usage?.input ?? 0,
            tokensOut: response.usage?.output ?? 0,
          })
        ).catch(() => {})
      }

      return response
    },
  }
}