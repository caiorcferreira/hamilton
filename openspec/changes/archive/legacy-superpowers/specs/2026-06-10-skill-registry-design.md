# Skill Registry Design

## Problem

Agent manifests declare `skills: ["hamilton-agents"]` in their YAML, but this field is a dead value. It flows from `agent.yml` through the agent registry, config resolution, and runner into `PiExecutorConfig.settings.skills: string[] | null`, where it is never consumed. Pi SDK's `DefaultResourceLoader` supports a `skillsOverride` callback that can inject or replace discovered skills, but Hamilton never wires it.

Agents currently get whatever skills Pi discovers from its default paths (`~/.pi/agent/skills/`, `~/.agents/skills/`, etc.) regardless of what they declare — or no skills at all.

## Goal

Hamilton should maintain a skill registry at `~/.hamilton/skills/`, load it once at startup, and wire agent-declared skill names to Pi's `skillsOverride` so each agent receives exactly the skills it asks for — nothing more, nothing less.

## Design

### Skill Registry

**Module:** `src/skills/registry.ts`

**Types:**

```typescript
interface SkillEntry {
  name: string
  description: string
  filePath: string
  baseDir: string
}
```

**Errors** (all `Data.TaggedError`):

| Error | Fields | When |
|-------|--------|------|
| `SkillNameMismatchError` | `dirName`, `frontmatterName`, `path` | Folder name != frontmatter `name` |
| `SkillMissingDescriptionError` | `path` | SKILL.md frontmatter has empty/missing `description` |
| `DuplicateSkillError` | `name`, `paths` | Two skills share the same name |
| `SkillNotFoundError` | `name`, `available` | Agent declares a skill not in the registry |

All errors are fatal. They bubble up and fail the workflow.

**`loadSkillRegistry(skillsDir: string): Map<string, SkillEntry>`**

Scans `skillsDir/*/SKILL.md`:
1. For each subdirectory containing `SKILL.md`, parse YAML frontmatter
2. Validate `description` is non-empty → else `SkillMissingDescriptionError`
3. Validate folder name == frontmatter `name` → else `SkillNameMismatchError`
4. Detect duplicate skill names → `DuplicateSkillError`
5. Return `Map<string, SkillEntry>` keyed by skill name

**`resolveSkills(agentSkills: string[] | null, registry: Map<string, SkillEntry>): SkillEntry[] | null`**

- If `agentSkills` is `null` or `[]`, return `null`
- Look up each declared skill name in the registry
- Throw `SkillNotFoundError` if any name is missing (includes `available` list of known names)
- Return matched `SkillEntry[]`

### Wiring into Runner and Pi Executor

**`runner.ts` changes:**

- Call `loadSkillRegistry(skillsDir())` once, before task execution loop
- After `resolveAgentDefaults()` (unchanged), call `resolveSkills(resolved.skills, registry)` to get `SkillEntry[] | null`
- Pass resolved `SkillEntry[]` to `executeWithPi` instead of the dead `string[]`

**`pi-executor.ts` changes:**

- `PiExecutorConfig.settings.skills` type changes from `string[] | null` to `SkillEntry[] | null`
- `resolveAgentDefaults` is unchanged — it has no involvement in skill resolution
- `DefaultResourceLoader` construction:
  - When `skills` is `null` or `[]`: pass `noSkills: true` only — suppresses all Pi default skill discovery
  - When `skills` is non-empty: pass `skillsOverride` callback that replaces discovered skills with the resolved entries (converting each `SkillEntry` to Pi's `Skill` type using `createSyntheticSourceInfo`). Do NOT pass `noSkills: true`.

### Init and Paths

**`src/paths.ts` changes:**

- Add `skillsDir()`: returns `Path.join(hamiltonHome(), "skills")`
- Add `skillsDir` to `ensureHamiltonHome()` directory list

**`manifest/skills/` directory:**

- Created empty (no bundled skills yet)
- Copied to `~/.hamilton/skills/` during `hamilton init`, same pattern as `manifest/agents/` → `~/.hamilton/agents/`

**`src/cli/commands/init.ts` changes:**

- Add `copySkillManifests()` that copies `manifest/skills/*` to `~/.hamilton/skills/`, mirroring `copySharedAgents()`

### Testing

**Test file:** `tests/skills/registry.test.ts`

Tests follow existing patterns: no mocks, real temp dirs, `vitest` globals imported explicitly.

| Test | Description |
|------|-------------|
| loadSkillRegistry — valid skills | Loads SKILL.md files, builds map keyed by name |
| loadSkillRegistry — name mismatch | Rejects folder name != frontmatter name → `SkillNameMismatchError` |
| loadSkillRegistry — missing description | Rejects empty description → `SkillMissingDescriptionError` |
| loadSkillRegistry — duplicate name | Detects duplicate skill names → `DuplicateSkillError` |
| resolveSkills — found | Returns matching entries for declared names |
| resolveSkills — not found | Throws `SkillNotFoundError`, lists available names |
| resolveSkills — null/empty | Returns `null` for null input, `null` for empty array |

Helper: `tempSkillsDir()` creates tmp dir, writes SKILL.md files, returns dir path + cleanup function.