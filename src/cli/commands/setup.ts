import { Command, Options } from "@effect/cli"
import { Console, Data, Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Readline from "node:readline"
import * as Yaml from "yaml"
import { ensureHamiltonHome, agentsDir, settingsPath, skillsDir, guidelinesDir, hooksDir, templatesDir, hamiltonHome, dbPath } from "../../paths.js"
import { piAgentDir } from "../../executors/pi/paths.js"
import { openDb } from "../../workflow/state.js"
import { installAllWorkflows } from "./install-logic.js"
import { runDoctorChecks } from "./doctor.js"
import { green, red } from "../formatting/colors.js"
import { createUserMemoryStore } from "../../memory/store.js"
import { ingestGuidelines } from "../../memory/guidelines.js"
import { loadAllGuidelines } from "../../guidelines/loader.js"
import { migrate } from "../../db/migrations.js"

const PROJECT_ROOT = Path.resolve(import.meta.dirname, "..", "..", "..")

export class SetupError extends Data.TaggedError("SetupError")<{
  message: string
}> {}

export type SetupMode = "assisted" | "autonomous" | "ambient"

export function parseModelAliasArgs(entries: string[]): Record<string, string> {
  const aliases: Record<string, string> = {}
  for (const entry of entries) {
    const eq = entry.indexOf("=")
    if (eq === -1) continue
    aliases[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return aliases
}

export function askModelAliases(): Effect.Effect<Record<string, string>, SetupError> {
  return Effect.gen(function* () {
    yield* Console.log("Configure model aliases (optional)")
    yield* Console.log("Aliases let you reference models by name in workflow YAMLs.")

    const rl = Readline.createInterface({ input: process.stdin, output: process.stdout })
    const question = (q: string): Effect.Effect<string, SetupError> =>
      Effect.tryPromise({
        try: () => new Promise<string>(resolve => rl.question(q, resolve)),
        catch: (e) => new SetupError({ message: `Failed to read input: ${String(e)}` })
      })

    const answer = (yield* question("Add a model alias? (y/n) ")).trim().toLowerCase()
    if (answer !== "y" && answer !== "yes") {
      rl.close()
      return {}
    }

    const aliases: Record<string, string> = {}
    while (true) {
      const name = (yield* question("  Alias name: ")).trim()
      if (!name) break
      const model = (yield* question("  Model ID: ")).trim()
      if (!model) break
      aliases[name] = model
      const again = (yield* question("  Add another? (y/n) ")).trim().toLowerCase()
      if (again !== "y" && again !== "yes") break
    }
    rl.close()
    return aliases
  })
}

function copySharedAgents(options?: { force?: boolean }): Effect.Effect<void, SetupError> {
  return Effect.gen(function* () {
    const sharedDir = Path.join(PROJECT_ROOT, "bundle", "agents")
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
          new SetupError({ message: `Failed to copy shared agent "${entry.name}": ${String(e)}` })
      })
    }
  })
}

function copySkillManifests(options?: { force?: boolean }): Effect.Effect<void, SetupError> {
  return Effect.gen(function* () {
    const manifestDir = Path.join(PROJECT_ROOT, "bundle", "skills")
    if (!Fs.existsSync(manifestDir)) return

    const destSkills = skillsDir()

    yield* Effect.try({
      try: () => Fs.cpSync(manifestDir, destSkills, { recursive: true, force: true }),
      catch: (e) =>
        new SetupError({ message: `Failed to copy skill manifests: ${String(e)}` })
    })
  })
}

function copyGuidelineManifests(options?: { force?: boolean }): Effect.Effect<void, SetupError> {
  return Effect.gen(function* () {
    const manifestDir = Path.join(PROJECT_ROOT, "bundle", "guidelines")
    if (!Fs.existsSync(manifestDir)) return

    const destGuidelines = guidelinesDir()

    yield* Effect.try({
      try: () => Fs.cpSync(manifestDir, destGuidelines, { recursive: true, force: true }),
      catch: (e) =>
        new SetupError({ message: `Failed to copy guideline manifests: ${String(e)}` })
    })
  })
}

function copyHooks(options?: { force?: boolean }): Effect.Effect<void, SetupError> {
  return Effect.gen(function* () {
    const srcDir = Path.join(PROJECT_ROOT, "bundle", "hooks")
    if (!Fs.existsSync(srcDir)) return

    const destHooks = hooksDir()

    yield* Effect.try({
      try: () => Fs.cpSync(srcDir, destHooks, { recursive: true, force: true }),
      catch: (e) =>
        new SetupError({ message: `Failed to copy hooks: ${String(e)}` })
    })
  })
}

function copyTemplates(options?: { force?: boolean }): Effect.Effect<void, SetupError> {
  return Effect.gen(function* () {
    const srcDir = Path.join(PROJECT_ROOT, "bundle", "templates")
    if (!Fs.existsSync(srcDir)) return

    const destTemplates = templatesDir()

    yield* Effect.try({
      try: () => Fs.cpSync(srcDir, destTemplates, { recursive: true, force: true }),
      catch: (e) =>
        new SetupError({ message: `Failed to copy templates: ${String(e)}` })
    })
  })
}

function createDefaultPiConfigs(options?: { force?: boolean }): Effect.Effect<void, SetupError> {
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
      catch: (e) => new SetupError({ message: `Failed to create default Pi configs: ${String(e)}` })
    })
  })
}

export function buildSettingsYaml(modelAliases?: Record<string, string>): string {
  const doc = new Yaml.Document()
  doc.contents = {
    extensions: [
      { name: "rtk", enabled: true },
      { name: "lsp", enabled: true },
      { name: "git", enabled: true }
    ],
    lsp: {
      servers: {
        biome: {
          command: ["biome", "lsp-proxy"],
          extensions: [".astro", ".css", ".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc", ".html", ".vue", ".mjs", ".mts", ".cjs", ".cts"]
        },
        ruff: {
          command: ["ruff", "server"],
          extensions: [".py", ".pyi"]
        },
        typescript: {
          command: ["typescript-language-server", "--stdio"],
          extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
        },
        python: {
          command: ["pylsp"],
          extensions: [".py", ".pyi"]
        },
        yaml: {
          command: ["yaml-language-server", "--stdio"],
          extensions: [".yaml", ".yml"]
        },
        go: {
          command: ["gopls", "serve"],
          extensions: [".go"]
        }
      }
    }
  } as any
  ;(doc.contents as any).telemetry = { disableStores: [] }
  ;(doc.contents as any).script = { maxOutputBytes: 65536 }
  if (modelAliases && Object.keys(modelAliases).length > 0) {
    ;(doc.contents as any).models = { aliases: modelAliases }
  }
  return String(doc)
}

function writeDefaultSettings(modelAliases?: Record<string, string>): Effect.Effect<void, SetupError> {
  return Effect.try({
    try: () => {
      const path = settingsPath()
      if (!Fs.existsSync(path)) {
        Fs.writeFileSync(path, buildSettingsYaml(modelAliases))
      }
    },
    catch: (e) => new SetupError({ message: `Failed to write settings: ${String(e)}` })
  })
}

function copyPiConfigsFromHome(): Effect.Effect<void, SetupError> {
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
        catch: (e) => new SetupError({ message: `Failed to copy ${file}: ${String(e)}` })
      })
    }
  })
}

export function setupHamilton(options?: { force?: boolean; copyPiConfigs?: boolean; modelAliases?: Record<string, string>; mode?: SetupMode }): Effect.Effect<string[], SetupError> {
  return Effect.gen(function* () {
    const mode = options?.mode ?? "autonomous"

    yield* Effect.try({
      try: () => ensureHamiltonHome(),
      catch: (e) =>
        new SetupError({ message: `Failed to create hamilton home directories: ${String(e)}` })
    })

    // Assisted mode is the minimal bootstrap the skill bundle needs: the shared
    // artifact templates that every skill reads from ~/.hamilton/templates/. It
    // skips the engine machinery (DB, agents, workflows, Pi configs, settings).
    if (mode === "assisted") {
      yield* copyTemplates(options)
      return []
    }

    const db = yield* Effect.mapError(openDb(), (e) =>
      new SetupError({ message: `Failed to open database: ${e.message}` })
    )
    yield* Effect.sync(() => db.close())

    yield* copySharedAgents(options)
    yield* copySkillManifests(options)
    yield* copyGuidelineManifests(options)
    yield* copyHooks(options)
    yield* copyTemplates(options)

    if (options?.copyPiConfigs) {
      yield* copyPiConfigsFromHome()
    }
    yield* createDefaultPiConfigs(options)
    yield* writeDefaultSettings(options?.modelAliases)

    const workflowSlugs = yield* Effect.mapError(installAllWorkflows({ force: true }), (e) =>
      new SetupError({ message: `Failed to install workflows: ${e.message}` })
    )

    return workflowSlugs
  })
}

export function ingestSetupGuidelines(): Effect.Effect<void, never, never> {
  return Effect.scoped(Effect.gen(function* (_) {
    const store = yield* _(
      Effect.tryPromise(() => createUserMemoryStore(hamiltonHome())).pipe(
        Effect.orElseSucceed(() => null)
      )
    )
    if (!store) {
      yield* _(Console.log("Skipping guideline ingestion \u2014 memory store unavailable. Ingestion will run on first workflow execution."))
      return
    }
    yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))

    const loadedGuidelines = yield* _(loadAllGuidelines(guidelinesDir()))

    const db = yield* _(
      Effect.sync(() => {
        const database = new Database(dbPath())
        migrate(database)
        return database
      }).pipe(
        Effect.orElseSucceed(() => null)
      )
    )
    if (!db) {
      yield* _(Console.log("Guideline ingestion failed \u2014 will retry on next workflow run."))
      return
    }
    yield* _(Effect.addFinalizer(() => Effect.sync(() => db.close())))

    const summary = yield* _(
      Effect.promise(async () => {
        return ingestGuidelines(store.writer, db, loadedGuidelines)
      }).pipe(
        Effect.orElseSucceed(() => undefined)
      )
    )

    if (summary) {
      yield* _(Console.log(`Guideline memory primed: ${summary.ingested} ingested, ${summary.skipped} unchanged`))
    } else {
      yield* _(Console.log("Guideline ingestion failed \u2014 will retry on next workflow run."))
    }
  }))
}

const force = Options.boolean("force")
const copyPiConfigs = Options.boolean("copy-pi-configs")
const modelAlias = Options.text("model-alias").pipe(Options.repeated)
const mode = Options.choice("mode", ["assisted", "autonomous", "ambient"] as const).pipe(
  Options.optional,
  Options.withDescription("Setup mode: assisted (skills only), autonomous, or ambient. Defaults to autonomous.")
)

export const setupCommand = Command.make("setup", { force, copyPiConfigs, modelAlias, mode }, ({ force, copyPiConfigs, modelAlias, mode }) =>
  Effect.gen(function* () {
    const selectedMode: SetupMode = mode._tag === "Some" ? mode.value : "autonomous"

    if (selectedMode === "ambient") {
      yield* Console.error("Setup mode 'ambient' is not supported yet. Use --mode assisted.")
      return
    }

    // Assisted mode: a lean setup for the skill bundle. No model-alias prompt,
    // no engine bootstrap — just create ~/.hamilton and install the templates.
    if (selectedMode === "assisted") {
      const result = yield* Effect.exit(setupHamilton({ force, mode: "assisted" }))
      if (Exit.isFailure(result)) {
        yield* Console.error(`Setup failed: ${String(result.cause)}`)
        return
      }
      yield* Console.log("Hamilton set up successfully (assisted mode).")
      yield* Console.log(`Artifact templates installed to ${templatesDir()}.`)
      return
    }

    const flagAliases = parseModelAliasArgs(modelAlias)
    const modelAliases = Object.keys(flagAliases).length > 0
      ? flagAliases
      : !Fs.existsSync(settingsPath())
        ? yield* askModelAliases()
        : undefined
    const result = yield* Effect.exit(setupHamilton({ force, copyPiConfigs, modelAliases }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Setup failed: ${String(result.cause)}`)
      return
    }
    const installed = Exit.getOrElse(result, () => [] as string[])
    yield* Console.log("Hamilton set up successfully.")
    yield* Console.log(`Installed ${installed.length} workflows.`)
    for (const id of installed) {
      yield* Console.log(`  ${id}`)
    }

    yield* Console.log("")
    yield* Console.log("Priming guideline memory...")
    yield* ingestSetupGuidelines()

    yield* Console.log("")
    yield* Console.log("Running prerequisite checks...")
    const checkResults = yield* runDoctorChecks()
    for (const r of checkResults) {
      const mark = r.pass ? green("  ✓") : red("  ✗")
      yield* Console.log(`${mark} ${r.name.padEnd(10)}  ${r.detail}`)
    }
  })
).pipe(Command.withDescription("Bootstrap Hamilton directories and install workflows"))