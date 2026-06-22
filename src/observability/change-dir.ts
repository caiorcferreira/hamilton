import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { changeDir, nextIdFile, changeMetadataFile } from "../paths.js"

export class ChangeDirError extends Data.TaggedError("ChangeDirError")<{
  message: string
}> {}

export function readNextId(projectDir?: string): Effect.Effect<number, ChangeDirError> {
  return Effect.try({
    try: () => {
      const file = nextIdFile(projectDir)
      if (!Fs.existsSync(file)) return 0
      const content = Fs.readFileSync(file, "utf-8").trim()
      if (content === "") return 0
      const id = Number(content)
      return Number.isNaN(id) ? 0 : id
    },
    catch: () => new ChangeDirError({ message: "Failed to read next-id.txt" })
  })
}

export function writeNextId(id: number, projectDir?: string): Effect.Effect<void, ChangeDirError> {
  return Effect.try({
    try: () => {
      const file = nextIdFile(projectDir)
      const dir = Path.dirname(file)
      Fs.mkdirSync(dir, { recursive: true })
      Fs.writeFileSync(file, String(id))
    },
    catch: () => new ChangeDirError({ message: "Failed to write next-id.txt" })
  })
}

export function ensureChangeDir(changeId: string, projectDir?: string): Effect.Effect<void, ChangeDirError> {
  return Effect.try({
    try: () => {
      const dir = changeDir(changeId, projectDir)
      if (Fs.existsSync(dir)) {
        throw new Error(`Change directory already exists: ${dir}`)
      }
      Fs.mkdirSync(dir, { recursive: true })
    },
    catch: (e) => new ChangeDirError({ message: e instanceof Error ? e.message : `Failed to create change directory for ${changeId}` })
  })
}

export function writeWorkflowMetadata(changeId: string, metadata: Record<string, unknown>, projectDir?: string): Effect.Effect<void, ChangeDirError> {
  return Effect.try({
    try: () => {
      const file = changeMetadataFile(changeId, projectDir)
      const dir = Path.dirname(file)
      Fs.mkdirSync(dir, { recursive: true })
      Fs.writeFileSync(file, JSON.stringify(metadata, null, 2))
    },
    catch: () => new ChangeDirError({ message: `Failed to write workflow metadata for ${changeId}` })
  })
}
