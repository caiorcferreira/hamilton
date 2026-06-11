import { HashMap, Logger, Option } from "effect"
import * as Fs from "node:fs"
import { eventsFilePath } from "../paths.js"

export function createHamiltonLogger(runId: string) {
  const filePath = eventsFilePath(runId)

  const fileSink = Logger.make(({ logLevel, message, annotations }) => {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: logLevel.label,
      message: Array.isArray(message) ? message.join(" ") : String(message),
      service: "hamilton",
      run_id: runId
    }
    const taskId = Option.getOrUndefined(HashMap.get(annotations, "task_id"))
    if (taskId) {
      record.task_id = taskId
    }
    try {
      Fs.appendFileSync(filePath, JSON.stringify(record) + "\n", "utf-8")
    } catch {}
  })

  return Logger.zip(
    Logger.prettyLogger({ mode: "tty", colors: true }),
    fileSink
  )
}