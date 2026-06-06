import { Effect, Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { workflowsDir } from "../../paths.js"

const PROJECT_ROOT = Path.resolve(import.meta.dirname, "..", "..", "..")

export class InstallError extends Data.TaggedError("InstallError")<{
  workflowId: string
  message: string
}> {}

function bundledWorkflowsDir(): string {
  return Path.join(PROJECT_ROOT, "workflows")
}

function listBundledWorkflowIds(): string[] {
  const dir = bundledWorkflowsDir()
  if (!Fs.existsSync(dir)) return []
  return Fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
}

export function installWorkflow(
  workflowId: string,
  options?: { force?: boolean }
): Effect.Effect<void, InstallError> {
  return Effect.gen(function* () {
    const srcDir = Path.join(bundledWorkflowsDir(), workflowId)
    const destDir = Path.join(workflowsDir(), workflowId)

    if (!Fs.existsSync(srcDir)) {
      return yield* Effect.fail(
        new InstallError({ workflowId, message: `Bundled workflow "${workflowId}" not found` })
      )
    }

    if (Fs.existsSync(destDir) && !options?.force) {
      return yield* Effect.fail(
        new InstallError({ workflowId, message: `Workflow "${workflowId}" already installed (use --force to overwrite)` })
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
        new InstallError({ workflowId, message: `Failed to install workflow "${workflowId}": ${String(e)}` })
    })
  })
}

export function uninstallWorkflow(
  workflowId: string
): Effect.Effect<void, InstallError> {
  return Effect.gen(function* () {
    const destDir = Path.join(workflowsDir(), workflowId)

    if (!Fs.existsSync(destDir)) {
      return yield* Effect.fail(
        new InstallError({ workflowId, message: `Workflow "${workflowId}" is not installed` })
      )
    }

    yield* Effect.try({
      try: () => Fs.rmSync(destDir, { recursive: true, force: true }),
      catch: (e) =>
        new InstallError({ workflowId, message: `Failed to uninstall workflow "${workflowId}": ${String(e)}` })
    })
  })
}

export function installAllWorkflows(
  options?: { force?: boolean }
): Effect.Effect<string[], InstallError> {
  return Effect.gen(function* () {
    const ids = listBundledWorkflowIds()
    const installed: string[] = []
    for (const id of ids) {
      yield* installWorkflow(id, options)
      installed.push(id)
    }
    return installed
  })
}