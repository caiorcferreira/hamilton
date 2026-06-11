import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { workflowsDir, hamiltonHome } from "../../paths.js"

const PROJECT_ROOT = Path.resolve(import.meta.dirname, "..", "..", "..")

export class InstallError extends Data.TaggedError("InstallError")<{
  workflowSlug: string
  message: string
}> {}

function bundledWorkflowsDir(): string {
  return Path.join(PROJECT_ROOT, "bundle", "workflows")
}

function listBundledWorkflowSlugs(): string[] {
  const dir = bundledWorkflowsDir()
  if (!Fs.existsSync(dir)) return []
  return Fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

export function installWorkflow(
  workflowSlug: string,
  options?: { force?: boolean }
): Effect.Effect<void, InstallError> {
  return Effect.gen(function* () {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* Effect.fail(
        new InstallError({ workflowSlug, message: 'Hamilton is not initialized. Run "hamilton init" first.' })
      )
    }

    const srcDir = Path.join(bundledWorkflowsDir(), workflowSlug)
    const destDir = Path.join(workflowsDir(), workflowSlug)

    if (!Fs.existsSync(srcDir)) {
      return yield* Effect.fail(
        new InstallError({ workflowSlug, message: `Bundled workflow "${workflowSlug}" not found` })
      )
    }

    if (Fs.existsSync(destDir) && !options?.force) {
      return yield* Effect.fail(
        new InstallError({ workflowSlug, message: `Workflow "${workflowSlug}" already installed (use --force to overwrite)` })
      )
    }

    yield* Effect.try({
      try: () => {
        Fs.mkdirSync(destDir, { recursive: true })
        const entries = Fs.readdirSync(srcDir, { withFileTypes: true })
        for (const entry of entries) {
          const srcPath = Path.join(srcDir, entry.name)
          const destPath = Path.join(destDir, entry.name)
          if (entry.isDirectory()) {
            Fs.cpSync(srcPath, destPath, { recursive: true, force: true })
          } else {
            Fs.copyFileSync(srcPath, destPath)
          }
        }
      },
      catch: (e) =>
        new InstallError({ workflowSlug, message: `Failed to install workflow "${workflowSlug}": ${String(e)}` })
    })

    
  })
}

export function uninstallWorkflow(
  workflowSlug: string
): Effect.Effect<void, InstallError> {
  return Effect.gen(function* () {
    if (!Fs.existsSync(hamiltonHome())) {
      return yield* Effect.fail(
        new InstallError({ workflowSlug, message: 'Hamilton is not initialized. Run "hamilton init" first.' })
      )
    }

    const destDir = Path.join(workflowsDir(), workflowSlug)

    if (!Fs.existsSync(destDir)) {
      return yield* Effect.fail(
        new InstallError({ workflowSlug, message: `Workflow "${workflowSlug}" is not installed` })
      )
    }

    yield* Effect.try({
      try: () => Fs.rmSync(destDir, { recursive: true, force: true }),
      catch: (e) =>
        new InstallError({ workflowSlug, message: `Failed to uninstall workflow "${workflowSlug}": ${String(e)}` })
    })
  })
}

export function installAllWorkflows(
  options?: { force?: boolean }
): Effect.Effect<string[], InstallError> {
  return Effect.gen(function* () {
    const slugs = listBundledWorkflowSlugs()
    const installed: string[] = []
    for (const slug of slugs) {
      yield* installWorkflow(slug, options)
      installed.push(slug)
    }
    return installed
  })
}