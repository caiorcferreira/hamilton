import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { ensureHamiltonHome, agentsDir } from "../../paths.js"
import { openDb } from "../../workflow/state.js"
import { installAllWorkflows } from "./install.js"

const PROJECT_ROOT = Path.resolve(import.meta.dirname, "..", "..", "..")

export class InitError extends Data.TaggedError("InitError")<{
  message: string
}> {}

function copySharedAgents(options?: { force?: boolean }): Effect.Effect<void, InitError> {
  return Effect.gen(function* () {
    const sharedDir = Path.join(PROJECT_ROOT, "agents", "shared")
    if (!Fs.existsSync(sharedDir)) return

    const destAgents = agentsDir()
    const entries = Fs.readdirSync(sharedDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const srcPath = Path.join(sharedDir, entry.name)
      const destPath = Path.join(destAgents, entry.name)

      if (Fs.existsSync(destPath) && !options?.force) continue

      yield* Effect.try({
        try: () => Fs.cpSync(srcPath, destPath, { recursive: true, force: true }),
        catch: (e) =>
          new InitError({ message: `Failed to copy shared agent "${entry.name}": ${String(e)}` })
      })
    }
  })
}

function copyWorkflowAgents(
  workflowId: string,
  options?: { force?: boolean }
): Effect.Effect<void, InitError> {
  return Effect.gen(function* () {
    const workflowAgentsDir = Path.join(PROJECT_ROOT, "workflows", workflowId, "agents")
    if (!Fs.existsSync(workflowAgentsDir)) return

    const destAgents = agentsDir()
    const entries = Fs.readdirSync(workflowAgentsDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const srcPath = Path.join(workflowAgentsDir, entry.name)
      const destPath = Path.join(destAgents, entry.name)

      if (Fs.existsSync(destPath) && !options?.force) continue

      yield* Effect.try({
        try: () => Fs.cpSync(srcPath, destPath, { recursive: true, force: true }),
        catch: (e) =>
          new InitError({ message: `Failed to copy workflow agent "${entry.name}" from "${workflowId}": ${String(e)}` })
      })
    }
  })
}

export function initHamilton(options?: { force?: boolean }): Effect.Effect<string[], InitError> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => ensureHamiltonHome(),
      catch: (e) =>
        new InitError({ message: `Failed to create hamilton home directories: ${String(e)}` })
    })

    const db = yield* Effect.mapError(openDb(), (e) =>
      new InitError({ message: `Failed to open database: ${e.message}` })
    )
    yield* Effect.sync(() => db.close())

    yield* copySharedAgents(options)

    const workflowIds = yield* Effect.mapError(installAllWorkflows({ force: true }), (e) =>
      new InitError({ message: `Failed to install workflows: ${e.message}` })
    )

    for (const id of workflowIds) {
      yield* copyWorkflowAgents(id, options)
    }

    return workflowIds
  })
}