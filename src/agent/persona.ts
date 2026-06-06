import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"

export interface Persona {
  agents: string
  identity: string
  soul: string
}

export class PersonaLoadError extends Data.TaggedError("PersonaLoadError")<{
  dir: string
  message: string
}> {}

function tryReadFile(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

export function loadPersona(dir: string): Effect.Effect<Persona, PersonaLoadError> {
  return Effect.try({
    try: () => {
      const agentsPath = Path.join(dir, "AGENTS.md")
      const agentsContent = Fs.readFileSync(agentsPath, "utf-8")
      const identityContent = tryReadFile(Path.join(dir, "IDENTITY.md"))
      const soulContent = tryReadFile(Path.join(dir, "SOUL.md"))
      return {
        agents: agentsContent,
        identity: identityContent,
        soul: soulContent
      }
    },
    catch: () => new PersonaLoadError({ dir, message: `Failed to load persona from ${dir}` })
  })
}