import { Effect, Data } from "effect"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { parseManifest } from "../schemas.js"
import type { GuidelineSpec, LoadedGuideline, CompiledRule, GuidelineRule, GuidelineInstructionEntry } from "./types.js"

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".hamilton"])

export class GuidelineParseError extends Data.TaggedError("GuidelineParseError")<{
  guideline: string
  message: string
}> {}

export class GuidelineMissingFileError extends Data.TaggedError("GuidelineMissingFileError")<{
  guideline: string
  file: string
}> {}

export class GuidelineInvalidRegexError extends Data.TaggedError("GuidelineInvalidRegexError")<{
  guideline: string
  ruleName: string
  pattern: string
}> {}

function scanFiles(cwd: string, base: string = cwd): string[] {
  const files: string[] = []
  try {
    const entries = Fs.readdirSync(cwd, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
      if (entry.isDirectory()) {
        for (const f of scanFiles(Path.join(cwd, entry.name), base)) {
          files.push(f)
        }
      } else if (entry.isFile()) {
        files.push(Path.relative(base, Path.join(cwd, entry.name)))
      }
    }
  } catch {}
  return files
}

function entryMatches(entry: GuidelineInstructionEntry, projectFiles: string[]): boolean {
  for (const pattern of entry.matching) {
    const glob = new Bun.Glob(pattern)
    for (const file of projectFiles) {
      if (glob.match(file)) return true
    }
  }
  return false
}

function compileRules(rules: GuidelineRule[] | undefined, guidelineName: string): Effect.Effect<CompiledRule[] | null, GuidelineInvalidRegexError> {
  if (!rules || rules.length === 0) return Effect.succeed(null)

  return Effect.gen(function* (_) {
    const compiled: CompiledRule[] = []
    for (const rule of rules) {
      try {
        const compiledPattern = new RegExp(rule.pattern)
        compiled.push({ ...rule, compiledPattern })
      } catch {
        yield* _(Effect.logWarning(`Invalid regex in guideline "${guidelineName}" rule "${rule.name}": ${rule.pattern}`))
      }
    }
    return compiled.length > 0 ? compiled : null
  })
}

function loadSingleGuideline(
  baseDir: string,
  guidelineName: string,
  projectFiles: string[]
): Effect.Effect<LoadedGuideline | null, GuidelineParseError | GuidelineMissingFileError | GuidelineInvalidRegexError> {
  return Effect.gen(function* (_) {
    const dirPath = Path.join(baseDir, guidelineName)
    const ymlPath = Path.join(dirPath, "guideline.yml")

    if (!Fs.existsSync(ymlPath)) return null

    let raw: string
    try {
      raw = Fs.readFileSync(ymlPath, "utf-8")
    } catch {
      return null
    }

    let manifest: GuidelineSpec
    try {
      const parsed = Yaml.parse(raw)
      manifest = parseManifest(parsed) as GuidelineSpec
    } catch (e) {
      yield* _(Effect.logWarning(`Failed to parse guideline "${guidelineName}": ${String(e)}`))
      return null
    }

    let instructions: Array<{ name: string; content: string }> | null = null

    if (manifest.spec.instructions) {
      const files: Array<{ name: string; content: string }> = []
      for (const entry of manifest.spec.instructions) {
        if (!entryMatches(entry, projectFiles)) continue
        for (const file of entry.files) {
          const filePath = Path.join(dirPath, file)
          try {
            const content = Fs.readFileSync(filePath, "utf-8")
            files.push({ name: manifest.metadata.name, content })
          } catch {
            yield* _(Effect.logWarning(`Missing instruction file "${file}" in guideline "${guidelineName}"`))
          }
        }
      }
      if (files.length > 0) instructions = files
    }

    const rules = yield* _(compileRules(manifest.spec.rules, guidelineName))

    return { name: manifest.metadata.name, instructions, rules }
  })
}

export function loadGuidelines(
  baseDir: string,
  projectDir: string
): Effect.Effect<Array<LoadedGuideline>, never> {
  return Effect.gen(function* (_) {
    if (!Fs.existsSync(baseDir)) return []

    let entries: Fs.Dirent[]
    try {
      entries = Fs.readdirSync(baseDir, { withFileTypes: true })
    } catch {
      return []
    }

    const projectFiles = scanFiles(projectDir)

    const results: LoadedGuideline[] = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const loaded = yield* _(
        loadSingleGuideline(baseDir, entry.name, projectFiles).pipe(
          Effect.catchAll((e) => {
            return Effect.gen(function* (_) {
              yield* _(Effect.logWarning(`Skipping guideline "${entry.name}": ${e.message ?? String(e)}`))
              return null
            })
          })
        )
      )

      if (loaded) {
        results.push(loaded)
      }
    }

    return results
  })
}
