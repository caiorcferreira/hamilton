import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { stepLogsDir, stepLogFile } from "../../paths.js"

export interface LogEvent {
  event: string
  step_id?: string
  timestamp?: string
  [key: string]: unknown
}

export interface LogsParams {
  runId: string
  stepId?: string
}

export function getRunLogs(params: LogsParams): Effect.Effect<LogEvent[], never> {
  return Effect.gen(function* (_) {
    const logsDir = stepLogsDir(params.runId)

    const files = yield* _(
      Effect.try({
        try: () => {
          if (!Fs.existsSync(logsDir)) return [] as string[]
          if (params.stepId) {
            const f = stepLogFile(params.runId, params.stepId)
            return Fs.existsSync(f) ? [Path.basename(f)] : []
          }
          return Fs.readdirSync(logsDir).filter((f) => f.endsWith(".jsonl")).sort()
        },
        catch: () => [] as string[]
      }).pipe(Effect.orElseSucceed(() => [] as string[]))
    )

    const events: LogEvent[] = []
    for (const file of files) {
      const filePath = Path.join(logsDir, file)
      const content = yield* _(
        Effect.try({
          try: () => Fs.readFileSync(filePath, "utf-8"),
          catch: () => ""
        }).pipe(Effect.orElseSucceed(() => ""))
      )

      if (content) {
        for (const line of content.trim().split("\n")) {
          if (!line.trim()) continue
          const parsed = yield* _(
            Effect.try({
              try: () => JSON.parse(line) as LogEvent,
              catch: () => null as unknown as LogEvent
            }).pipe(Effect.orElseSucceed(() => null as unknown as LogEvent))
          )
          if (parsed) events.push(parsed)
        }
      }
    }

    events.sort((a, b) => {
      if (a.timestamp && b.timestamp) return a.timestamp.localeCompare(b.timestamp)
      return 0
    })

    return events
  })
}