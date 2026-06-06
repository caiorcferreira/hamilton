import * as Fs from "node:fs"
import * as Path from "node:path"
import { Data, Effect } from "effect"
import { agentsDir, workflowsDir } from "../paths.js"

export interface Persona {
  agents: string
  identity: string
  soul: string
}

export class PersonaLoadError extends Data.TaggedError("PersonaLoadError")<{
  agentId: string
  workflowId: string
  message: string
}> {}

function tryReadFile(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

function loadPersonaFromDir(dir: string): Persona | null {
  const agentsPath = Path.join(dir, "AGENTS.md")
  if (!Fs.existsSync(agentsPath)) return null
  const agentsContent = Fs.readFileSync(agentsPath, "utf-8")
  const identityContent = tryReadFile(Path.join(dir, "IDENTITY.md"))
  const soulContent = tryReadFile(Path.join(dir, "SOUL.md"))
  return { agents: agentsContent, identity: identityContent, soul: soulContent }
}

export function resolvePersona(
  agentId: string,
  workflowId: string
): Effect.Effect<Persona, PersonaLoadError> {
  return Effect.sync(() => {
    const localDir = Path.join(workflowsDir(), workflowId, "agents", agentId)
    const local = loadPersonaFromDir(localDir)
    if (local) return local

    const sharedDir = Path.join(agentsDir(), agentId)
    const shared = loadPersonaFromDir(sharedDir)
    if (shared) return shared

    throw new PersonaLoadError({
      agentId,
      workflowId,
      message: `Agent "${agentId}" not found in workflow "${workflowId}" or shared agents. Check "hamilton init".`
    })
  })
}