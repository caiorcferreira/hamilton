import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import {
  loadSkillRegistry,
  resolveSkills,
  SkillNameMismatchError,
  SkillMissingDescriptionError,
  DuplicateSkillError,
  SkillNotFoundError
} from "../../src/skills/registry.js"

describe("skill-registry", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-skill-registry-"))
  })

  afterEach(() => {
    Fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeSkill(
    skillDir: string,
    name: string,
    description: string,
    extra?: string
  ) {
    Fs.mkdirSync(skillDir, { recursive: true })
    const content = extra
      ? `---\nname: ${name}\ndescription: ${description}\n---\n${extra}`
      : `---\nname: ${name}\ndescription: ${description}\n---\n`
    Fs.writeFileSync(Path.join(skillDir, "SKILL.md"), content)
  }

  describe("loadSkillRegistry", () => {
    it("loads valid skills keyed by name", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      writeSkill(Path.join(skillsRoot, "coding"), "coding", "Write code")
      writeSkill(Path.join(skillsRoot, "review"), "review", "Review code")

      const registry = loadSkillRegistry(skillsRoot)

      expect(registry.size).toBe(2)
      expect(registry.get("coding")!.name).toBe("coding")
      expect(registry.get("coding")!.description).toBe("Write code")
      expect(registry.get("review")!.name).toBe("review")
    })

    it("returns empty map when skills dir does not exist", () => {
      const registry = loadSkillRegistry(Path.join(tmpDir, "nonexistent"))
      expect(registry.size).toBe(0)
    })

    it("throws SkillNameMismatchError when folder name != frontmatter name", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      writeSkill(Path.join(skillsRoot, "coding"), "debugging", "Debug things")

      expect(() => loadSkillRegistry(skillsRoot)).toThrow()
      try {
        loadSkillRegistry(skillsRoot)
      } catch (e) {
        expect(e).toBeInstanceOf(SkillNameMismatchError)
        expect((e as SkillNameMismatchError).dirName).toBe("coding")
        expect((e as SkillNameMismatchError).frontmatterName).toBe("debugging")
      }
    })

    it("throws SkillMissingDescriptionError when description is empty", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      const skillDir = Path.join(skillsRoot, "coding")
      Fs.mkdirSync(skillDir, { recursive: true })
      Fs.writeFileSync(Path.join(skillDir, "SKILL.md"), "---\nname: coding\ndescription:\n---\n")

      expect(() => loadSkillRegistry(skillsRoot)).toThrow()
      try {
        loadSkillRegistry(skillsRoot)
      } catch (e) {
        expect(e).toBeInstanceOf(SkillMissingDescriptionError)
      }
    })

    it("throws DuplicateSkillError when two dirs resolve to same name via mismatch-first validation", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      writeSkill(Path.join(skillsRoot, "coding"), "coding", "Write code A")
      const dupDir = Path.join(skillsRoot, "coding-copy")
      Fs.mkdirSync(dupDir, { recursive: true })
      Fs.writeFileSync(
        Path.join(dupDir, "SKILL.md"),
        "---\nname: coding\ndescription: Write code B\n---\n"
      )

      expect(() => loadSkillRegistry(skillsRoot)).toThrow()
      try {
        loadSkillRegistry(skillsRoot)
      } catch (e) {
        expect(e).toBeInstanceOf(SkillNameMismatchError)
      }
    })

    it("uses folder name when frontmatter name is omitted", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      const skillDir = Path.join(skillsRoot, "coding")
      Fs.mkdirSync(skillDir, { recursive: true })
      Fs.writeFileSync(Path.join(skillDir, "SKILL.md"), "---\ndescription: Write code\n---\n")

      const registry = loadSkillRegistry(skillsRoot)

      expect(registry.get("coding")!.name).toBe("coding")
    })

    it("skips directories without SKILL.md", () => {
      const skillsRoot = Path.join(tmpDir, "skills")
      Fs.mkdirSync(Path.join(skillsRoot, "no-skill-here"), { recursive: true })

      const registry = loadSkillRegistry(skillsRoot)
      expect(registry.size).toBe(0)
    })
  })

  describe("resolveSkills", () => {
    it("returns matching entries for declared skill names", () => {
      const registry = new Map([
        ["coding", { name: "coding", description: "Write code", filePath: "/a/SKILL.md", baseDir: "/a" }],
        ["review", { name: "review", description: "Review code", filePath: "/b/SKILL.md", baseDir: "/b" }]
      ]) as any

      const result = resolveSkills(["coding"], registry)
      expect(result!.length).toBe(1)
      expect(result![0].name).toBe("coding")
    })

    it("throws SkillNotFoundError with available names when skill not found", () => {
      const registry = new Map([
        ["coding", { name: "coding", description: "Write code", filePath: "/a/SKILL.md", baseDir: "/a" }]
      ]) as any

      expect(() => resolveSkills(["unknown"], registry)).toThrow()
      try {
        resolveSkills(["unknown"], registry)
      } catch (e) {
        expect(e).toBeInstanceOf(SkillNotFoundError)
        expect((e as SkillNotFoundError).name).toBe("unknown")
        expect((e as SkillNotFoundError).available).toEqual(["coding"])
      }
    })

    it("returns null when skills is null", () => {
      const registry = new Map()
      const result = resolveSkills(null, registry)
      expect(result).toBeNull()
    })

    it("returns null when skills is empty array", () => {
      const registry = new Map()
      const result = resolveSkills([], registry)
      expect(result).toBeNull()
    })
  })
})