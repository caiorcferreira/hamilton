# Guidelines Refactor — Design Spec

**Date:** 2026-06-10
**Status:** Approved

## Motivation

The existing "instructions" feature loads markdown files from `~/.hamilton/instruction/` and injects them as agent workspace files based on project file extensions. The ROADMAP calls for extending it to support tool call interception rules (modeled after `pi-coding-preferences`), and the name "guidelines" better captures this broader scope — combining instructional content with behavioral guardrails.

## Architecture

```
~/.hamilton/guidelines/<name>/
  guideline.yml          K8S envelope manifest
  code-style.md          plain markdown, no frontmatter

src/
  guidelines/
    types.ts             GuidelineSpec, GuidelineRule, LoadedGuideline, RuleMatch
    loader.ts            reads guideline.yml, returns LoadedGuideline[]
    rule-engine.ts        evaluates rules against tool call input

  executors/pi/
    guideline-extension.ts  single tool_call listener, delegates to rule-engine

  (modified)
  prompts/builder.ts     consumes instruction files from guidelines
  prompts/types.ts       instructionFiles -> guidelineFiles
  workflow/runner.ts     calls loader, wires instructions + rules
  executors/pi/pi-executor.ts  accepts rules, registers extension
  paths.ts               instructionDir -> guidelinesDir
  schemas.ts             adds GuidelineSpecSchema
  cli/commands/init.ts   creates guidelines dir, copies from manifest
```

## Guideline Manifest

```yaml
apiVersion: dag.hamilton.io/v1alpha1
kind: Guideline
metadata:
  name: js-standards
spec:
  instructions:
    extensions: [".js", ".ts"]
    files:
    - code-style.md

  rules:
  - name: "no-npm"
    toolNames: ["bash"]
    target: "command"
    pattern: "^npm"
    reason: "Use pnpm in this repo."
```

- `apiVersion` / `kind` / `metadata.name` follow the existing K8S envelope convention.
- `spec.instructions` is optional — a guideline can be rules-only.
- `spec.rules` is optional — a guideline can be instructions-only.
- Extensions use dot-prefixed format (`".js"`) matching `path.extname()` output.
- Instruction markdown files are plain text (no frontmatter). Metadata lives in the manifest.

## Types

```typescript
interface GuidelineRule {
  name: string
  toolNames: string[]
  target: "command" | "path" | "input"
  pattern: string
  reason: string
}

interface CompiledRule extends GuidelineRule {
  compiledPattern: RegExp
}

interface GuidelineSpec {
  instructions?: {
    extensions: string[]
    files: string[]
  }
  rules?: GuidelineRule[]
}

interface LoadedGuideline {
  name: string
  instructions: Array<{ name: string; content: string }> | null
  rules: CompiledRule[] | null
}

interface RuleMatch {
  ruleName: string
  reason: string
  matchedValue: string
}
```

## Component Details

### Loader (`src/guidelines/loader.ts`)

`loadGuidelines(baseDir: string, projectDir: string): Effect<Array<LoadedGuideline>>`

1. Lists subdirectories of `~/.hamilton/guidelines/`
2. For each, reads `<dir>/guideline.yml`, validates envelope + GuidelineSpec schema
3. Scans the project directory for file extensions (`scanExtensions`, moved here from old `instructions.ts`)
4. Only loads instruction files from guidelines whose `extensions` overlap with project extensions; non-matching guidelines' instructions are skipped (but rules are always included)
5. For each matching instruction file in `spec.instructions.files`, reads markdown content relative to the guideline directory
6. Pre-compiles all regex patterns (`new RegExp(pattern)`) — stores compiled result; invalid regex triggers `GuidelineInvalidRegexError`
7. Returns flat `LoadedGuideline[]`

**Error handling** (all `Data.TaggedError`, non-fatal to the run):

| Error | Trigger | Action |
|-------|---------|--------|
| `GuidelineParseError` | Invalid YAML or schema mismatch | Log, skip guideline |
| `GuidelineMissingFileError` | Instruction file not found | Log, skip guideline |
| `GuidelineInvalidRegexError` | Invalid regex in `pattern` | Log, skip rule |

Missing `guideline.yml` in a subdirectory → skip silently.

### Rule Engine (`src/guidelines/rule-engine.ts`)

`evaluateToolCall(rules: CompiledRule[], toolName: string, toolInput: Record<string, unknown>): RuleMatch[]`

Pure function, no effects. Receives rules with pre-compiled regexes from the loader.

1. Filters rules whose `toolNames` array includes the current tool
2. For each rule, extracts the target value:
   - `"command"` → `toolInput.command`
   - `"path"` → `toolInput.filePath` || `toolInput.path`
   - `"input"` → `JSON.stringify(toolInput)`
3. Tests the extracted string against the pre-compiled regex
4. Returns `RuleMatch[]` for all matching rules

If the target key is absent from `toolInput`, the rule does not match.

### Guideline Extension (`src/executors/pi/guideline-extension.ts`)

`createGuidelineExtension(rules: CompiledRule[]): PiExtension`

Single `tool_call` event listener (following `pi-coding-preferences` pattern). One listener evaluates all rules:

1. On `tool_call` event, calls `evaluateToolCall(rules, toolName, toolInput)`
2. If no matches → tool call proceeds
3. If matches → `evt.preventDefault()` to block, then `evt.api.conversation.addMessage({ role: "system", content: reason })` for each match

Registered only when rules are present. If no guidelines have rules, the extension is not created.

### Runner Integration (`src/workflow/runner.ts`)

```
loadGuidelines(guidelinesDir, cwd) -- instructions[] --> buildAgentPrompt() --> agentsFilesOverride
                                   -- rules[]        --> executeWithPi(config) --> guideline extension
```

1. Load guidelines once per workflow run via `loadGuidelines(guidelinesDir, process.cwd())`
2. Collect instruction files from all loaded guidelines (flat array)
3. Pass to prompt builder → `BuiltPrompt.guidelineFiles` (renamed from `instructionFiles`)
4. Flatten all `CompiledRule[]` across guidelines, pass as `config.rules` to `executeWithPi()`
5. In `pi-executor.ts`, if `config.rules` is non-empty, create and register the guideline extension

### Activation Logic

- **Instruction files:** matched by extension. The runner scans the project for file extensions (existing `scanExtensions`), then loads instruction content only from guidelines whose `extensions` overlap with the project.
- **Rules:** always active. All rules from all installed guidelines are evaluated against every tool call, regardless of project file types.

## Change Inventory

**Delete:**
- `src/prompts/instructions.ts`
- `tests/prompts/instructions.test.ts`
- `docs/agent-instructions.md`

**New:**
- `src/guidelines/types.ts`
- `src/guidelines/loader.ts`
- `src/guidelines/rule-engine.ts`
- `src/executors/pi/guideline-extension.ts`
- `tests/guidelines/loader.test.ts`
- `tests/guidelines/rule-engine.test.ts`
- `tests/executors/pi/guideline-extension.test.ts`
- `manifest/guidelines/.gitkeep`

**Modify:**

| File | Change |
|------|--------|
| `src/paths.ts` | `instructionDir()` → `guidelinesDir()` |
| `src/schemas.ts` | Add `GuidelineSpecSchema` |
| `src/prompts/types.ts` | Rename `instructionFiles` → `guidelineFiles` |
| `src/prompts/builder.ts` | Rename field, consume guidelines |
| `src/workflow/runner.ts` | Call loader, wire instructions + rules |
| `src/executors/pi/pi-executor.ts` | Accept `config.rules`, create and register guideline extension when rules present |
| `src/cli/commands/init.ts` | Create guidelines dir, copy from manifest |

## Testing Strategy

### Loader tests
- Parses a valid `guideline.yml` and returns instructions + rules
- Skips directory without `guideline.yml`
- Skips invalid YAML with `GuidelineParseError`
- Skips missing instruction file with `GuidelineMissingFileError`
- Skips rule with invalid regex with `GuidelineInvalidRegexError`
- Returns empty array for empty guidelines directory

### Rule engine tests (pure function, no mocks needed)
- Matches `command` target correctly
- Matches `path` target correctly (both `filePath` and `path` keys)
- Matches `input` target correctly (JSON.stringify)
- No match when `toolName` not in `toolNames`
- No match when target key absent from input
- Multiple rules can match a single tool call
- Regex anchored patterns work as expected (`^npm` matches `npm install` but not `pnpm`)

### Guideline extension tests
- Blocks tool call when rule matches
- Injects reason as system message on match
- Multiple matches inject multiple system messages
- Does not block when no rules match
- No-op when rules array is empty

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single `tool_call` listener | Follows `pi-coding-preferences` pattern. Simpler than per-rule listeners. |
| No migration from old `instruction/` | Hard cut. The old feature was lightweight and primarily documentation-oriented. |
| File-based management (no CLI) | Users create YAML manually. Simple, consistent with how agents/personas work today. |
| Extensions dot-prefixed | Aligns with `path.extname()` output, fixing an existing mismatch in current instructions. |
| Rules always active | Security model: guardrails should not depend on project file types. |
| `guideline.yml` filename | Consistent with `workflow.yml` / `agent.yml` convention. |
