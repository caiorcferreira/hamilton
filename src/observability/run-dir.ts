import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import {
  runDir,
  taskOutputsDir,
  taskLogsDir,
  taskOutputFile,
  taskLogFile,
  inputFile,
  summaryFile,
  eventsFilePath,
  progressDir,
  progressFile
} from "../paths.js"

export class RunDirError extends Data.TaggedError("RunDirError")<{
  runId: string
  message: string
}> {}

export function createRunDir(runId: string): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.mkdirSync(taskOutputsDir(runId), { recursive: true })
      Fs.mkdirSync(taskLogsDir(runId), { recursive: true })
    },
    catch: () => new RunDirError({ runId, message: `Failed to create run directory for ${runId}` })
  })
}

export function writeInput(runId: string, input: Record<string, unknown>): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.writeFileSync(inputFile(runId), JSON.stringify(input, null, 2))
    },
    catch: () => new RunDirError({ runId, message: `Failed to write input for ${runId}` })
  })
}

export function writeTaskOutput(runId: string, taskId: string, output: Record<string, unknown>): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.writeFileSync(taskOutputFile(runId, taskId), JSON.stringify(output, null, 2))
    },
    catch: () => new RunDirError({ runId, message: `Failed to write task output for ${taskId}` })
  })
}

export function appendTaskLog(runId: string, taskId: string, event: Record<string, unknown>): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n"
      Fs.appendFileSync(taskLogFile(runId, taskId), line)
    },
    catch: () => new RunDirError({ runId, message: `Failed to append task log for ${taskId}` })
  })
}

export function writeSummary(runId: string, summary: Record<string, unknown>): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.writeFileSync(summaryFile(runId), JSON.stringify(summary, null, 2))
    },
    catch: () => new RunDirError({ runId, message: `Failed to write summary for ${runId}` })
  })
}

export function appendEngineLog(
  runId: string,
  event: Record<string, unknown>
): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event })
      const path = eventsFilePath(runId)
      Fs.appendFileSync(path, line + "\n", "utf-8")
    },
    catch: () => new RunDirError({ runId, message: "Failed to append engine log" })
  })
}

export function ensureProgressFile(runId: string, projectDir?: string): Effect.Effect<string, RunDirError> {
  return Effect.try({
    try: () => {
      const dir = progressDir(projectDir)
      Fs.mkdirSync(dir, { recursive: true })
      const filePath = progressFile(projectDir)
      if (!Fs.existsSync(filePath)) {
        const header = `# Progress Log — ${new Date().toISOString().slice(0, 10)}\n\n## Run ${runId}\n\n`
        Fs.writeFileSync(filePath, header)
      }
      return filePath
    },
    catch: (e) => new RunDirError({ runId, message: `Failed to create progress file: ${String(e)}` })
  })
}