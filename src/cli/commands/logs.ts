import { Args, Command, Options } from "@effect/cli"
import { Console, Data, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { stepLogsDir, stepLogFile, eventsFilePath, hamiltonHome } from "../../paths.js"

export class LogsError extends Data.TaggedError("LogsError")<{
  runId: string
  message: string
}> {}

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

export function getRunLogs(params: LogsParams): Effect.Effect<LogEvent[], LogsError> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* _(Effect.fail(new LogsError({
        runId: params.runId,
        message: 'Hamilton is not initialized. Run "hamilton init" first.'
      })))
    }

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

export function followLogs(params: { runId: string }): { stop: () => void } {
  const logsDir = stepLogsDir(params.runId)
  const eventsPath = eventsFilePath(params.runId)
  let stopped = false

  const stop = () => { stopped = true }

  const seenBytes = new Map<string, number>()
  let eventsSeenBytes = 0

  const poll = () => {
    if (stopped) return
    try {
      if (Fs.existsSync(logsDir)) {
        const files = Fs.readdirSync(logsDir).filter(f => f.endsWith(".jsonl")).sort()
        for (const file of files) {
          const filePath = Path.join(logsDir, file)
          try {
            const stat = Fs.statSync(filePath)
            const previousSize = seenBytes.get(file) ?? 0
            if (stat.size > previousSize) {
              const fd = Fs.openSync(filePath, "r")
              const buffer = Buffer.alloc(stat.size - previousSize)
              Fs.readSync(fd, buffer, 0, buffer.length, previousSize)
              Fs.closeSync(fd)
              for (const line of buffer.toString("utf-8").trim().split("\n")) {
                if (line.trim()) {
                  try { console.log(JSON.stringify(JSON.parse(line))) } catch { console.log(line) }
                }
              }
            }
            seenBytes.set(file, stat.size)
          } catch {}
        }
      }
    } catch {}

    try {
      if (!stopped && Fs.existsSync(eventsPath)) {
        const stat = Fs.statSync(eventsPath)
        if (stat.size > eventsSeenBytes) {
          const fd = Fs.openSync(eventsPath, "r")
          const buffer = Buffer.alloc(stat.size - eventsSeenBytes)
          Fs.readSync(fd, buffer, 0, buffer.length, eventsSeenBytes)
          Fs.closeSync(fd)
          for (const line of buffer.toString("utf-8").trim().split("\n")) {
            if (line.trim()) {
              try { console.log(JSON.stringify(JSON.parse(line))) } catch { console.log(line) }
            }
          }
        }
        eventsSeenBytes = stat.size
      }
    } catch {}
  }

  const interval = setInterval(poll, 500)

  return {
    stop: () => {
      stopped = true
      clearInterval(interval)
    }
  }
}

const runIdArg = Args.text({ name: "id" })
const stepOpt = Options.text("step").pipe(Options.optional)
const followOpt = Options.boolean("follow")

export const logsCommand = Command.make("logs", { id: runIdArg, step: stepOpt, follow: followOpt }, ({ id, step, follow }) =>
  Effect.gen(function* () {
    if (follow) {
      const controller = followLogs({ runId: id })
      process.on("SIGINT", () => { controller.stop(); process.exit(0) })
      yield* Effect.never
    }
    const result = yield* Effect.exit(
      getRunLogs({ runId: id, stepId: step._tag === "Some" ? step.value : undefined })
    )
    if (Exit.isFailure(result)) {
      yield* Console.error(`Logs not found: ${id}`)
      return
    }
    for (const event of result.value) {
      yield* Console.log(JSON.stringify(event))
    }
  })
).pipe(Command.withDescription("View run logs"))