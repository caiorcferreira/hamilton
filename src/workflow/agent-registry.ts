import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"
import type { AgentManifest, SystemPromptPaths } from "../types.js"

export class DuplicateAgentError extends Data.TaggedError("DuplicateAgentError")<{
  name: string
  existingPath: string
  conflictPath: string
}> {}

export class AgentManifestParseError extends Data.TaggedError("AgentManifestParseError")<{
  filePath: string
  message: string
}> {}

export interface WorkflowDescriptor {
  name: string
  dir: string
}

function readSystemPromptDefaults(dirPath: string): SystemPromptPaths {
  return {
    agent: Fs.existsSync(Path.join(dirPath, "AGENTS.md")) ? "AGENTS.md" : "",
    soul: Fs.existsSync(Path.join(dirPath, "SOUL.md")) ? "SOUL.md" : "",
    identity: Fs.existsSync(Path.join(dirPath, "IDENTITY.md")) ? "IDENTITY.md" : ""
  }
}

function mergeSystemPrompt(
  explicit: SystemPromptPaths | undefined,
  defaults: SystemPromptPaths
): SystemPromptPaths {
  return {
    agent: explicit?.agent || defaults.agent,
    soul: explicit?.soul || defaults.soul,
    identity: explicit?.identity || defaults.identity
  }
}

function loadAgentDir(
  agentsDir: string,
  dirName: string
): Effect.Effect<AgentManifest, AgentManifestParseError> {
  return Effect.gen(function* (_) {
    const dirPath = Path.join(agentsDir, dirName)
    const filePath = Path.join(dirPath, "agent.yml")

    const content = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(filePath, "utf-8"),
        catch: () => new AgentManifestParseError({
          filePath,
          message: `agent.yml not found in ${dirPath}`
        })
      })
    )

    const raw = yield* _(
      Effect.try({
        try: () => Yaml.parse(content) as any,
        catch: (e) => new AgentManifestParseError({
          filePath,
          message: `Failed to parse agent.yml: ${String(e)}`
        })
      })
    )

    if (!raw.name || raw.name !== dirName) {
      return yield* _(
        Effect.fail(new AgentManifestParseError({
          filePath,
          message: `Agent name "${raw.name}" does not match directory name "${dirName}"`
        }))
      )
    }

    const defaults = readSystemPromptDefaults(dirPath)
    const explicitPrompt = raw.settings?.systemPrompt as SystemPromptPaths | undefined
    const systemPrompt = mergeSystemPrompt(explicitPrompt, defaults)

    return {
      name: raw.name,
      dirPath,
      settings: {
        model: raw.settings?.model,
        systemPrompt: explicitPrompt,
        skills: raw.settings?.skills
      },
      systemPrompt
    }
  })
}

function loadAgentsFromDir(
  agentsDir: string
): Effect.Effect<AgentManifest[], AgentManifestParseError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(agentsDir)) return []

    let entries: Fs.Dirent[]
    try {
      entries = Fs.readdirSync(agentsDir, { withFileTypes: true })
    } catch {
      entries = []
    }

    const manifests: AgentManifest[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const manifest = yield* _(loadAgentDir(agentsDir, entry.name))
      manifests.push(manifest)
    }
    return manifests
  })
}

export function loadAgentManifests(
  sharedAgentsDir: string,
  workflows: WorkflowDescriptor[]
): Effect.Effect<Map<string, AgentManifest>, DuplicateAgentError | AgentManifestParseError> {
  return Effect.gen(function* (_) {
    const registry = new Map<string, AgentManifest>()
    const sourceMap = new Map<string, string>()

    const sharedManifests = yield* _(loadAgentsFromDir(sharedAgentsDir))
    for (const m of sharedManifests) {
      registry.set(m.name, m)
      sourceMap.set(m.name, sharedAgentsDir)
    }

    for (const wf of workflows) {
      const wfAgentsDir = Path.join(wf.dir, "agents")
      const wfManifests = yield* _(loadAgentsFromDir(wfAgentsDir))
      for (const m of wfManifests) {
        if (registry.has(m.name)) {
          const existingSource = sourceMap.get(m.name)!
          return yield* _(
            Effect.fail(new DuplicateAgentError({
              name: m.name,
              existingPath: existingSource,
              conflictPath: wf.dir
            }))
          )
        }
        registry.set(m.name, m)
        sourceMap.set(m.name, wf.dir)
      }
    }

    return registry
  })
}