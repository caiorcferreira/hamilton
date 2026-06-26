import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import type { SystemPromptPaths } from "../types.js"
import type { Prompt } from "../types.js"

export interface SystemPromptFragments {
  agent: Prompt
  soul: Prompt
  context: Prompt
}

export class SystemPromptFragmentsNotFoundError extends Data.TaggedError("SystemPromptFragmentsNotFoundError")<{
  agentPath: string
}> { }

function readOptionalFile(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8")
  } catch {
    return ""
  }
}

export function resolveSystemPromptFragments(
  paths: SystemPromptPaths,
  agentDir: string
): Effect.Effect<SystemPromptFragments, SystemPromptFragmentsNotFoundError> {
  return Effect.gen(function* (_) {
    const resolvePath = (p: string) => Path.resolve(agentDir, p)

    const agent = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(resolvePath(paths.agent), "utf-8"),
        catch: () => new SystemPromptFragmentsNotFoundError({ agentPath: paths.agent })
      })
    )

    const soul = paths.soul ? readOptionalFile(resolvePath(paths.soul)) : ""

    const context = paths.context ? readOptionalFile(resolvePath(paths.context)) : ""

    return {
      agent: { content: agent },
      soul: { content: soul },
      context: { content: context }
    }
  })
}
