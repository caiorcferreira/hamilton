import { createStore, type QMDStore } from "@tobilu/qmd"
import { Database } from "bun:sqlite"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"
import { insertMemoryAtom, updateMemoryAtomStatus } from "./queries.js"

export interface MemoryAtom {
  id: string
  title: string
  kind: "canonical" | "correction" | "failure" | "fact" | "procedure" | "preference"
  scope: "project" | "user"
  confidence: number
  content: string
  tags: string[]
}

export interface NewMemoryAtom {
  id: string
  title: string
  kind: string
  scope: string
  content: string
  tags: string[]
  source_path: string
  source: string
}

export interface MemoryFilters {
  tags: string[]
  languages: string[]
  filePaths: string[]
}

export interface MemoryReader {
  retrieveRelevant(filters: MemoryFilters, limit: number): Promise<MemoryAtom[]>
  getAtom(id: string): Promise<MemoryAtom | null>
}

export interface MemoryWriter {
  writeAtom(atom: NewMemoryAtom, db: Database): Promise<{ id: string; path: string }>
  tombstone(id: string, db: Database): Promise<void>
  updateStatus(id: string, status: string, db: Database): Promise<void>
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

function buildFrontmatter(atom: NewMemoryAtom): string {
  const frontmatter: Record<string, unknown> = {
    id: atom.id,
    title: atom.title,
    kind: atom.kind,
    scope: atom.scope,
    source: atom.source,
    confidence: 1.0,
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    project_id: null,
    tags: atom.tags,
    demoted_at: null,
    tombstoned_at: null,
    contradicts: [],
  }
  if (atom.source_path) {
    frontmatter.source_path = atom.source_path
  }
  return `---\n${Yaml.stringify(frontmatter)}---\n\n${atom.content}`
}

function parseFrontmatter(raw: string): Record<string, unknown> | null {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return null
  try {
    return Yaml.parse(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}

function extractContent(raw: string): string {
  const match = raw.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n\n?([\s\S]*)$/)
  return match ? match[1] : raw
}

export async function createUserMemoryStore(hamiltonHome: string): Promise<{
  reader: MemoryReader
  writer: MemoryWriter
  close(): Promise<void>
}> {
  const dir = Path.join(hamiltonHome, "memory", "user")
  const dbPath = Path.join(dir, "qmd.db")
  const canonicalDir = Path.join(dir, "canonical")

  Fs.mkdirSync(dir, { recursive: true })
  Fs.mkdirSync(canonicalDir, { recursive: true })

  const store: QMDStore = await createStore({ dbPath })

  try {
    await store.addCollection("canonical", {
      path: canonicalDir,
    })
  } catch {}

  const reader: MemoryReader = {
    async retrieveRelevant(filters, limit) {
      const query = [...filters.tags, ...filters.languages, ...filters.filePaths].join(" ") || ""
      try {
        const results = await store.search({
          query,
          collections: ["canonical"],
          limit,
          minScore: 0.1,
        })
        if (!results || results.length === 0) return []
        return results.map((r) => ({
          id: r.docid ?? "",
          title: r.title ?? "",
          kind: "canonical" as const,
          scope: "user" as const,
          confidence: 1.0,
          content: r.body ?? r.bestChunk ?? "",
          tags: [],
        }))
      } catch {
        return []
      }
    },

    async getAtom(id) {
      try {
        const files = Fs.readdirSync(canonicalDir)
        const match = files.find((f) => f.endsWith(`-${id}.md`))
        if (!match) return null
        const filePath = Path.join(canonicalDir, match)
        const raw = Fs.readFileSync(filePath, "utf-8")
        const fm = parseFrontmatter(raw)
        if (!fm) return null
        const content = extractContent(raw)
        return {
          id: fm.id as string,
          title: fm.title as string,
          kind: (fm.kind as MemoryAtom["kind"]) ?? "canonical",
          scope: (fm.scope as MemoryAtom["scope"]) ?? "user",
          confidence: (fm.confidence as number) ?? 1.0,
          content,
          tags: (fm.tags as string[]) ?? [],
        }
      } catch {
        return null
      }
    },
  }

  const writer: MemoryWriter = {
    async writeAtom(atom, db) {
      const slug = slugify(atom.title)
      const relativePath = `canonical/${slug}-${atom.id}.md`
      const filePath = Path.join(dir, relativePath)

      const frontmatterContent = buildFrontmatter(atom)
      Fs.writeFileSync(filePath, frontmatterContent, "utf-8")

      try {
        await store.update({ collections: ["canonical"] })
      } catch {}

      try {
        await Promise.race([
          store.embed({ force: false, chunkStrategy: "auto" }),
          new Promise<void>((_, reject) => setTimeout(() => reject(new Error("embed timeout")), 5000)),
        ])
      } catch {}

      insertMemoryAtom(db, {
        id: atom.id,
        path: relativePath,
        kind: atom.kind,
        scope: atom.scope,
        confidence: 1.0,
        status: "active",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      return { id: atom.id, path: relativePath }
    },

    async tombstone(id, db) {
      updateMemoryAtomStatus(db, id, "tombstoned")
    },

    async updateStatus(id, status, db) {
      updateMemoryAtomStatus(db, id, status)
    },
  }

  return {
    reader,
    writer,
    async close() {
      await store.close()
    },
  }
}