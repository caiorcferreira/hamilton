import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { SystemPromptPaths } from "../types.js"

export interface Persona {
  agent: string
  soul: string
  identity: string
}

export class PersonaNotFoundError extends Data.TaggedError("PersonaNotFoundError")<{
  agentPath: string
}> {}

function tryReadOptional(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

export function resolvePersona(
  paths: SystemPromptPaths,
  workflowDir: string
): Effect.Effect<Persona, PersonaNotFoundError> {
  return Effect.gen(function* (_) {
    const resolvePath = (p: string) => Path.resolve(workflowDir, p)

    const agent = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.agent), "utf-8"),
        catch: () => new PersonaNotFoundError({ agentPath: paths.agent })
      })
    )

    const soul = tryReadOptional(resolvePath(paths.soul))
    const identity = tryReadOptional(resolvePath(paths.identity))

    return { agent, soul, identity }
  })
}