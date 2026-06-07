import { Data, Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"

export class SharedAgentsSymlinkError extends Data.TaggedError("SharedAgentsSymlinkError")<{
  message: string
}> {}

export function ensureSharedAgentsSymlink(
  workflowDir: string,
  agentsDir?: string
): Effect.Effect<void, SharedAgentsSymlinkError> {
  return Effect.gen(function* (_) {
    const target = agentsDir ?? Path.resolve(workflowDir, "..", "..", "agents")
    const linkPath = Path.join(workflowDir, "shared", "agents")
    const sharedDir = Path.join(workflowDir, "shared")

    const exists = yield* _(
      Effect.try({
        try: () => Fs.existsSync(linkPath),
        catch: () => new SharedAgentsSymlinkError({ message: `Failed to check existence of ${linkPath}` })
      })
    )

    if (exists) {
      const isSymlink = yield* _(
        Effect.try({
          try: () => Fs.lstatSync(linkPath).isSymbolicLink(),
          catch: () => new SharedAgentsSymlinkError({ message: `Failed to lstat ${linkPath}` })
        })
      )

      if (isSymlink) {
        const currentTarget = yield* _(
          Effect.try({
            try: () => Fs.readlinkSync(linkPath),
            catch: () => new SharedAgentsSymlinkError({ message: `Failed to readlink ${linkPath}` })
          })
        )

        const resolvedCurrent = Path.resolve(Path.dirname(linkPath), currentTarget)
        if (resolvedCurrent === Path.resolve(target)) {
          return
        }
      }

      yield* _(
        Effect.try({
          try: () => Fs.rmSync(linkPath, { force: true }),
          catch: () => new SharedAgentsSymlinkError({ message: `Failed to remove ${linkPath}` })
        })
      )
    }

    yield* _(
      Effect.try({
        try: () => {
          if (!Fs.existsSync(sharedDir)) {
            Fs.mkdirSync(sharedDir, { recursive: true })
          }
        },
        catch: () => new SharedAgentsSymlinkError({ message: `Failed to create shared directory ${sharedDir}` })
      })
    )

    yield* _(
      Effect.try({
        try: () => Fs.symlinkSync(target, linkPath),
        catch: () => new SharedAgentsSymlinkError({ message: `Failed to create symlink ${linkPath} -> ${target}` })
      })
    )
  })
}