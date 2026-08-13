import { Command, Options } from "@effect/cli"
import { Console, Data, Effect, Exit } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"
import { ensureHamiltonHome, guidelinesDir, scriptsDir, settingsPath, templatesDir } from "../../paths.js"
import { resolveBundleRoot } from "../bundle-root.js"

export class SetupError extends Data.TaggedError("SetupError")<{
  message: string
}> {}

function copyGuidelineManifests(bundleRoot: string, options?: { force?: boolean }): Effect.Effect<void, SetupError> {
  return Effect.gen(function* () {
    const manifestDir = Path.join(bundleRoot, "guidelines")
    if (!Fs.existsSync(manifestDir)) return

    const destGuidelines = guidelinesDir()

    yield* Effect.try({
      try: () => Fs.cpSync(manifestDir, destGuidelines, { recursive: true, force: true }),
      catch: (e) =>
        new SetupError({ message: `Failed to copy guideline manifests: ${String(e)}` })
    })
  })
}

function copyTemplates(bundleRoot: string, options?: { force?: boolean }): Effect.Effect<string[], SetupError> {
  return Effect.gen(function* () {
    const srcDir = Path.join(bundleRoot, "templates")
    if (!Fs.existsSync(srcDir)) return []

    const destTemplates = templatesDir()

    yield* Effect.try({
      try: () => Fs.cpSync(srcDir, destTemplates, { recursive: true, force: true }),
      catch: (e) =>
        new SetupError({ message: `Failed to copy templates: ${String(e)}` })
    })

    return (Fs.readdirSync(destTemplates, { recursive: true }) as string[])
      .filter((name) => Fs.statSync(Path.join(destTemplates, name)).isFile())
      .map((name) => name.split(Path.sep).join("/"))
      .sort()
  })
}

function copyScripts(bundleRoot: string, options?: { force?: boolean }): Effect.Effect<string[], SetupError> {
  return Effect.gen(function* () {
    const srcDir = Path.join(bundleRoot, "scripts")
    if (!Fs.existsSync(srcDir)) return []

    const destScripts = scriptsDir()

    return yield* Effect.try({
      try: () => {
        Fs.cpSync(srcDir, destScripts, { recursive: true, force: true })

        const names = (Fs.readdirSync(destScripts, { recursive: true }) as string[])
          .filter((name) => Fs.statSync(Path.join(destScripts, name)).isFile())
          .map((name) => name.split(Path.sep).join("/"))
          .sort()

        // cpSync preserves whatever mode the checkout carried; the skills invoke
        // these directly, so make the executable bit unconditional.
        for (const name of names) {
          Fs.chmodSync(Path.join(destScripts, name), 0o755)
        }

        return names
      },
      catch: (e) => new SetupError({ message: `Failed to copy scripts: ${String(e)}` })
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

export interface SetupResult {
  templates: string[]
  scripts: string[]
}

export function setupHamilton(options?: { force?: boolean }): Effect.Effect<SetupResult, SetupError> {
  return Effect.gen(function* () {
    yield* Effect.try({
      try: () => ensureHamiltonHome(),
      catch: (e) =>
        new SetupError({ message: `Failed to create hamilton home directories: ${String(e)}` })
    })

    const bundleRoot = yield* Effect.try({
      try: () => resolveBundleRoot(),
      catch: (e) => new SetupError({ message: String(e) })
    })

    const templates = yield* copyTemplates(bundleRoot, options)
    const scripts = yield* copyScripts(bundleRoot, options)
    yield* copyGuidelineManifests(bundleRoot, options)
    yield* writeDefaultSettings()

    return { templates, scripts }
  })
}

const force = Options.boolean("force")

export const setupCommand = Command.make("setup", { force }, ({ force }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(setupHamilton({ force }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Setup failed: ${String(result.cause)}`)
      return
    }
    const { templates, scripts } = Exit.getOrElse(result, () => ({ templates: [], scripts: [] }) as SetupResult)
    yield* Console.log("Hamilton set up successfully.")
    yield* Console.log(`Installed ${templates.length} templates.`)
    for (const name of templates) {
      yield* Console.log(`  ${name}`)
    }
    yield* Console.log(`Installed ${scripts.length} scripts.`)
    for (const name of scripts) {
      yield* Console.log(`  ${name}`)
    }
  })
).pipe(Command.withDescription("Bootstrap Hamilton directories and install templates and scripts"))
