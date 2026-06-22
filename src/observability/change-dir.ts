import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { changeDir, changeMetadataFile } from "../paths.js"

export class ChangeDirError extends Data.TaggedError("ChangeDirError")<{
  message: string
}> {}

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
