import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import { runDir, summaryFile } from "../paths.js"

export class RunStateError extends Data.TaggedError("RunStateError")<{
  runId: string
  message: string
}> {}

export interface RunStatus {
  runId: string
  workflow: string
  status: string
  startedAt: string
  completedAt?: string
  stepResults: Record<string, string>
  tokenUsage?: Record<string, unknown>
}

export function loadRunState(runId: string): Effect.Effect<RunStatus, RunStateError> {
  return Effect.gen(function* (_) {
    const filePath = summaryFile(runId)
    const content = yield* _(
      Effect.try({
        try: () => Fs.readFileSync(filePath, "utf-8"),
        catch: () => new RunStateError({ runId, message: `Run directory not found for ${runId}` })
      })
    )

    const parsed = yield* _(
      Effect.try({
        try: () => JSON.parse(content) as RunStatus,
        catch: () => new RunStateError({ runId, message: `Invalid summary.json for ${runId}` })
      })
    )

    return parsed
  })
}