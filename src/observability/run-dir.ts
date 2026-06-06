import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import {
  runDir,
  stepOutputsDir,
  stepLogsDir,
  stepOutputFile,
  stepLogFile,
  inputFile,
  summaryFile
} from "../paths.js"

export class RunDirError extends Data.TaggedError("RunDirError")<{
  runId: string
  message: string
}> {}

export function createRunDir(runId: string): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.mkdirSync(stepOutputsDir(runId), { recursive: true })
      Fs.mkdirSync(stepLogsDir(runId), { recursive: true })
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

export function writeStepOutput(runId: string, stepId: string, output: Record<string, unknown>): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.writeFileSync(stepOutputFile(runId, stepId), JSON.stringify(output, null, 2))
    },
    catch: () => new RunDirError({ runId, message: `Failed to write step output for ${stepId}` })
  })
}

export function appendStepLog(runId: string, stepId: string, event: Record<string, unknown>): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      const line = JSON.stringify({ ...event, timestamp: new Date().toISOString() }) + "\n"
      Fs.appendFileSync(stepLogFile(runId, stepId), line)
    },
    catch: () => new RunDirError({ runId, message: `Failed to append step log for ${stepId}` })
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