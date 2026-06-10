import { Data } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"

export interface SkillEntry {
  name: string
  description: string
  filePath: string
  baseDir: string
}

export class SkillNameMismatchError extends Data.TaggedError("SkillNameMismatchError")<{
  dirName: string
  frontmatterName: string
  path: string
}> {}

export class SkillMissingDescriptionError extends Data.TaggedError("SkillMissingDescriptionError")<{
  path: string
}> {}

export class DuplicateSkillError extends Data.TaggedError("DuplicateSkillError")<{
  name: string
  paths: string[]
}> {}

export class SkillNotFoundError extends Data.TaggedError("SkillNotFoundError")<{
  name: string
  available: string[]
}> {}

interface RawSkill {
  dirName: string
  frontmatterName: string
  name: string
  description: string
  filePath: string
  baseDir: string
}

function parseFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!match) return null
  try {
    return Yaml.parse(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}

export function loadSkillRegistry(skillsDir: string): Map<string, SkillEntry> {
  if (!Fs.existsSync(skillsDir)) return new Map()

  let entries: Fs.Dirent[]
  try {
    entries = Fs.readdirSync(skillsDir, { withFileTypes: true })
  } catch {
    return new Map()
  }

  const raw: RawSkill[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const skillPath = Path.join(skillsDir, entry.name)
    const skillFile = Path.join(skillPath, "SKILL.md")
    if (!Fs.existsSync(skillFile)) continue

    const content = Fs.readFileSync(skillFile, "utf-8")
    const frontmatter = parseFrontmatter(content)

    const description = typeof frontmatter?.description === "string"
      ? frontmatter.description.trim()
      : ""

    if (!description) {
      throw new SkillMissingDescriptionError({ path: skillFile })
    }

    const frontmatterName = typeof frontmatter?.name === "string"
      ? frontmatter.name.trim()
      : ""
    const name = frontmatterName || entry.name

    raw.push({
      dirName: entry.name,
      frontmatterName,
      name,
      description,
      filePath: skillFile,
      baseDir: skillPath
    })
  }

  const seen = new Map<string, string[]>()
  for (const r of raw) {
    const existing = seen.get(r.name)
    if (existing) {
      throw new DuplicateSkillError({
        name: r.name,
        paths: [...existing, r.baseDir]
      })
    }
    seen.set(r.name, [r.baseDir])
  }

  for (const r of raw) {
    if (r.frontmatterName && r.frontmatterName !== r.dirName) {
      throw new SkillNameMismatchError({
        dirName: r.dirName,
        frontmatterName: r.frontmatterName,
        path: r.filePath
      })
    }
  }

  const registry = new Map<string, SkillEntry>()
  for (const r of raw) {
    registry.set(r.name, {
      name: r.name,
      description: r.description,
      filePath: r.filePath,
      baseDir: r.baseDir
    })
  }

  return registry
}

export function resolveSkills(
  agentSkills: string[] | null,
  registry: Map<string, SkillEntry>
): SkillEntry[] | null {
  if (!agentSkills || agentSkills.length === 0) return null

  const resolved: SkillEntry[] = []
  for (const name of agentSkills) {
    const entry = registry.get(name)
    if (!entry) {
      throw new SkillNotFoundError({
        name,
        available: Array.from(registry.keys())
      })
    }
    resolved.push(entry)
  }
  return resolved
}