import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { SystemPromptPaths } from "../types.js"

// TODO: rename interface to SystemPromptFragments
export interface Persona {
  agent: string // TODO: make it use the Prompt interface type
  soul: string // TODO: make it use the Prompt interface type
  context: string // TODO: make it use the Prompt interface type
}

export class PersonaNotFoundError extends Data.TaggedError("PersonaNotFoundError")<{
  agentPath: string
}> { }

// TODO: rename to readOptionalFile
function tryReadOptional(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

// TODO: rename function to resolveSystemPromptFragments
export function resolvePersona(
  paths: SystemPromptPaths,
  agentDir: string
): Effect.Effect<Persona, PersonaNotFoundError> {
  return Effect.gen(function* (_) {
    const resolvePath = (p: string) => Path.resolve(agentDir, p)

    const agent = yield* _(
      Effect.try({
        try: () => {
          if (!paths.agent) return "" // TODO: remove this if; it stops the logic from failing to catch if the path is empty
          return Fs.readFileSync(resolvePath(paths.agent), "utf-8")
        },
        catch: () => new PersonaNotFoundError({ agentPath: paths.agent })
      })
    )

    const soul = paths.soul ? tryReadOptional(resolvePath(paths.soul)) : ""

    // TODO: should use a paths.context instead of a hard-coded file name
    const context = tryReadOptional(resolvePath("CONTEXT.md"))

    return { agent, soul, context }
  })
}