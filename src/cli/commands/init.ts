import { Command, Options } from "@effect/cli"
import { Console, Data, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { ensureHamiltonHome, agentsDir, piAgentDir } from "../../paths.js"
import { openDb } from "../../workflow/state.js"
import { installAllWorkflows } from "./install-logic.js"

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

function createDefaultPiConfigs(options?: { force?: boolean }): Effect.Effect<void, InitError> {
  return Effect.gen(function* () {
    const agentDir = piAgentDir()

    yield* Effect.try({
      try: () => {
        const settings = Path.join(agentDir, "settings.json")
        const models = Path.join(agentDir, "models.json")
        const auth = Path.join(agentDir, "auth.json")

        if (options?.force || !Fs.existsSync(settings)) {
          Fs.writeFileSync(settings, JSON.stringify({ defaultProvider: "openai", defaultModel: "glm-5.1" }, null, 2))
        }
        if (options?.force || !Fs.existsSync(models)) {
          Fs.writeFileSync(models, JSON.stringify({ providers: {} }, null, 2))
        }
        if (options?.force || !Fs.existsSync(auth)) {
          Fs.writeFileSync(auth, JSON.stringify({}, null, 2))
        }
      },
      catch: (e) => new InitError({ message: `Failed to create default Pi configs: ${String(e)}` })
    })
  })
}

function copyPiConfigsFromHome(): Effect.Effect<void, InitError> {
  return Effect.gen(function* () {
    const piSource = Path.join(process.env.HOME ?? "", ".pi", "agent")
    if (!Fs.existsSync(piSource)) return

    const agentDir = piAgentDir()
    const files = ["settings.json", "models.json", "auth.json"]

    for (const file of files) {
      const src = Path.join(piSource, file)
      const dest = Path.join(agentDir, file)
      if (!Fs.existsSync(src)) continue

      yield* Effect.try({
        try: () => Fs.copyFileSync(src, dest),
        catch: (e) => new InitError({ message: `Failed to copy ${file}: ${String(e)}` })
      })
    }
  })
}

export function initHamilton(options?: { force?: boolean; copyPiConfigs?: boolean }): Effect.Effect<string[], InitError> {
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

    if (options?.copyPiConfigs) {
      yield* copyPiConfigsFromHome()
    }
    yield* createDefaultPiConfigs(options)

    const workflowSlugs = yield* Effect.mapError(installAllWorkflows({ force: true }), (e) =>
      new InitError({ message: `Failed to install workflows: ${e.message}` })
    )

    return workflowSlugs
  })
}

const force = Options.boolean("force")
const copyPiConfigs = Options.boolean("copy-pi-configs")

export const initCommand = Command.make("init", { force, copyPiConfigs }, ({ force, copyPiConfigs }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(initHamilton({ force, copyPiConfigs }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Init failed: ${String(result.cause)}`)
      return
    }
    const installed = Exit.getOrElse(result, () => [] as string[])
    yield* Console.log("Hamilton initialized successfully.")
    yield* Console.log(`Installed ${installed.length} workflows.`)
    for (const id of installed) {
      yield* Console.log(`  ${id}`)
    }
  })
).pipe(Command.withDescription("Bootstrap Hamilton directories and install workflows"))