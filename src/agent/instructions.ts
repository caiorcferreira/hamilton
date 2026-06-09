import { Effect } from "effect"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { instructionDir } from "../paths.js"

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".hamilton"])

function parseFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return null
  try {
    const frontmatter = Yaml.parse(match[1]) as Record<string, unknown>
    return { frontmatter, body: match[2] }
  } catch {
    return null
  }
}

function scanExtensions(cwd: string): string[] {
  const extensions = new Set<string>()
  try {
    const entries = Fs.readdirSync(cwd, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue
      if (entry.isDirectory()) {
        for (const ext of scanExtensions(Path.join(cwd, entry.name))) {
          extensions.add(ext)
        }
      } else if (entry.isFile()) {
        const ext = Path.extname(entry.name)
        if (ext) extensions.add(ext)
      }
    }
  } catch {
  }
  return Array.from(extensions)
}

export function loadInstructionFiles(cwd: string): Effect.Effect<Array<{name: string; content: string}>, never> {
  return Effect.sync(() => {
    const dir = instructionDir()
    if (!Fs.existsSync(dir)) return []

    const projectExtensions = new Set(scanExtensions(cwd))
    if (projectExtensions.size === 0) return []

    const results: Array<{name: string; content: string}> = []
    let entries: Fs.Dirent[]
    try {
      entries = Fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return []
    }

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue
      const filePath = Path.join(dir, entry.name)
      let raw: string
      try {
        raw = Fs.readFileSync(filePath, "utf-8")
      } catch {
        continue
      }
      const parsed = parseFrontmatter(raw)
      if (!parsed) continue

      const name = parsed.frontmatter.name as string | undefined
      const extensions = parsed.frontmatter.extensions as string[] | undefined
      if (!name || !Array.isArray(extensions)) continue

      const matches = extensions.some((ext) => projectExtensions.has(ext))
      if (matches) {
        results.push({ name, content: parsed.body })
      }
    }

    return results
  })
}
