# Hamilton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Hamilton — a CLI workflow-based agentic execution engine that orchestrates Pi agents through YAML-defined workflows, using Effect-TS and @effect/workflow.

**Architecture:** Four-layer Effect-TS application: CLI parses commands, Workflow Engine compiles YAML into @effect/workflow activities, Agent layer wraps pi-agent-core sessions, Observability layer streams structured JSONL logs to `~/.hamilton/runs/<run-id>/`.

**Tech Stack:** TypeScript 5.x (ESM, Node >=22), effect, @effect/schema, @effect/workflow, @earendil-works/pi-agent-core, yaml, vitest + @effect/vitest

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "hamilton",
  "version": "0.1.0",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=22"
  },
  "bin": {
    "hamilton": "dist/cli/main.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@earendil-works/pi-agent-core": "0.78.1",
    "@effect/schema": "0.75.5",
    "@effect/workflow": "0.18.2",
    "effect": "3.21.3",
    "yaml": "2.4.5"
  },
  "devDependencies": {
    "@effect/vitest": "0.29.0",
    "@types/node": "22.16.0",
    "typescript": "5.9.3",
    "vitest": "4.1.8"
  }
}
```

- [ ] **Step 2: Run `npm install`**

```bash
npm install
```

Expected: installs all deps with pinned versions, no warnings from unknown packages.

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "exactOptionalPropertyTypes": false
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globals: false
  }
})
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.env
.env.*
*.key
*.pem
*.log
```

- [ ] **Step 6: Create placeholder src/index.ts**

```typescript
export const VERSION = "0.1.0"
```

- [ ] **Step 7: Run build to verify**

```bash
npm run build
```

Expected: builds without errors, `dist/index.js` exists.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/index.ts
git commit -m "chore: scaffold project with TypeScript + Effect-TS"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/types.ts`
- Create: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/types.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import type {
  WorkflowSpec,
  WorkflowAgent,
  WorkflowStep,
  AgentRole
} from "../src/types.js"

describe("types", () => {
  it("should exist as type-level exports", () => {
    const role: AgentRole = "analysis"
    expect(role).toBe("analysis")

    const agent: WorkflowAgent = {
      id: "test",
      role: "coding",
      workspace: { baseDir: "agents/test", files: {} }
    }
    expect(agent.id).toBe("test")

    const step: WorkflowStep = {
      id: "step1",
      agent: "test",
      input: "do something"
    }
    expect(step.agent).toBe("test")

    const spec: WorkflowSpec = {
      id: "test-wf",
      name: "Test",
      version: 1,
      agents: [agent],
      steps: [step]
    }
    expect(spec.id).toBe("test-wf")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/types.test.ts
```

Expected: FAIL — module `../src/types.js` cannot be found or has no exports.

- [ ] **Step 3: Create src/types.ts**

```typescript
export type AgentRole =
  | "analysis"
  | "coding"
  | "verification"
  | "testing"
  | "pr"
  | "scanning"

export interface WorkflowSpec {
  id: string
  name: string
  version: number
  description?: string
  polling?: WorkflowPolling
  agents: WorkflowAgent[]
  steps: WorkflowStep[]
  context?: Record<string, string>
  notifications?: unknown
  run?: unknown
}

export interface WorkflowPolling {
  model?: string
  timeoutSeconds?: number
}

export interface WorkflowAgent {
  id: string
  name?: string
  role: AgentRole
  description?: string
  model?: string
  pollingModel?: string
  timeoutSeconds?: number
  workspace: WorkflowAgentWorkspace
}

export interface WorkflowAgentWorkspace {
  baseDir: string
  skills?: string[]
  files: Record<string, string>
}

export interface WorkflowStep {
  id: string
  agent: string
  type?: "default" | "loop"
  loop?: LoopConfig
  input: string
  expects?: string
  max_retries?: number
  on_fail?: OnFailConfig
}

export interface LoopConfig {
  over: "stories"
  completion?: string
  fresh_session?: boolean
  verify_each?: boolean
  verify_step?: string
}

export interface OnFailConfig {
  escalate_to?: string
  retry_step?: string
  max_retries?: number
  on_exhausted?: OnExhaustedConfig
}

export interface OnExhaustedConfig {
  escalate_to?: string
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/types.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add shared types for workflows, agents, and steps"
```

---

### Task 3: Schema Validation

**Files:**
- Create: `src/schemas.ts`
- Create: `tests/schemas.test.ts`
- Create: `tests/fixtures/bug-fix.yml`

- [ ] **Step 1: Create test fixture**

Create `tests/fixtures/bug-fix.yml`:

```yaml
id: bug-fix
name: Bug Fix Workflow
version: 1
description: Triage, investigate, and fix bugs.
polling:
  model: default
  timeoutSeconds: 120
agents:
  - id: triager
    role: analysis
    workspace:
      baseDir: agents/triager
      files:
        AGENTS.md: agents/triager/AGENTS.md
steps:
  - id: triage
    agent: triager
    input: "Triage this bug: {{task}}"
    expects: "STATUS: done"
    max_retries: 4
    on_fail:
      escalate_to: human
```

- [ ] **Step 2: Write the failing test**

Create `tests/schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { WorkflowSpecSchema } from "../src/schemas.js"
import { Schema } from "@effect/schema"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"

const decode = Schema.decodeUnknownSync(WorkflowSpecSchema)

describe("WorkflowSpecSchema", () => {
  it("should parse a minimal valid workflow YAML", () => {
    const yaml = Fs.readFileSync(
      Path.join(import.meta.dirname, "fixtures", "bug-fix.yml"),
      "utf-8"
    )
    const raw = Yaml.parse(yaml)
    const spec = decode(raw)
    expect(spec.id).toBe("bug-fix")
    expect(spec.name).toBe("Bug Fix Workflow")
    expect(spec.version).toBe(1)
    expect(spec.agents).toHaveLength(1)
    expect(spec.steps).toHaveLength(1)
    expect(spec.agents[0].role).toBe("analysis")
    expect(spec.steps[0].max_retries).toBe(4)
  })

  it("should reject a workflow with no agents", () => {
    const raw = { id: "bad", name: "Bad", version: 1, agents: [], steps: [] }
    expect(() => decode(raw)).toThrow()
  })

  it("should reject an invalid agent role", () => {
    const raw = {
      id: "bad", name: "Bad", version: 1,
      agents: [{ id: "a", role: "invalid", workspace: { baseDir: "x", files: {} } }],
      steps: []
    }
    expect(() => decode(raw)).toThrow()
  })

  it("should reject a missing step agent reference", () => {
    const raw = {
      id: "bad", name: "Bad", version: 1,
      agents: [{ id: "a", role: "coding", workspace: { baseDir: "x", files: {} } }],
      steps: [{ id: "s1", agent: "b", input: "x" }]
    }
    expect(() => decode(raw)).toThrow()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

```bash
npx vitest run tests/schemas.test.ts
```

Expected: FAIL — `WorkflowSpecSchema` is not defined.

- [ ] **Step 4: Create src/schemas.ts**

```typescript
import { Schema } from "@effect/schema"

const AgentRoleSchema = Schema.Literal(
  "analysis",
  "coding",
  "verification",
  "testing",
  "pr",
  "scanning"
)

const WorkflowAgentWorkspaceSchema = Schema.Struct({
  baseDir: Schema.String,
  skills: Schema.optional(Schema.Array(Schema.String)),
  files: Schema.Record({ key: Schema.String, value: Schema.String })
})

const WorkflowAgentSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  role: AgentRoleSchema,
  description: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  pollingModel: Schema.optional(Schema.String),
  timeoutSeconds: Schema.optional(Schema.Number),
  workspace: WorkflowAgentWorkspaceSchema
})

const LoopConfigSchema = Schema.Struct({
  over: Schema.Literal("stories"),
  completion: Schema.optional(Schema.String),
  fresh_session: Schema.optional(Schema.Boolean),
  verify_each: Schema.optional(Schema.Boolean),
  verify_step: Schema.optional(Schema.String)
})

const OnExhaustedConfigSchema = Schema.Struct({
  escalate_to: Schema.optional(Schema.String)
})

const OnFailConfigSchema = Schema.Struct({
  escalate_to: Schema.optional(Schema.String),
  retry_step: Schema.optional(Schema.String),
  max_retries: Schema.optional(Schema.Number),
  on_exhausted: Schema.optional(OnExhaustedConfigSchema)
})

const WorkflowStepSchema = Schema.Struct({
  id: Schema.String,
  agent: Schema.String,
  type: Schema.optional(Schema.Literal("default", "loop")),
  loop: Schema.optional(LoopConfigSchema),
  input: Schema.String,
  expects: Schema.optional(Schema.String),
  max_retries: Schema.optional(Schema.Number),
  on_fail: Schema.optional(OnFailConfigSchema)
})

const WorkflowPollingSchema = Schema.Struct({
  model: Schema.optional(Schema.String),
  timeoutSeconds: Schema.optional(Schema.Number)
})

export const WorkflowSpecSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.Number,
  description: Schema.optional(Schema.String),
  polling: Schema.optional(WorkflowPollingSchema),
  agents: Schema.Array(WorkflowAgentSchema).pipe(
    Schema.minItems(1)
  ),
  steps: Schema.Array(WorkflowStepSchema).pipe(
    Schema.minItems(1)
  ),
  context: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.String })
  ),
  notifications: Schema.optional(Schema.Unknown),
  run: Schema.optional(Schema.Unknown)
}).pipe(
  Schema.filter(
    (spec) => {
      const agentIds = new Set(spec.agents.map((a) => a.id))
      return spec.steps.every((s) => agentIds.has(s.agent))
    },
    { message: () => "every step.agent must reference a defined agent id" }
  )
)

export const WorkflowSpec = WorkflowSpecSchema
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/schemas.ts tests/schemas.test.ts tests/fixtures/bug-fix.yml
git commit -m "feat: add @effect/schema validation for workflow YAML"
```

---

### Task 4: Path Resolution

**Files:**
- Create: `src/paths.ts`
- Create: `tests/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/paths.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Os from "node:os"
import * as Path from "node:path"
import {
  hamiltonHome,
  workflowsDir,
  agentsDir,
  runsDir,
  runDir,
  stepOutputsDir,
  stepLogsDir,
  stepLogFile,
  stepOutputFile,
  inputFile,
  summaryFile
} from "../src/paths.js"

describe("paths", () => {
  const origHome = process.env.HOME
  const testHome = Path.join(Os.tmpdir(), "hamilton-test-paths-" + Date.now())

  beforeEach(() => {
    process.env.HOME = testHome
  })

  afterEach(() => {
    process.env.HOME = origHome
  })

  it("hamiltonHome returns ~/.hamilton", () => {
    expect(hamiltonHome()).toBe(Path.join(testHome, ".hamilton"))
  })

  it("workflowsDir returns ~/.hamilton/workflows", () => {
    expect(workflowsDir()).toBe(Path.join(testHome, ".hamilton", "workflows"))
  })

  it("agentsDir returns ~/.hamilton/agents", () => {
    expect(agentsDir()).toBe(Path.join(testHome, ".hamilton", "agents"))
  })

  it("runsDir returns ~/.hamilton/runs", () => {
    expect(runsDir()).toBe(Path.join(testHome, ".hamilton", "runs"))
  })

  it("runDir returns ~/.hamilton/runs/<id>", () => {
    expect(runDir("abc123")).toBe(Path.join(testHome, ".hamilton", "runs", "abc123"))
  })

  it("stepOutputsDir returns correct path", () => {
    expect(stepOutputsDir("abc123")).toBe(
      Path.join(testHome, ".hamilton", "runs", "abc123", "step-outputs")
    )
  })

  it("stepLogsDir returns correct path", () => {
    expect(stepLogsDir("abc123")).toBe(
      Path.join(testHome, ".hamilton", "runs", "abc123", "logs")
    )
  })

  it("stepLogFile returns correct path", () => {
    expect(stepLogFile("abc123", "triage")).toBe(
      Path.join(testHome, ".hamilton", "runs", "abc123", "logs", "triage.jsonl")
    )
  })

  it("stepOutputFile returns correct path", () => {
    expect(stepOutputFile("abc123", "triage")).toBe(
      Path.join(testHome, ".hamilton", "runs", "abc123", "step-outputs", "triage.json")
    )
  })

  it("inputFile returns correct path", () => {
    expect(inputFile("abc123")).toBe(
      Path.join(testHome, ".hamilton", "runs", "abc123", "input.json")
    )
  })

  it("summaryFile returns correct path", () => {
    expect(summaryFile("abc123")).toBe(
      Path.join(testHome, ".hamilton", "runs", "abc123", "summary.json")
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/paths.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/paths.ts**

```typescript
import * as Path from "node:path"
import * as Os from "node:os"

export function hamiltonHome(): string {
  const home = process.env.HOME ?? Os.homedir()
  return Path.join(home, ".hamilton")
}

export function workflowsDir(): string {
  return Path.join(hamiltonHome(), "workflows")
}

export function agentsDir(): string {
  return Path.join(hamiltonHome(), "agents")
}

export function runsDir(): string {
  return Path.join(hamiltonHome(), "runs")
}

export function runDir(runId: string): string {
  return Path.join(runsDir(), runId)
}

export function stepOutputsDir(runId: string): string {
  return Path.join(runDir(runId), "step-outputs")
}

export function stepLogsDir(runId: string): string {
  return Path.join(runDir(runId), "logs")
}

export function stepLogFile(runId: string, stepId: string): string {
  return Path.join(stepLogsDir(runId), `${stepId}.jsonl`)
}

export function stepOutputFile(runId: string, stepId: string): string {
  return Path.join(stepOutputsDir(runId), `${stepId}.json`)
}

export function inputFile(runId: string): string {
  return Path.join(runDir(runId), "input.json")
}

export function summaryFile(runId: string): string {
  return Path.join(runDir(runId), "summary.json")
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/paths.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/paths.ts tests/paths.test.ts
git commit -m "feat: add path resolution for ~/.hamilton directory layout"
```

---

### Task 5: Workflow YAML Loader

**Files:**
- Create: `src/workflow/loader.ts`
- Create: `tests/workflow/loader.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/workflow/loader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { loadWorkflowSpec } from "../../src/workflow/loader.js"
import { Effect, Exit } from "effect"

describe("loadWorkflowSpec", () => {
  let testDir: string

  beforeEach(() => {
    testDir = Path.join(Os.tmpdir(), "hamilton-test-loader-" + Date.now())
    Fs.mkdirSync(Path.join(testDir, "bug-fix"), { recursive: true })
    Fs.writeFileSync(
      Path.join(testDir, "bug-fix", "workflow.yml"),
      `id: bug-fix\nname: Bug Fix\nversion: 1\nagents:\n  - id: triager\n    role: analysis\n    workspace:\n      baseDir: agents/triager\n      files: {}\nsteps:\n  - id: triage\n    agent: triager\n    input: "do {{task}}"\n`
    )
  })

  afterEach(() => {
    Fs.rmSync(testDir, { recursive: true, force: true })
  })

  it("should load and validate a valid workflow YAML", async () => {
    const result = await Effect.runPromiseExit(
      loadWorkflowSpec(testDir, "bug-fix")
    )
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.id).toBe("bug-fix")
      expect(result.value.name).toBe("Bug Fix")
    }
  })

  it("should fail when workflow directory does not exist", async () => {
    const result = await Effect.runPromiseExit(
      loadWorkflowSpec(testDir, "nonexistent")
    )
    expect(Exit.isFailure(result)).toBe(true)
  })

  it("should fail when workflow.yml has invalid YAML", async () => {
    Fs.writeFileSync(
      Path.join(testDir, "bad", "workflow.yml"),
      `id: bad\nagents: [not-an-object]\n`
    )
    const result = await Effect.runPromiseExit(
      loadWorkflowSpec(testDir, "bad")
    )
    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/workflow/loader.test.ts
```

Expected: FAIL — `loadWorkflowSpec` is not defined.

- [ ] **Step 3: Create src/workflow/loader.ts**

```typescript
import { Effect } from "effect"
import { Schema, ParseResult } from "@effect/schema"
import * as Yaml from "yaml"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { WorkflowSpecSchema } from "../schemas.js"
import type { WorkflowSpec } from "../types.js"

class WorkflowNotFoundError extends Schema.TaggedError<WorkflowNotFoundError>(
  "WorkflowNotFoundError"
)("WorkflowNotFoundError", {
  workflowId: Schema.String,
  dir: Schema.String
}) {}

class WorkflowParseError extends Schema.TaggedError<WorkflowParseError>(
  "WorkflowParseError"
)("WorkflowParseError", {
  workflowId: Schema.String,
  message: Schema.String
}) {}

export function loadWorkflowSpec(
  workflowsDir: string,
  workflowId: string
): Effect.Effect<WorkflowSpec, WorkflowNotFoundError | WorkflowParseError> {
  return Effect.gen(function* () {
    const dir = Path.join(workflowsDir, workflowId)
    const ymlPath = Path.join(dir, "workflow.yml")

    const exists = yield* Effect.try({
      try: () => Fs.existsSync(ymlPath),
      catch: () =>
        new WorkflowNotFoundError({ workflowId, dir })
    })

    if (!exists) {
      return yield* Effect.fail(
        new WorkflowNotFoundError({ workflowId, dir })
      )
    }

    const content = yield* Effect.try({
      try: () => Fs.readFileSync(ymlPath, "utf-8"),
      catch: (e) =>
        new WorkflowParseError({
          workflowId,
          message: `Failed to read file: ${String(e)}`
        })
    })

    const raw = yield* Effect.try({
      try: () => Yaml.parse(content),
      catch: (e) =>
        new WorkflowParseError({
          workflowId,
          message: `Invalid YAML: ${String(e)}`
        })
    })

    if (raw === null || raw === undefined || typeof raw !== "object") {
      return yield* Effect.fail(
        new WorkflowParseError({
          workflowId,
          message: "YAML must contain a mapping"
        })
      )
    }

    return yield* Effect.try({
      try: () => Schema.decodeUnknownSync(WorkflowSpecSchema)(raw),
      catch: (e) => {
        const msg = ParseResult.isParseError(e)
          ? ParseResult.TreeFormatter.formatError(e)
          : String(e)
        return new WorkflowParseError({ workflowId, message: msg })
      }
    })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/workflow/loader.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/loader.ts tests/workflow/loader.test.ts
git commit -m "feat: add workflow YAML loader with schema validation"
```

---

### Task 6: Variant Resolution

**Files:**
- Create: `src/workflow/resolver.ts`
- Create: `tests/workflow/resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/workflow/resolver.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { resolveWorkflowId } from "../../src/workflow/resolver.js"

describe("resolveWorkflowId", () => {
  it("returns exact match when workflow exists", () => {
    const available = new Set(["bug-fix", "feature-dev", "do-now"])
    expect(resolveWorkflowId("bug-fix", available)).toBe("bug-fix")
    expect(resolveWorkflowId("feature-dev", available)).toBe("feature-dev")
  })

  it("resolves -merge-worktree variant (most specific try first)", () => {
    const available = new Set([
      "feature-dev-merge-worktree",
      "feature-dev-merge",
      "feature-dev-worktree",
      "feature-dev",
      "bug-fix-merge-worktree",
      "bug-fix",
      "bug-fix-merge",
      "bug-fix-worktree"
    ])

    // -merge-worktree exists, use it
    expect(resolveWorkflowId("feature-dev--merge-worktree", available))
      .toBe("feature-dev-merge-worktree")

    // Falls back to -merge
    expect(resolveWorkflowId("bug-fix--merge-worktree", available))
      .toBe("bug-fix-merge")
  })

  it("resolves -github-pr variant", () => {
    const available = new Set(["bug-fix-github-pr", "bug-fix"])
    expect(resolveWorkflowId("bug-fix--github-pr", available))
      .toBe("bug-fix-github-pr")
  })

  it("falls back to base workflow when variant not available", () => {
    const available = new Set(["do-now"])
    expect(resolveWorkflowId("do-now--merge", available)).toBe("do-now")
  })

  it("returns exact id unchanged when no -- in the id", () => {
    const available = new Set(["do-now", "just-do-it"])
    expect(resolveWorkflowId("do-now", available)).toBe("do-now")
  })

  it("returns original id when not found and no fallback exists", () => {
    const available = new Set<string>()
    expect(resolveWorkflowId("missing--worktree", available))
      .toBe("missing--worktree")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/workflow/resolver.test.ts
```

Expected: FAIL — `resolveWorkflowId` is not defined.

- [ ] **Step 3: Create src/workflow/resolver.ts**

```typescript
const MERGE_VARIANTS = [
  ["-merge-worktree", "--merge-worktree"],
  ["-github-pr", "--github-pr"],
  ["-merge", "--merge"],
  ["-worktree", "--worktree"]
]

export function resolveWorkflowId(
  input: string,
  available: ReadonlySet<string>
): string {
  if (available.has(input)) {
    return input
  }

  const doubleDash = input.lastIndexOf("--")
  if (doubleDash === -1) {
    return input
  }

  const base = input.substring(0, doubleDash)
  const suffix = input.substring(doubleDash)

  for (const [short, long] of MERGE_VARIANTS) {
    if (suffix === long) {
      const candidate = base + short
      if (available.has(candidate)) return candidate
      break
    }
    if (suffix === short) {
      if (available.has(input)) return input
      break
    }
  }

  // Fallback: try available variants in order
  const suffixParts = suffix.replace(/^--?/, "")
  const variantOrder = ["merge-worktree", "github-pr", "merge", "worktree"]

  const parts = suffixParts.split("-")
  const requested = parts.filter((p) => variantOrder.includes(p))

  for (const variant of variantOrder) {
    if (requested.includes(variant)) {
      const candidate = `${base}-${variant}`
      if (available.has(candidate)) return candidate
    }
  }

  // final fallback to base workflow
  if (available.has(base)) return base

  return input
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/workflow/resolver.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/resolver.ts tests/workflow/resolver.test.ts
git commit -m "feat: add workflow variant resolution (-merge, -worktree, -github-pr)"
```

---

### Task 7: Context Resolution

**Files:**
- Create: `src/workflow/context.ts`
- Create: `tests/workflow/context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/workflow/context.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { resolveTemplate, mergeContext, parseStoriesJson } from "../../src/workflow/context.js"

describe("resolveTemplate", () => {
  it("replaces {{key}} with context value", () => {
    expect(resolveTemplate("Hello {{name}}", { name: "World" }))
      .toBe("Hello World")
  })

  it("replaces multiple templates", () => {
    expect(
      resolveTemplate("Repo: {{repo}}, Branch: {{branch}}", {
        repo: "my-org/my-app",
        branch: "fix-bug"
      })
    ).toBe("Repo: my-org/my-app, Branch: fix-bug")
  })

  it("keeps unreplaced templates intact", () => {
    expect(resolveTemplate("{{missing}}", {})).toBe("{{missing}}")
  })

  it("handles empty input", () => {
    expect(resolveTemplate("", {})).toBe("")
  })

  it("handles context values with special regex chars", () => {
    expect(resolveTemplate("{{url}}", { url: "https://example.com?x=1&y=2" }))
      .toBe("https://example.com?x=1&y=2")
  })

  it("does not replace partial matches", () => {
    expect(resolveTemplate("{{{foo}}", { foo: "bar" })).toBe("{{{foo}}")
  })
})

describe("mergeContext", () => {
  it("merges new values into existing context", () => {
    const ctx = { a: "1" }
    const result = mergeContext(ctx, { b: "2", c: "3" })
    expect(result.a).toBe("1")
    expect(result.b).toBe("2")
    expect(result.c).toBe("3")
  })

  it("overwrites existing values", () => {
    const result = mergeContext({ a: "old" }, { a: "new" })
    expect(result.a).toBe("new")
  })

  it("does not mutate original context", () => {
    const original = { a: "1" }
    const result = mergeContext(original, { b: "2" })
    expect(result).not.toBe(original)
    expect(original.b).toBeUndefined()
  })
})

describe("parseStoriesJson", () => {
  it("parses valid STORIES_JSON", () => {
    const json = JSON.stringify([
      { id: "US-001", title: "Login", description: "Add login", acceptanceCriteria: ["User can log in"] }
    ])
    const stories = parseStoriesJson(json)
    expect(stories).toHaveLength(1)
    expect(stories[0].id).toBe("US-001")
  })

  it("returns empty array for invalid JSON", () => {
    expect(parseStoriesJson("not json")).toEqual([])
  })

  it("returns empty array for non-array JSON", () => {
    expect(parseStoriesJson('{"key": "value"}')).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/workflow/context.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/workflow/context.ts**

```typescript
export function resolveTemplate(
  template: string,
  context: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return key in context ? context[key] : _match
  })
}

export function mergeContext(
  existing: Record<string, string>,
  incoming: Record<string, string>
): Record<string, string> {
  return { ...existing, ...incoming }
}

export interface Story {
  id: string
  title: string
  description: string
  acceptanceCriteria: string[]
}

export function parseStoriesJson(json: string): Story[] {
  try {
    const parsed = JSON.parse(json)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (s): s is Story =>
          typeof s === "object" &&
          s !== null &&
          typeof s.id === "string" &&
          typeof s.title === "string"
      )
    }
    return []
  } catch {
    return []
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/workflow/context.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/context.ts tests/workflow/context.test.ts
git commit -m "feat: add template resolution and context management"
```

---

### Task 8: Agent Persona Loader

**Files:**
- Create: `src/agent/persona.ts`
- Create: `tests/agent/persona.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/persona.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { loadPersona } from "../../src/agent/persona.js"
import { Effect, Exit } from "effect"

describe("loadPersona", () => {
  let testDir: string

  beforeEach(() => {
    testDir = Path.join(Os.tmpdir(), "hamilton-test-persona-" + Date.now())
    const agentDir = Path.join(testDir, "agents", "shared", "setup")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(
      Path.join(agentDir, "AGENTS.md"),
      "# Setup Agent\nCreate branches and establish baselines."
    )
    Fs.writeFileSync(
      Path.join(agentDir, "IDENTITY.md"),
      "Name: Setup\nRole: Creates branches"
    )
    Fs.writeFileSync(
      Path.join(agentDir, "SOUL.md"),
      "Practical and systematic."
    )
  })

  afterEach(() => {
    Fs.rmSync(testDir, { recursive: true, force: true })
  })

  it("loads AGENTS.md, IDENTITY.md, and SOUL.md", async () => {
    const result = await Effect.runPromiseExit(
      loadPersona(Path.join(testDir, "agents", "shared", "setup"))
    )
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.agents).toContain("Create branches and establish baselines")
      expect(result.value.identity).toContain("Name: Setup")
      expect(result.value.soul).toContain("Practical and systematic")
    }
  })

  it("fails when directory does not exist", async () => {
    const result = await Effect.runPromiseExit(
      loadPersona(Path.join(testDir, "nonexistent"))
    )
    expect(Exit.isFailure(result)).toBe(true)
  })

  it("uses empty strings for missing optional files", async () => {
    const dir = Path.join(testDir, "minimal")
    Fs.mkdirSync(dir, { recursive: true })
    Fs.writeFileSync(Path.join(dir, "AGENTS.md"), "Just instructions")
    // No IDENTITY.md or SOUL.md

    const result = await Effect.runPromiseExit(loadPersona(dir))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.agents).toBe("Just instructions")
      expect(result.value.identity).toBe("")
      expect(result.value.soul).toBe("")
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agent/persona.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/agent/persona.ts**

```typescript
import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"

export interface Persona {
  agents: string
  identity: string
  soul: string
}

export class PersonaLoadError extends Effect.TaggedError("PersonaLoadError")<{
  dir: string
  message: string
}>() {}

function readIfExists(filePath: string): string {
  try {
    return Fs.readFileSync(filePath, "utf-8").trim()
  } catch {
    return ""
  }
}

export function loadPersona(dir: string): Effect.Effect<Persona, PersonaLoadError> {
  return Effect.gen(function* () {
    const exists = yield* Effect.try({
      try: () => Fs.existsSync(dir),
      catch: (e) =>
        new PersonaLoadError({ dir, message: `Failed to check directory: ${String(e)}` })
    })

    if (!exists) {
      return yield* Effect.fail(
        new PersonaLoadError({ dir, message: `Directory does not exist: ${dir}` })
      )
    }

    const agents = yield* Effect.try({
      try: () => Fs.readFileSync(Path.join(dir, "AGENTS.md"), "utf-8").trim(),
      catch: (e) =>
        new PersonaLoadError({ dir, message: `Failed to read AGENTS.md: ${String(e)}` })
    })

    const identity = readIfExists(Path.join(dir, "IDENTITY.md"))
    const soul = readIfExists(Path.join(dir, "SOUL.md"))

    return { agents, identity, soul }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/agent/persona.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/persona.ts tests/agent/persona.test.ts
git commit -m "feat: add agent persona loader (AGENTS.md, IDENTITY.md, SOUL.md)"
```

---

### Task 9: Run Directory Management

**Files:**
- Create: `src/observability/run-dir.ts`
- Create: `tests/observability/run-dir.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/observability/run-dir.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { createRunDir, writeInput, writeStepOutput, appendStepLog, writeSummary } from "../../src/observability/run-dir.js"
import { Effect, Exit } from "effect"
import { hamiltonHome, runDir } from "../../src/paths.js"

describe("run-dir", () => {
  const origHome = process.env.HOME
  const testHome = Path.join(Os.tmpdir(), "hamilton-test-rundir-" + Date.now())
  const runId = "run-001"

  beforeEach(() => {
    process.env.HOME = testHome
    Fs.rmSync(hamiltonHome(), { recursive: true, force: true })
  })

  afterEach(() => {
    process.env.HOME = origHome
  })

  it("createRunDir creates the full directory tree", async () => {
    const result = await Effect.runPromiseExit(createRunDir(runId))
    expect(Exit.isSuccess(result)).toBe(true)

    const exists = Fs.existsSync(runDir(runId))
    expect(exists).toBe(true)

    const dirs = ["step-outputs", "logs"]
    for (const d of dirs) {
      expect(Fs.existsSync(Path.join(runDir(runId), d))).toBe(true)
    }
  })

  it("writeInput writes input.json", async () => {
    await Effect.runPromise(createRunDir(runId))
    const input = { task: "fix login", context: { repo: "my-app" } }
    const result = await Effect.runPromiseExit(writeInput(runId, input))
    expect(Exit.isSuccess(result)).toBe(true)

    const content = Fs.readFileSync(
      Path.join(runDir(runId), "input.json"),
      "utf-8"
    )
    const parsed = JSON.parse(content)
    expect(parsed).toEqual(input)
  })

  it("writeStepOutput writes step-outputs/<step>.json", async () => {
    await Effect.runPromise(createRunDir(runId))
    const output = { status: "done", repo: "my-app" }
    const result = await Effect.runPromiseExit(
      writeStepOutput(runId, "triage", output)
    )
    expect(Exit.isSuccess(result)).toBe(true)

    const content = Fs.readFileSync(
      Path.join(runDir(runId), "step-outputs", "triage.json"),
      "utf-8"
    )
    expect(JSON.parse(content)).toEqual(output)
  })

  it("appendStepLog appends JSONL lines", async () => {
    await Effect.runPromise(createRunDir(runId))
    const event1 = { event: "prompt", timestamp: new Date().toISOString() }
    const event2 = { event: "completion", timestamp: new Date().toISOString() }

    await Effect.runPromise(appendStepLog(runId, "triage", event1))
    await Effect.runPromise(appendStepLog(runId, "triage", event2))

    const content = Fs.readFileSync(
      Path.join(runDir(runId), "logs", "triage.jsonl"),
      "utf-8"
    )
    const lines = content.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[0]).event).toBe("prompt")
    expect(JSON.parse(lines[1]).event).toBe("completion")
  })

  it("writeSummary writes summary.json", async () => {
    await Effect.runPromise(createRunDir(runId))
    const summary = {
      run_id: runId,
      workflow: "bug-fix",
      status: "completed",
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:05:00Z",
      total_duration_seconds: 300,
      token_usage: { total_input: 100, total_output: 50, by_step: {} },
      retries: {},
      step_results: {}
    }
    const result = await Effect.runPromiseExit(writeSummary(runId, summary))
    expect(Exit.isSuccess(result)).toBe(true)

    const content = Fs.readFileSync(
      Path.join(runDir(runId), "summary.json"),
      "utf-8"
    )
    expect(JSON.parse(content)).toEqual(summary)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/observability/run-dir.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/observability/run-dir.ts**

```typescript
import { Effect } from "effect"
import * as Fs from "node:fs"
import {
  runDir,
  stepOutputsDir,
  stepLogsDir,
  stepLogFile,
  stepOutputFile,
  inputFile,
  summaryFile
} from "../paths.js"

export class RunDirError extends Effect.TaggedError("RunDirError")<{
  runId: string
  message: string
}>() {}

export function createRunDir(runId: string): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      const dir = runDir(runId)
      Fs.mkdirSync(dir, { recursive: true })
      Fs.mkdirSync(stepOutputsDir(runId), { recursive: true })
      Fs.mkdirSync(stepLogsDir(runId), { recursive: true })
    },
    catch: (e) =>
      new RunDirError({ runId, message: `Failed to create run dir: ${String(e)}` })
  })
}

export function writeInput(
  runId: string,
  input: Record<string, unknown>
): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.writeFileSync(inputFile(runId), JSON.stringify(input, null, 2), "utf-8")
    },
    catch: (e) =>
      new RunDirError({ runId, message: `Failed to write input: ${String(e)}` })
  })
}

export function writeStepOutput(
  runId: string,
  stepId: string,
  output: Record<string, unknown>
): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.writeFileSync(
        stepOutputFile(runId, stepId),
        JSON.stringify(output, null, 2),
        "utf-8"
      )
    },
    catch: (e) =>
      new RunDirError({
        runId,
        message: `Failed to write step output for ${stepId}: ${String(e)}`
      })
  })
}

export function appendStepLog(
  runId: string,
  stepId: string,
  event: Record<string, unknown>
): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event })
      Fs.appendFileSync(stepLogFile(runId, stepId), line + "\n", "utf-8")
    },
    catch: (e) =>
      new RunDirError({
        runId,
        message: `Failed to append step log for ${stepId}: ${String(e)}`
      })
  })
}

export function writeSummary(
  runId: string,
  summary: Record<string, unknown>
): Effect.Effect<void, RunDirError> {
  return Effect.try({
    try: () => {
      Fs.writeFileSync(summaryFile(runId), JSON.stringify(summary, null, 2), "utf-8")
    },
    catch: (e) =>
      new RunDirError({ runId, message: `Failed to write summary: ${String(e)}` })
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/observability/run-dir.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/observability/run-dir.ts tests/observability/run-dir.test.ts
git commit -m "feat: add run directory management (create, input, outputs, logs, summary)"
```

---

### Task 10: Agent Activity Wrapper

**Files:**
- Create: `src/agent/activity.ts`
- Create: `tests/agent/activity.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/agent/activity.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import { Effect, Exit, Ref } from "effect"
import {
  buildAgentPrompt,
  parseAgentOutput,
  extractContextFromOutput
} from "../../src/agent/activity.js"

describe("buildAgentPrompt", () => {
  it("builds a prompt from persona and input", () => {
    const prompt = buildAgentPrompt({
      agentsMd: "# Setup Agent\nCreate branches.",
      identityMd: "Name: Setup",
      soulMd: "Practical.",
      stepInput: "Create a bugfix branch",
      context: { task: "Fix login bug", repo: "my-app" }
    })
    expect(prompt).toContain("# Setup Agent")
    expect(prompt).toContain("Create a bugfix branch")
    expect(prompt).toContain("Your role: Name: Setup")
    expect(prompt).toContain("Fix login bug")
  })

  it("replaces {{template}} in step input with context values", () => {
    const prompt = buildAgentPrompt({
      agentsMd: "Instructions",
      identityMd: "",
      soulMd: "",
      stepInput: "Work on {{task}} in {{repo}}",
      context: { task: "add feature", repo: "my-app" }
    })
    expect(prompt).toContain("Work on add feature in my-app")
  })
})

describe("parseAgentOutput", () => {
  it("parses valid JSON output", () => {
    const result = parseAgentOutput(
      '```json\n{"status":"done","repo":"x"}\n```'
    )
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("done")
      expect(result.value.repo).toBe("x")
    }
  })

  it("parses raw JSON without code fences", () => {
    const result = parseAgentOutput('{"status":"done"}')
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("done")
    }
  })

  it("fails on invalid JSON", () => {
    const result = parseAgentOutput("not json")
    expect(Exit.isFailure(result)).toBe(true)
  })

  it("fails on empty string", () => {
    const result = parseAgentOutput("")
    expect(Exit.isFailure(result)).toBe(true)
  })
})

describe("extractContextFromOutput", () => {
  it("extracts status from output", () => {
    const ctx = extractContextFromOutput({
      status: "done",
      repo: "my-app",
      branch: "fix-123"
    })
    expect(ctx.status).toBe("done")
    expect(ctx.repo).toBe("my-app")
    expect(ctx.branch).toBe("fix-123")
  })

  it("excludes non-string values", () => {
    const ctx = extractContextFromOutput({
      status: "done",
      count: 42,
      nested: { a: 1 }
    })
    expect(ctx.status).toBe("done")
    expect(ctx.count).toBeUndefined()
    expect(ctx.nested).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/agent/activity.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/agent/activity.ts**

```typescript
import { Effect } from "effect"
import { resolveTemplate } from "../workflow/context.js"

class AgentOutputParseError extends Effect.TaggedError(
  "AgentOutputParseError"
)<{ message: string }>() {}

export interface PromptParams {
  agentsMd: string
  identityMd: string
  soulMd: string
  stepInput: string
  context: Record<string, string>
}

export function buildAgentPrompt(params: PromptParams): string {
  const resolvedInput = resolveTemplate(params.stepInput, params.context)

  const parts: string[] = []

  if (params.identityMd) {
    parts.push(`Your role: ${params.identityMd}`)
  }

  if (params.soulMd) {
    parts.push(`Your style: ${params.soulMd}`)
  }

  const contextEntries = Object.entries(params.context)
  if (contextEntries.length > 0) {
    parts.push("Context from previous steps:")
    for (const [key, value] of contextEntries) {
      parts.push(`  ${key}: ${value}`)
    }
  }

  parts.push("")
  parts.push(params.agentsMd)
  parts.push("")
  parts.push(`Task: ${resolvedInput}`)
  parts.push("")
  parts.push(
    "When complete, respond with a JSON object containing your results."
  )

  return parts.join("\n")
}

export function parseAgentOutput(
  output: string
): Effect.Effect<Record<string, unknown>, AgentOutputParseError> {
  return Effect.gen(function* () {
    // Try to extract JSON from code fences first
    const fenceMatch = output.match(/```(?:json)?\s*([\s\S]*?)```/i)
    const jsonStr = fenceMatch ? fenceMatch[1].trim() : output.trim()

    if (!jsonStr) {
      return yield* Effect.fail(
        new AgentOutputParseError({ message: "Empty agent output" })
      )
    }

    const parsed = yield* Effect.try({
      try: (): Record<string, unknown> => {
        const result = JSON.parse(jsonStr)
        if (typeof result !== "object" || result === null || Array.isArray(result)) {
          throw new Error("Output must be a JSON object")
        }
        return result
      },
      catch: (e) =>
        new AgentOutputParseError({
          message: `Failed to parse agent output: ${String(e)}`
        })
    })

    return parsed
  })
}

export function extractContextFromOutput(
  output: Record<string, unknown>
): Record<string, string> {
  const ctx: Record<string, string> = {}

  for (const [key, value] of Object.entries(output)) {
    if (typeof value === "string") {
      ctx[key] = value
    }
  }

  return ctx
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/agent/activity.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agent/activity.ts tests/agent/activity.test.ts
git commit -m "feat: add agent activity wrapper (prompt builder, output parser, context extraction)"
```

---

### Task 11: Workflow Engine

**Files:**
- Create: `src/workflow/engine.ts`
- Create: `tests/workflow/engine.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/workflow/engine.test.ts`:

```typescript
import { describe, it, expect } from "vitest"
import {
  computeStepOrder,
  buildRunId,
  resolveStepTimeout
} from "../../src/workflow/engine.js"
import type { WorkflowSpec } from "../../src/types.js"

const sampleSpec: WorkflowSpec = {
  id: "bug-fix",
  name: "Bug Fix",
  version: 1,
  agents: [
    { id: "triager", role: "analysis", workspace: { baseDir: "a", files: {} } },
    { id: "fixer", role: "coding", workspace: { baseDir: "b", files: {} } },
    { id: "verifier", role: "verification", workspace: { baseDir: "c", files: {} } }
  ],
  steps: [
    { id: "triage", agent: "triager", input: "do {{task}}", max_retries: 3 },
    { id: "fix", agent: "fixer", input: "fix it", max_retries: 2 },
    { id: "verify", agent: "verifier", input: "verify", max_retries: 1, on_fail: { retry_step: "fix", max_retries: 5 } }
  ],
  polling: { timeoutSeconds: 600 }
}

describe("computeStepOrder", () => {
  it("returns steps in definition order", () => {
    const order = computeStepOrder(sampleSpec)
    expect(order).toEqual(["triage", "fix", "verify"])
  })
})

describe("buildRunId", () => {
  it("generates a run id with workflow prefix and uuid", () => {
    const id = buildRunId("bug-fix")
    expect(id).toMatch(/^bug-fix-[a-f0-9-]{36}$/)
  })
})

describe("resolveStepTimeout", () => {
  it("uses step-level timeoutSeconds from agent config", () => {
    const spec: WorkflowSpec = {
      ...sampleSpec,
      agents: [
        ...sampleSpec.agents.slice(0, 1),
        { id: "fixer", role: "coding", timeoutSeconds: 300, workspace: { baseDir: "x", files: {} } },
        sampleSpec.agents[2]
      ]
    }
    expect(resolveStepTimeout(spec, "fixer")).toBe(300)
  })

  it("falls back to polling timeoutSeconds", () => {
    expect(resolveStepTimeout(sampleSpec, "triager")).toBe(600)
  })

  it("defaults to 300 when nothing configured", () => {
    const spec: WorkflowSpec = {
      ...sampleSpec,
      polling: undefined,
      agents: [
        { id: "triager", role: "analysis", workspace: { baseDir: "a", files: {} } },
        { id: "fixer", role: "coding", workspace: { baseDir: "b", files: {} } },
        { id: "verifier", role: "verification", workspace: { baseDir: "c", files: {} } }
      ]
    }
    expect(resolveStepTimeout(spec, "triager")).toBe(300)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/workflow/engine.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/workflow/engine.ts**

```typescript
import type { WorkflowSpec } from "../types.js"
import * as Crypto from "node:crypto"

export function computeStepOrder(spec: WorkflowSpec): string[] {
  return spec.steps.map((s) => s.id)
}

export function buildRunId(workflowId: string): string {
  const uuid = Crypto.randomUUID()
  return `${workflowId}-${uuid}`
}

export function resolveStepTimeout(
  spec: WorkflowSpec,
  agentId: string
): number {
  const agent = spec.agents.find((a) => a.id === agentId)
  if (agent?.timeoutSeconds) return agent.timeoutSeconds
  if (spec.polling?.timeoutSeconds) return spec.polling.timeoutSeconds
  return 300
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/workflow/engine.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/engine.ts tests/workflow/engine.test.ts
git commit -m "feat: add workflow engine utilities (step order, run id, timeout resolution)"
```

---

### Task 12: Workflow Runner (core execution)

**Files:**
- Create: `src/workflow/runner.ts`
- Create: `tests/workflow/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/workflow/runner.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit, Ref } from "effect"
import { runWorkflow } from "../../src/workflow/runner.js"
import type { WorkflowSpec } from "../../src/types.js"
import { runDir } from "../../src/paths.js"

const makeSpec = (): WorkflowSpec => ({
  id: "test-wf",
  name: "Test Workflow",
  version: 1,
  polling: { timeoutSeconds: 10 },
  agents: [
    {
      id: "echo",
      role: "coding",
      workspace: { baseDir: "agents/echo", files: { "AGENTS.md": "agents/echo/AGENTS.md" } }
    }
  ],
  steps: [
    {
      id: "greet",
      agent: "echo",
      input: "Say hello {{name}}",
      expects: "STATUS: done",
      max_retries: 1
    }
  ]
})

describe("runWorkflow", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-test-runner-" + Date.now())
    process.env.HOME = testHome

    const agentsDir = Path.join(testHome, ".hamilton", "agents", "shared", "echo")
    Fs.mkdirSync(agentsDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentsDir, "AGENTS.md"), "Echo back input")
    Fs.writeFileSync(Path.join(agentsDir, "IDENTITY.md"), "Name: Echo")
    Fs.writeFileSync(Path.join(agentsDir, "SOUL.md"), "Friendly")
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("completes a single-step workflow and writes run directory", async () => {
    const spec = makeSpec()
    const context = { name: "World" }

    const mockExecute = () =>
      Effect.succeed({
        status: "done",
        greeting: "Hello World"
      })

    const events: Array<{ type: string }> = []

    const result = await Effect.runPromiseExit(
      runWorkflow(spec, context, {
        executeStep: () => mockExecute(),
        onEvent: (event) => Effect.sync(() => { events.push(event) }),
        workflowsDir: Path.join(testHome, ".hamilton", "workflows", "test-wf")
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.stepResults["greet"]).toBe("completed")

      // Verify run directory exists
      const rd = runDir(result.value.runId)
      expect(Fs.existsSync(rd)).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "input.json"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "step-outputs", "greet.json"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "logs", "greet.jsonl"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "summary.json"))).toBe(true)

      // Verify events
      expect(events.some((e) => e.type === "workflow_started")).toBe(true)
      expect(events.some((e) => e.type === "step_completed")).toBe(true)
      expect(events.some((e) => e.type === "workflow_completed")).toBe(true)
    }
  })

  it("handles step failure with retry", async () => {
    const spec = makeSpec()
    let attempts = 0

    const mockExecute = () =>
      Effect.sync(() => {
        attempts++
        if (attempts < 2) {
          return Effect.fail(new Error("test failure"))
        }
        return Effect.succeed({ status: "done" })
      }).pipe(Effect.flatten)

    const events: Array<{ type: string }> = []

    const result = await Effect.runPromiseExit(
      runWorkflow(spec, {}, {
        executeStep: () => mockExecute(),
        onEvent: (event) => Effect.sync(() => { events.push(event) }),
        workflowsDir: Path.join(testHome, ".hamilton", "workflows", "test-wf")
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(attempts).toBe(2)
      expect(events.some((e) => e.type === "step_retry")).toBe(true)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/workflow/runner.test.ts
```

Expected: FAIL — `runWorkflow` is not defined.

- [ ] **Step 3: Create src/workflow/runner.ts**

```typescript
import { Effect, Duration, Schedule } from "effect"
import type { WorkflowSpec } from "../types.js"
import { buildRunId, computeStepOrder, resolveStepTimeout } from "./engine.js"
import { mergeContext } from "./context.js"
import { buildAgentPrompt, parseAgentOutput, extractContextFromOutput } from "../agent/activity.js"
import { loadPersona } from "../agent/persona.js"
import { createRunDir, writeInput, writeStepOutput, appendStepLog, writeSummary } from "../observability/run-dir.js"
import * as Path from "node:path"

export interface WorkflowEvent {
  type: string
  runId: string
  stepId?: string
  message?: string
  timestamp: string
  data?: Record<string, unknown>
}

export interface StepExecutor {
  executeStep(params: {
    prompt: string
    stepId: string
    agentId: string
    runId: string
    timeoutSeconds: number
  }): Effect.Effect<Record<string, unknown>, Error>
}

export interface WorkflowRunnerConfig {
  executeStep: (params: {
    prompt: string
    stepId: string
    agentId: string
    runId: string
    timeoutSeconds: number
  }) => Effect.Effect<Record<string, unknown>, Error>
  onEvent: (event: WorkflowEvent) => Effect.Effect<void>
  workflowsDir: string
}

export interface WorkflowResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
  context: Record<string, string>
  startedAt: string
  completedAt: string
}

function emit(
  onEvent: (event: WorkflowEvent) => Effect.Effect<void>,
  event: Omit<WorkflowEvent, "timestamp">
): Effect.Effect<void> {
  return onEvent({ ...event, timestamp: new Date().toISOString() })
}

export function runWorkflow(
  spec: WorkflowSpec,
  initialContext: Record<string, string>,
  config: WorkflowRunnerConfig
): Effect.Effect<WorkflowResult, Error> {
  return Effect.gen(function* () {
    const runId = buildRunId(spec.id)
    const startedAt = new Date().toISOString()
    const stepOrder = computeStepOrder(spec)
    let context = { ...initialContext }
    const stepResults: Record<string, string> = {}

    yield* createRunDir(runId)
    yield* writeInput(runId, { task: initialContext.task, workflow_id: spec.id, context: initialContext })

    yield* emit(config.onEvent, {
      type: "workflow_started",
      runId,
      data: { workflow_id: spec.id }
    })

    for (const stepId of stepOrder) {
      const step = spec.steps.find((s) => s.id === stepId)!
      const agent = spec.agents.find((a) => a.id === step.agent)!

      yield* emit(config.onEvent, {
        type: "step_started",
        runId,
        stepId,
        data: { agent: agent.id }
      })

      const personaDir = Path.join(
        Path.dirname(config.workflowsDir),
        "..",
        "..",
        "agents",
        "shared",
        agent.id
      )

      const persona = yield* loadPersona(personaDir).pipe(
        Effect.catchAll(() =>
          Effect.succeed({ agents: "", identity: "", soul: "" })
        )
      )

      const prompt = buildAgentPrompt({
        agentsMd: persona.agents,
        identityMd: persona.identity,
        soulMd: persona.soul,
        stepInput: step.input,
        context
      })

      yield* appendStepLog(runId, stepId, {
        event: "prompt",
        step_id: stepId,
        agent_id: agent.id,
        prompt_length: prompt.length
      })

      const timeoutSeconds = resolveStepTimeout(spec, agent.id)
      const maxRetries = step.max_retries ?? 1

      const result = yield* config
        .executeStep({
          prompt,
          stepId,
          agentId: agent.id,
          runId,
          timeoutSeconds
        })
        .pipe(
          Effect.retry(
            Schedule.recurs(maxRetries - 1).pipe(
              Schedule.tapInput((_error) =>
                Effect.gen(function* () {
                  yield* emit(config.onEvent, {
                    type: "step_retry",
                    runId,
                    stepId,
                    message: `Retrying step after failure`
                  })
                  yield* appendStepLog(runId, stepId, {
                    event: "retry",
                    step_id: stepId
                  })
                })
              )
            )
          ),
          Effect.tap((output) =>
            appendStepLog(runId, stepId, {
              event: "completion",
              step_id: stepId,
              output_keys: Object.keys(output)
            }).pipe(
              Effect.zipRight(
                writeStepOutput(runId, stepId, output)
              )
            )
          ),
          Effect.timeout(Duration.seconds(timeoutSeconds)),
          Effect.catchAll((error) =>
            Effect.gen(function* () {
              yield* emit(config.onEvent, {
                type: "step_failed",
                runId,
                stepId,
                message: String(error)
              })
              stepResults[stepId] = "failed"
              return yield* Effect.fail(error)
            })
          )
        )

      const newContext = extractContextFromOutput(result)
      context = mergeContext(context, newContext)
      stepResults[stepId] = "completed"

      yield* emit(config.onEvent, {
        type: "step_completed",
        runId,
        stepId,
        data: { output_keys: Object.keys(result) }
      })
    }

    const completedAt = new Date().toISOString()

    yield* writeSummary(runId, {
      run_id: runId,
      workflow: spec.id,
      status: "completed",
      started_at: startedAt,
      completed_at: completedAt,
      step_results: stepResults
    })

    yield* emit(config.onEvent, {
      type: "workflow_completed",
      runId,
      data: { step_results: stepResults }
    })

    return {
      runId,
      status: "completed",
      stepResults,
      context,
      startedAt,
      completedAt
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/workflow/runner.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workflow/runner.ts tests/workflow/runner.test.ts
git commit -m "feat: add workflow runner with step execution, retry, and run directory output"
```

---

### Task 13: CLI Entry Point and Workflow List

**Files:**
- Create: `src/cli/main.ts`
- Create: `src/cli/commands/list.ts`
- Create: `tests/cli/list.test.ts`

- [ ] **Step 1: Write the failing test for list command**

Create `tests/cli/list.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { listWorkflows } from "../../src/cli/commands/list.js"
import { workflowsDir } from "../../src/paths.js"

describe("listWorkflows", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-test-list-" + Date.now())
    process.env.HOME = testHome
    const dir = workflowsDir()
    Fs.mkdirSync(dir, { recursive: true })

    Fs.mkdirSync(Path.join(dir, "bug-fix"))
    Fs.writeFileSync(Path.join(dir, "bug-fix", "workflow.yml"), "id: bug-fix\nname: Bug Fix\nversion: 1\nagents: []\nsteps: []")
    Fs.mkdirSync(Path.join(dir, "feature-dev"))
    Fs.writeFileSync(Path.join(dir, "feature-dev", "workflow.yml"), "id: feature-dev\nname: Feature Dev\nversion: 1\nagents: []\nsteps: []")
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("lists all installed workflows", async () => {
    const result = await Effect.runPromiseExit(listWorkflows)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(2)
      expect(result.value[0].id).toBe("bug-fix")
      expect(result.value[0].name).toBe("Bug Fix")
      expect(result.value[1].id).toBe("feature-dev")
    }
  })

  it("returns empty array when no workflows installed", async () => {
    Fs.rmSync(workflowsDir(), { recursive: true, force: true })
    Fs.mkdirSync(workflowsDir(), { recursive: true })

    const result = await Effect.runPromiseExit(listWorkflows)
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toEqual([])
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/list.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/cli/commands/list.ts**

```typescript
import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { workflowsDir } from "../../paths.js"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import type { WorkflowSpec } from "../../types.js"

export interface WorkflowListItem {
  id: string
  name: string
  description: string | undefined
  version: number
  stepCount: number
  agentCount: number
}

export const listWorkflows: Effect.Effect<
  WorkflowListItem[],
  never
> = Effect.gen(function* () {
  const dir = workflowsDir()

  const entries = yield* Effect.try({
    try: () => {
      if (!Fs.existsSync(dir)) return []
      return Fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort()
    },
    catch: () => []
  })

  const results: WorkflowListItem[] = []

  for (const slug of entries) {
    const spec = yield* loadWorkflowSpec(dir, slug).pipe(
      Effect.catchAll(() =>
        Effect.succeed(null)
      )
    )

    if (spec) {
      results.push({
        id: spec.id,
        name: spec.name,
        description: spec.description,
        version: spec.version,
        stepCount: spec.steps.length,
        agentCount: spec.agents.length
      })
    }
  }

  return results
})
```

- [ ] **Step 4: Create src/cli/main.ts**

```typescript
#!/usr/bin/env node
import { Effect } from "effect"

const args = process.argv.slice(2)

if (args.length === 0) {
  console.log("Hamilton - Workflow-based agentic execution engine")
  console.log("Usage: hamilton <command> [options]")
  process.exit(0)
}

const command = args[0]
const cmdArgs = args.slice(1)

// Placeholder: commands will be wired in later tasks
console.log(`Command: ${command}, Args: ${JSON.stringify(cmdArgs)}`)
```

- [ ] **Step 5: Make CLI executable**

```bash
chmod +x src/cli/main.ts
```

- [ ] **Step 6: Run test to verify it passes**

```bash
npx vitest run tests/cli/list.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/cli/main.ts src/cli/commands/list.ts tests/cli/list.test.ts
git commit -m "feat: add CLI entry point and workflow list command"
```

---

### Task 14: CLI Workflow Run Command

**Files:**
- Create: `src/cli/commands/run.ts`
- Create: `tests/cli/run.test.ts` (integration test via runner)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/run.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { executeRun } from "../../src/cli/commands/run.js"
import type { WorkflowSpec } from "../../src/types.js"
import { workflowsDir, runDir } from "../../src/paths.js"

describe("executeRun", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-test-run-" + Date.now())
    process.env.HOME = testHome

    const wfDir = Path.join(workflowsDir(), "quick")
    Fs.mkdirSync(wfDir, { recursive: true })
    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), [
      "id: quick",
      "name: Quick Task",
      "version: 1",
      "polling:",
      "  timeoutSeconds: 30",
      "agents:",
      "  - id: doer",
      "    role: coding",
      "    workspace:",
      "      baseDir: agents/doer",
      "      files:",
      "        AGENTS.md: agents/doer/AGENTS.md",
      "steps:",
      "  - id: execute",
      "    agent: doer",
      "    input: '{{task}}'",
      "    expects: 'STATUS: done'",
      "    max_retries: 1"
    ].join("\n"))

    const agentDir = Path.join(testHome, ".hamilton", "agents", "shared", "doer")
    Fs.mkdirSync(agentDir, { recursive: true })
    Fs.writeFileSync(Path.join(agentDir, "AGENTS.md"), "Execute the task")
    Fs.writeFileSync(Path.join(agentDir, "IDENTITY.md"), "Name: Doer")
    Fs.writeFileSync(Path.join(agentDir, "SOUL.md"), "Efficient")
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("runs a workflow and returns result", async () => {
    const mockStepFn = () => Effect.succeed({ status: "done", output: "success" })

    const result = await Effect.runPromiseExit(
      executeRun({
        workflowSlug: "quick",
        prompt: "do something",
        executeStep: mockStepFn
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.stepResults.execute).toBe("completed")
    }
  })

  it("returns error for nonexistent workflow", async () => {
    const result = await Effect.runPromiseExit(
      executeRun({
        workflowSlug: "nonexistent",
        prompt: "do something",
        executeStep: () => Effect.succeed({})
      })
    )
    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/run.test.ts
```

Expected: FAIL — `executeRun` is not defined.

- [ ] **Step 3: Create src/cli/commands/run.ts**

```typescript
import { Effect } from "effect"
import { loadWorkflowSpec } from "../../workflow/loader.js"
import { resolveWorkflowId } from "../../workflow/resolver.js"
import { runWorkflow, type WorkflowEvent } from "../../workflow/runner.js"
import { workflowsDir, agentsDir } from "../../paths.js"
import * as Fs from "node:fs"
import * as Path from "node:path"

export interface RunParams {
  workflowSlug: string
  prompt: string
  executeStep: (params: {
    prompt: string
    stepId: string
    agentId: string
    runId: string
    timeoutSeconds: number
  }) => Effect.Effect<Record<string, unknown>, Error>
}

export interface RunResult {
  runId: string
  status: "completed" | "failed" | "paused"
  stepResults: Record<string, string>
}

export function executeRun(params: RunParams): Effect.Effect<
  RunResult,
  Error
> {
  return Effect.gen(function* () {
    const wfDir = workflowsDir()
    const available = yield* Effect.try({
      try: () => {
        if (!Fs.existsSync(wfDir)) return new Set<string>()
        return new Set(
          Fs.readdirSync(wfDir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
        )
      },
      catch: () => new Set<string>()
    })

    const resolvedId = resolveWorkflowId(params.workflowSlug, available)

    const spec = yield* loadWorkflowSpec(wfDir, resolvedId)

    const result = yield* runWorkflow(spec, { task: params.prompt }, {
      executeStep: (stepParams) =>
        Effect.gen(function* () {
          yield* Effect.log(`[${stepParams.stepId}] Starting agent ${stepParams.agentId}`)
          yield* Effect.log(`[${stepParams.stepId}] Prompt (${stepParams.prompt.length} chars)`)
          return yield* params.executeStep(stepParams)
        }),
      onEvent: (event: WorkflowEvent) =>
        Effect.log(
          `[${event.runId}] ${event.type}${event.stepId ? ` ${event.stepId}` : ""}`
        ),
      workflowsDir: Path.join(wfDir, resolvedId)
    })

    return {
      runId: result.runId,
      status: result.status,
      stepResults: result.stepResults
    }
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cli/run.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/run.ts tests/cli/run.test.ts
git commit -m "feat: add CLI workflow run command"
```

---

### Task 15: CLI Status, Pause, and Resume Commands

**Files:**
- Create: `src/workflow/state.ts`
- Create: `src/cli/commands/status.ts`
- Create: `tests/cli/status.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/status.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { getRunStatus } from "../../src/cli/commands/status.js"
import { runsDir } from "../../src/paths.js"

describe("getRunStatus", () => {
  const origHome = process.env.HOME
  let testHome: string
  const runId = "bug-fix-abc123"

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-test-status-" + Date.now())
    process.env.HOME = testHome

    const rd = Path.join(runsDir(), runId)
    Fs.mkdirSync(rd, { recursive: true })
    Fs.mkdirSync(Path.join(rd, "step-outputs"), { recursive: true })
    Fs.mkdirSync(Path.join(rd, "logs"), { recursive: true })

    Fs.writeFileSync(Path.join(rd, "input.json"), JSON.stringify({
      task: "test",
      workflow_id: "bug-fix"
    }))
    Fs.writeFileSync(Path.join(rd, "summary.json"), JSON.stringify({
      run_id: runId,
      workflow: "bug-fix",
      status: "completed",
      started_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:05:00Z",
      total_duration_seconds: 300,
      token_usage: { total_input: 100, total_output: 50, by_step: {} },
      retries: {},
      step_results: { triage: "completed", fix: "completed", verify: "completed" }
    }))
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("returns run status from summary.json", async () => {
    const result = await Effect.runPromiseExit(getRunStatus(runId))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.runId).toBe(runId)
      expect(result.value.workflow).toBe("bug-fix")
      expect(result.value.status).toBe("completed")
      expect(result.value.stepResults.triage).toBe("completed")
    }
  })

  it("fails when run directory does not exist", async () => {
    const result = await Effect.runPromiseExit(getRunStatus("nonexistent-run"))
    expect(Exit.isFailure(result)).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/status.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/workflow/state.ts**

```typescript
import { Effect } from "effect"
import * as Fs from "node:fs"
import { runDir, summaryFile } from "../paths.js"

export class RunStateError extends Effect.TaggedError("RunStateError")<{
  runId: string
  message: string
}>() {}

export interface RunStatus {
  runId: string
  workflow: string
  status: string
  startedAt: string
  completedAt?: string
  stepResults: Record<string, string>
  tokenUsage?: Record<string, unknown>
}

export function loadRunState(runId: string): Effect.Effect<RunStatus, RunStateError> {
  return Effect.gen(function* () {
    const rd = runDir(runId)
    const exists = yield* Effect.try({
      try: () => Fs.existsSync(rd),
      catch: (e) => new RunStateError({ runId, message: String(e) })
    })

    if (!exists) {
      return yield* Effect.fail(
        new RunStateError({ runId, message: `Run directory not found: ${rd}` })
      )
    }

    const summaryPath = summaryFile(runId)
    const summary = yield* Effect.try({
      try: () => {
        if (!Fs.existsSync(summaryPath)) return null
        return JSON.parse(Fs.readFileSync(summaryPath, "utf-8"))
      },
      catch: (e) => new RunStateError({ runId, message: `Failed to read summary: ${String(e)}` })
    })

    if (!summary) {
      return yield* Effect.fail(
        new RunStateError({ runId, message: "No summary.json found" })
      )
    }

    return {
      runId: summary.run_id ?? runId,
      workflow: summary.workflow ?? "unknown",
      status: summary.status ?? "unknown",
      startedAt: summary.started_at ?? "",
      completedAt: summary.completed_at,
      stepResults: summary.step_results ?? {},
      tokenUsage: summary.token_usage
    }
  })
}
```

- [ ] **Step 4: Create src/cli/commands/status.ts**

```typescript
import { loadRunState } from "../../workflow/state.js"

export { loadRunState as getRunStatus }
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/cli/status.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/workflow/state.ts src/cli/commands/status.ts tests/cli/status.test.ts
git commit -m "feat: add workflow state loader and status command"
```

---

### Task 16: CLI Logs Command

**Files:**
- Create: `src/cli/commands/logs.ts`
- Create: `tests/cli/logs.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/logs.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { getRunLogs } from "../../src/cli/commands/logs.js"
import { runsDir } from "../../src/paths.js"

describe("getRunLogs", () => {
  const origHome = process.env.HOME
  let testHome: string
  const runId = "bug-fix-abc123"

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-test-logs-" + Date.now())
    process.env.HOME = testHome

    const logsDir = Path.join(runsDir(), runId, "logs")
    Fs.mkdirSync(logsDir, { recursive: true })

    Fs.writeFileSync(
      Path.join(logsDir, "triage.jsonl"),
      [
        JSON.stringify({ event: "prompt", step_id: "triage", timestamp: "2026-01-01T00:00:00Z" }),
        JSON.stringify({ event: "completion", step_id: "triage", timestamp: "2026-01-01T00:01:00Z" })
      ].join("\n") + "\n"
    )

    Fs.writeFileSync(
      Path.join(logsDir, "fix.jsonl"),
      [
        JSON.stringify({ event: "tool_call", step_id: "fix", tool: "bash", timestamp: "2026-01-01T00:02:00Z" }),
        JSON.stringify({ event: "tool_result", step_id: "fix", tool: "bash", timestamp: "2026-01-01T00:02:05Z" })
      ].join("\n") + "\n"
    )
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("returns all log events for a run", async () => {
    const result = await Effect.runPromiseExit(getRunLogs({ runId }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(4)
      expect(result.value[0].event).toBe("prompt")
      expect(result.value[2].event).toBe("tool_call")
    }
  })

  it("filters logs by step", async () => {
    const result = await Effect.runPromiseExit(getRunLogs({ runId, stepId: "triage" }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toHaveLength(2)
      expect(result.value.every((e) => e.step_id === "triage")).toBe(true)
    }
  })

  it("returns empty array for missing logs dir", async () => {
    const result = await Effect.runPromiseExit(getRunLogs({ runId: "nonexistent" }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value).toEqual([])
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/cli/logs.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create src/cli/commands/logs.ts**

```typescript
import { Effect } from "effect"
import * as Fs from "node:fs"
import * as Path from "node:path"
import { runDir } from "../../paths.js"

export interface LogEvent {
  event: string
  step_id?: string
  timestamp?: string
  [key: string]: unknown
}

export interface LogsParams {
  runId: string
  stepId?: string
}

export function getRunLogs(
  params: LogsParams
): Effect.Effect<LogEvent[], never> {
  return Effect.sync(() => {
    const rd = runDir(params.runId)
    const logsDir = Path.join(rd, "logs")

    if (!Fs.existsSync(logsDir)) return []

    const files = params.stepId
      ? [Path.join(logsDir, `${params.stepId}.jsonl`)]
      : Fs.readdirSync(logsDir)
          .filter((f) => f.endsWith(".jsonl"))
          .map((f) => Path.join(logsDir, f))

    const events: LogEvent[] = []

    for (const file of files) {
      if (!Fs.existsSync(file)) continue

      const content = Fs.readFileSync(file, "utf-8")
      const lines = content.trim().split("\n").filter((l) => l.length > 0)

      for (const line of lines) {
        try {
          events.push(JSON.parse(line))
        } catch {
          // skip malformed lines
        }
      }
    }

    return events.sort(
      (a, b) => (a.timestamp ?? "").localeCompare(b.timestamp ?? "")
    )
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/cli/logs.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/logs.ts tests/cli/logs.test.ts
git commit -m "feat: add CLI logs command for viewing conversation history"
```

---

### Task 17: Bundle Workflow YAMLs and Agent Personas

**Files:**
- Create: `workflows/bug-fix/workflow.yml`
- Create: `workflows/bug-fix-merge/workflow.yml`
- Create: `workflows/bug-fix-worktree/workflow.yml`
- Create: `workflows/bug-fix-merge-worktree/workflow.yml`
- Create: `workflows/bug-fix-github-pr/workflow.yml`
- Create: `workflows/feature-dev/workflow.yml`
- Create: `workflows/feature-dev-merge/workflow.yml`
- Create: `workflows/feature-dev-worktree/workflow.yml`
- Create: `workflows/feature-dev-merge-worktree/workflow.yml`
- Create: `workflows/feature-dev-github-pr/workflow.yml`
- Create: `workflows/security-audit/workflow.yml`
- Create: `workflows/security-audit-merge/workflow.yml`
- Create: `workflows/security-audit-worktree/workflow.yml`
- Create: `workflows/security-audit-merge-worktree/workflow.yml`
- Create: `workflows/security-audit-github-pr/workflow.yml`
- Create: `workflows/quarantine-broken-tests/workflow.yml`
- Create: `workflows/quarantine-broken-tests-merge/workflow.yml`
- Create: `workflows/quarantine-broken-tests-merge-worktree/workflow.yml`
- Copy: `agents/shared/setup/` from Tamandua
- Copy: `agents/shared/verifier/` from Tamandua
- Copy: `agents/shared/pr/` from Tamandua
- Create: each bundled workflow's `agents/<workflow>/` directory with persona files

- [ ] **Step 1: Copy Tamandua agent personas**

```bash
mkdir -p agents/shared
cp -r /Users/caio.cavalcante/tamandua/agents/shared/setup agents/shared/
cp -r /Users/caio.cavalcante/tamandua/agents/shared/verifier agents/shared/
cp -r /Users/caio.cavalcante/tamandua/agents/shared/pr agents/shared/
```

- [ ] **Step 2: Copy all 18 workflow YAML files from Tamandua**

```bash
mkdir -p workflows
cp -r /Users/caio.cavalcante/tamandua/workflows/bug-fix workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/bug-fix-merge workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/bug-fix-worktree workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/bug-fix-merge-worktree workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/bug-fix-github-pr workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/feature-dev workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/feature-dev-merge workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/feature-dev-worktree workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/feature-dev-merge-worktree workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/feature-dev-github-pr workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/security-audit workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/security-audit-merge workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/security-audit-worktree workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/security-audit-merge-worktree workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/security-audit-github-pr workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/quarantine-broken-tests workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/quarantine-broken-tests-merge workflows/
cp -r /Users/caio.cavalcante/tamandua/workflows/quarantine-broken-tests-merge-worktree workflows/
```

- [ ] **Step 3: Create workflow-specific agent persona directories**

For each workflow, create its `agents/` subdirectory by copying the relevant persona files from the Tamandua workflows. Run:

```bash
for wf in bug-fix bug-fix-merge bug-fix-worktree bug-fix-merge-worktree bug-fix-github-pr feature-dev feature-dev-merge feature-dev-worktree feature-dev-merge-worktree feature-dev-github-pr security-audit security-audit-merge security-audit-worktree security-audit-merge-worktree security-audit-github-pr; do
  workflow_dir="workflows/$wf/agents"
  if [ -d "$workflow_dir" ]; then
    mkdir -p "$workflow_dir"
  fi
done

# Copy workflow-specific agents from Tamandua (triager, investigator, planner, developer, scanner, etc.)
for wf in bug-fix bug-fix-merge bug-fix-worktree bug-fix-merge-worktree; do
  src="/Users/caio.cavalcante/tamandua/workflows/bug-fix/agents"
  dest="workflows/$wf/agents"
  mkdir -p "$dest"
  for agent_dir in triager investigator fixer; do
    if [ -d "$src/$agent_dir" ]; then
      cp -r "$src/$agent_dir" "$dest/"
    fi
  done
done

for wf in feature-dev feature-dev-merge feature-dev-worktree feature-dev-merge-worktree; do
  src="/Users/caio.cavalcante/tamandua/workflows/feature-dev/agents"
  dest="workflows/$wf/agents"
  mkdir -p "$dest"
  for agent_dir in planner developer tester; do
    if [ -d "$src/$agent_dir" ]; then
      cp -r "$src/$agent_dir" "$dest/"
    fi
  done
done

for wf in security-audit security-audit-merge security-audit-worktree security-audit-merge-worktree; do
  src="/Users/caio.cavalcante/tamandua/workflows/security-audit/agents"
  dest="workflows/$wf/agents"
  mkdir -p "$dest"
  for agent_dir in scanner prioritizer fixer tester; do
    if [ -d "$src/$agent_dir" ]; then
      cp -r "$src/$agent_dir" "$dest/"
    fi
  done
done

for wf in quarantine-broken-tests quarantine-broken-tests-merge quarantine-broken-tests-merge-worktree; do
  src="/Users/caio.cavalcante/tamandua/workflows/quarantine-broken-tests/agents"
  dest="workflows/$wf/agents"
  mkdir -p "$dest"
  for agent_dir in investigator fixer verifier; do
    if [ -d "$src/$agent_dir" ]; then
      cp -r "$src/$agent_dir" "$dest/"
    fi
  done
done
```

- [ ] **Step 4: Verify all 18 workflows exist with workflow.yml**

```bash
for wf in bug-fix bug-fix-merge bug-fix-worktree bug-fix-merge-worktree bug-fix-github-pr feature-dev feature-dev-merge feature-dev-worktree feature-dev-merge-worktree feature-dev-github-pr security-audit security-audit-merge security-audit-worktree security-audit-merge-worktree security-audit-github-pr quarantine-broken-tests quarantine-broken-tests-merge quarantine-broken-tests-merge-worktree; do
  if [ ! -f "workflows/$wf/workflow.yml" ]; then
    echo "MISSING: $wf"
  else
    echo "OK: $wf"
  fi
done
```

Expected: All 18 show "OK".

- [ ] **Step 5: Commit**

```bash
git add workflows/ agents/
git commit -m "feat: bundle 18 workflow YAMLs and agent personas from Tamandua"
```

---

### Task 18: Integration Test with Mock Pi Agent

**Files:**
- Create: `tests/e2e/workflows.test.ts`

- [ ] **Step 1: Write the full E2E test**

Create `tests/e2e/workflows.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"
import { Effect, Exit } from "effect"
import { loadWorkflowSpec } from "../../src/workflow/loader.js"
import { runWorkflow } from "../../src/workflow/runner.js"
import { workflowsDir, runDir } from "../../src/paths.js"
import type { WorkflowSpec } from "../../src/types.js"

describe("end-to-end workflow execution", () => {
  const origHome = process.env.HOME
  let testHome: string

  beforeEach(() => {
    testHome = Path.join(Os.tmpdir(), "hamilton-e2e-" + Date.now())
    process.env.HOME = testHome

    // Install a minimal workflow
    const wfDir = Path.join(workflowsDir(), "e2e-test")
    Fs.mkdirSync(wfDir, { recursive: true })

    const yml = [
      "id: e2e-test",
      "name: E2E Test Workflow",
      "version: 1",
      "polling:",
      "  timeoutSeconds: 30",
      "agents:",
      "  - id: step1",
      "    role: coding",
      "    workspace:",
      "      baseDir: agents/step1",
      "      files:",
      "        AGENTS.md: agents/step1/AGENTS.md",
      "  - id: step2",
      "    role: verification",
      "    workspace:",
      "      baseDir: agents/step2",
      "      files:",
      "        AGENTS.md: agents/step2/AGENTS.md",
      "steps:",
      "  - id: analyze",
      "    agent: step1",
      "    input: 'Analyze {{task}} and return the repo and severity'",
      "    max_retries: 2",
      "  - id: verify",
      "    agent: step2",
      "    input: 'Verify the fix in {{repo}} with severity {{severity}}'",
      "    max_retries: 1",
      "    on_fail:",
      "      retry_step: analyze",
      "      max_retries: 3"
    ].join("\n")

    Fs.writeFileSync(Path.join(wfDir, "workflow.yml"), yml)

    // Create agent personas
    for (const agent of ["step1", "step2"]) {
      const agentDir = Path.join(testHome, ".hamilton", "agents", "shared", agent)
      Fs.mkdirSync(agentDir, { recursive: true })
      Fs.writeFileSync(
        Path.join(agentDir, "AGENTS.md"),
        agent === "step1"
          ? "Analyze the task. Output JSON with repo and severity."
          : "Verify the fix. Output JSON with status."
      )
      Fs.writeFileSync(Path.join(agentDir, "IDENTITY.md"), `Name: ${agent}`)
      Fs.writeFileSync(Path.join(agentDir, "SOUL.md"), "Professional")
    }
  })

  afterEach(() => {
    process.env.HOME = origHome
    Fs.rmSync(testHome, { recursive: true, force: true })
  })

  it("completes a multi-step workflow with context passing between steps", async () => {
    // Simulate two-step workflow with mock agent
    const callOrder: string[] = []

    const mockStepFn = (params: { stepId: string; prompt: string }) =>
      Effect.sync(() => {
        callOrder.push(params.stepId)

        if (params.stepId === "analyze") {
          expect(params.prompt).toContain("test task")
          return Effect.succeed({ status: "done", repo: "my-app", severity: "high" })
        }

        if (params.stepId === "verify") {
          // Context from step1 should be resolved in prompt
          expect(params.prompt).toContain("my-app")
          expect(params.prompt).toContain("high")
          return Effect.succeed({ status: "done", verified: "yes" })
        }

        return Effect.succeed({ status: "error" })
      }).pipe(Effect.flatten)

    const events: string[] = []
    const spec = await Effect.runPromise(
      loadWorkflowSpec(workflowsDir(), "e2e-test")
    )

    const result = await Effect.runPromiseExit(
      runWorkflow(spec, { task: "test task" }, {
        executeStep: (p) => mockStepFn(p),
        onEvent: (event) =>
          Effect.sync(() => { events.push(event.type) }),
        workflowsDir: Path.join(workflowsDir(), "e2e-test")
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.status).toBe("completed")
      expect(result.value.stepResults.analyze).toBe("completed")
      expect(result.value.stepResults.verify).toBe("completed")

      // Verify context passed between steps
      expect(result.value.context.repo).toBe("my-app")
      expect(result.value.context.severity).toBe("high")
      expect(result.value.context.status).toBe("done")

      // Verify call order
      expect(callOrder).toEqual(["analyze", "verify"])

      // Verify events
      expect(events).toContain("workflow_started")
      expect(events).toContain("step_started")
      expect(events).toContain("step_completed")
      expect(events).toContain("workflow_completed")

      // Verify run directory
      const rd = runDir(result.value.runId)
      expect(Fs.existsSync(Path.join(rd, "input.json"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "step-outputs", "analyze.json"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "step-outputs", "verify.json"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "logs", "analyze.jsonl"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "logs", "verify.jsonl"))).toBe(true)
      expect(Fs.existsSync(Path.join(rd, "summary.json"))).toBe(true)
    }
  })

  it("handles step failure and retry", async () => {
    let attempts = 0

    const mockStepFn = () =>
      Effect.sync(() => {
        attempts++
        if (attempts < 2) {
          return Effect.fail(new Error("simulated failure"))
        }
        return Effect.succeed({ status: "done" })
      }).pipe(Effect.flatten)

    const spec = await Effect.runPromise(
      loadWorkflowSpec(workflowsDir(), "e2e-test")
    )

    const result = await Effect.runPromiseExit(
      runWorkflow(spec, { task: "test" }, {
        executeStep: () => mockStepFn(),
        onEvent: () => Effect.void,
        workflowsDir: Path.join(workflowsDir(), "e2e-test")
      })
    )

    expect(Exit.isSuccess(result)).toBe(true)
    expect(attempts).toBe(2)
  })
})
```

- [ ] **Step 2: Run the E2E tests**

```bash
npx vitest run tests/e2e/workflows.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: All tests pass across all modules.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/workflows.test.ts
git commit -m "test: add end-to-end workflow integration tests"
```

---

### Task 19: Full CLI Wiring

**Files:**
- Modify: `src/cli/main.ts`

- [ ] **Step 1: Update src/cli/main.ts with full command routing**

```typescript
#!/usr/bin/env node
import { Effect, Exit, Console } from "effect"
import { listWorkflows } from "./commands/list.js"
import { executeRun } from "./commands/run.js"
import { getRunStatus } from "./commands/status.js"
import { getRunLogs } from "./commands/logs.js"

const args = process.argv.slice(2)

if (args.length === 0) {
  console.log("Hamilton - Workflow-based agentic execution engine")
  console.log("")
  console.log("Commands:")
  console.log("  workflow run <slug> <prompt>     Run a workflow")
  console.log("  workflow status <id>              Show run status")
  console.log("  workflow pause <id>               Pause a workflow")
  console.log("  workflow resume <id>              Resume a paused workflow")
  console.log("  workflow list                     List installed workflows")
  console.log("  workflow logs <id> [--step <id>]  View run logs")
  process.exit(0)
}

const command = args[0]

if (command === "workflow") {
  const subcommand = args[1]

  if (subcommand === "list") {
    const result = Effect.runSyncExit(listWorkflows)
    if (Exit.isSuccess(result)) {
      for (const wf of result.value) {
        console.log(`${wf.id}  v${wf.version}  ${wf.name}  (${wf.stepCount} steps, ${wf.agentCount} agents)`)
        if (wf.description) console.log(`  ${wf.description}`)
      }
    }
    process.exit(0)
  }

  if (subcommand === "status" && args[2]) {
    Effect.runPromiseExit(getRunStatus(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(JSON.stringify(result.value, null, 2))
      } else {
        console.error("Status not found:", args[2])
        process.exitCode = 1
      }
    })
    return
  }

  if (subcommand === "logs" && args[2]) {
    const stepIdx = args.indexOf("--step")
    const stepId = stepIdx !== -1 ? args[stepIdx + 1] : undefined

    Effect.runPromiseExit(getRunLogs({ runId: args[2], stepId })).then((result) => {
      if (Exit.isSuccess(result)) {
        for (const event of result.value) {
          console.log(JSON.stringify(event))
        }
      }
    })
    return
  }

  if (subcommand === "run" && args[2]) {
    const slug = args[2]
    const prompt = args.slice(3).join(" ")

    if (!prompt) {
      console.error("Usage: hamilton workflow run <slug> <prompt>")
      process.exit(1)
    }

    Effect.runPromiseExit(
      executeRun({
        workflowSlug: slug,
        prompt,
        executeStep: (params) =>
          Effect.gen(function* () {
            console.error(
              `[${params.runId}/${params.stepId}] Starting agent ${params.agentId}...`
            )
            console.error(
              `[${params.runId}/${params.stepId}] Timeout: ${params.timeoutSeconds}s`
            )

            // TODO: Replace with actual pi-agent-core call
            yield* Effect.log(
              `Would execute step ${params.stepId} with agent ${params.agentId}`
            )

            return yield* Effect.succeed({
              status: "done",
              message: `Step ${params.stepId} completed (pi-agent-core not yet integrated)`
            })
          })
      })
    ).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(`Run ID: ${result.value.runId}`)
        console.log(`Status: ${result.value.status}`)
        console.log("Step results:")
        for (const [step, status] of Object.entries(result.value.stepResults)) {
          console.log(`  ${step}: ${status}`)
        }
      } else {
        console.error("Workflow failed:", result.cause)
        process.exitCode = 1
      }
    })
    return
  }

  console.error(`Unknown subcommand: ${subcommand}`)
  process.exit(1)
}

console.error(`Unknown command: ${command}`)
process.exit(1)
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: builds without errors.

- [ ] **Step 3: Run the full test suite**

```bash
npm run test
```

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/cli/main.ts
git commit -m "feat: wire full CLI command routing (run, status, logs, list)"
```

---

### Task 20: Pi Agent Core Integration

**Files:**
- Create: `src/agent/pi-executor.ts`
- Modify: `src/cli/commands/run.ts`

- [ ] **Step 1: Create src/agent/pi-executor.ts**

```typescript
import { Effect } from "effect"

export interface PiExecutorConfig {
  prompt: string
  stepId: string
  agentId: string
  runId: string
  timeoutSeconds: number
  model?: string
  logCallback: (event: Record<string, unknown>) => Effect.Effect<void>
}

export class PiExecutionError extends Effect.TaggedError("PiExecutionError")<{
  stepId: string
  message: string
}>() {}

export function executeWithPi(
  config: PiExecutorConfig
): Effect.Effect<Record<string, unknown>, PiExecutionError> {
  return Effect.gen(function* () {
    yield* config.logCallback({
      event: "pi_session_started",
      step_id: config.stepId,
      agent_id: config.agentId
    })

    // Import pi-agent-core and execute
    // The exact API depends on @earendil-works/pi-agent-core internals.
    // For now, this is a placeholder that represents the integration contract.
    //
    // Expected pattern:
    //   import { createAgent } from "@earendil-works/pi-agent-core"
    //   const agent = createAgent({ model: config.model ?? "default" })
    //   const session = agent.startSession({ systemPrompt: config.prompt })
    //
    //   for await (const message of session.messages) {
    //     yield* config.logCallback({ event: message.type, ...message })
    //   }
    //
    //   const result = await session.result
    //   return result

    return yield* Effect.dieMessage(
      "pi-agent-core integration not yet implemented - see @earendil-works/pi-agent-core docs"
    )
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/pi-executor.ts
git commit -m "feat: add pi-agent-core integration point (placeholder)"
```

---

## Follow-Up Tasks

These tasks address gaps between the initial implementation and the full spec. They depend on external package discovery or require the foundation code from Tasks 1-20 to be in place first.

### Follow-Up A: Proper @effect/workflow Integration

**Current state:** The runner (`src/workflow/runner.ts`) implements step execution with manual `Effect.retry`/`Effect.timeout` loops. It does not use `@effect/workflow`'s `Workflow.make()`, `Activity.make()`, or `DurableDeferred`.

**What to do:**

Replace the manual step loop in `runner.ts` with `@effect/workflow`:

```typescript
import { Workflow, Activity, DurableDeferred } from "@effect/workflow"

const HamiltonWorkflow = Workflow.make({
  name: "HamiltonWorkflow",
  success: Schema.Record({ key: Schema.String, value: Schema.String }),
  error: Schema.Never,
  payload: {
    spec: Schema.Unknown,   // WorkflowSpec
    context: Schema.Record({ key: Schema.String, value: Schema.String })
  },
  idempotencyKey: ({ runId }) => runId
})

const HamiltonWorkflowLayer = HamiltonWorkflow.toLayer(
  Effect.fn(function* (payload, executionId) {
    for (const step of payload.spec.steps) {
      yield* Activity.make({
        name: `step:${step.id}`,
        error: Schema.TaggedError("StepError"),
        execute: Effect.gen(function* () {
          const attempt = yield* Activity.CurrentAttempt
          // ... execute step with pi-agent-core, stream logs, etc.
          return stepOutput
        })
      }).pipe(
        Activity.retry({ times: step.max_retries ?? 1 })
      )
    }
  })
)
```

This makes pause/resume durable (no custom state management needed), enables crash recovery via the WorkflowEngine persistence layer, and aligns with Effect's design patterns.

### Follow-Up B: Agent YAML Config File

**Current state:** Agent persona files (AGENTS.md/IDENTITY.md/SOUL.md) are loaded, but agent config (model, timeoutSeconds) is only parsed from the workflow YAML's `agents` array. There's no standalone `~/.hamilton/agents/config.yml` file.

**What to do:** Create `src/agent/config.ts` with:

```typescript
export interface AgentConfig {
  id: string
  model?: string
  timeoutSeconds?: number
  pollingModel?: string
}

export function loadAgentConfig(
  agentsDir: string
): Effect.Effect<Record<string, AgentConfig>, ConfigLoadError> {
  // Read ~/.hamilton/agents/config.yml
  // Parse and validate with Schema
  // Return map of agent-id to AgentConfig
}

export function mergeAgentConfig(
  workflowAgent: WorkflowAgent,
  globalConfig?: AgentConfig
): ResolvedAgentConfig {
  // Workflow YAML takes precedence over global config
  // model: workflowAgent.model ?? globalConfig?.model ?? "default"
  // timeoutSeconds: workflowAgent.timeoutSeconds ?? globalConfig?.timeoutSeconds ?? 300
}
```

### Follow-Up C: Pi Conversation Streaming

**Current state:** The runner writes `prompt` and `completion` events to the step JSONL log, but doesn't stream intermediate Pi messages (tool calls, tool results, LLM responses) in real-time.

**What to do:** When integrating `@earendil-works/pi-agent-core` (Task 20), stream every message from the Pi session to the step log:

```typescript
// In the activity execution:
for await (const message of session.messages) {
  yield* appendStepLog(runId, stepId, {
    event: message.type,           // "llm_call", "tool_call", "tool_result"
    step_id: stepId,
    agent_id: agentId,
    message_index: message.index,
    payload: message.payload       // full prompt, completion, tool args/results
  })
}
```

Every message type gets logged, making the full conversation history queryable via `hamilton workflow logs <id> --step triage`.

### Follow-Up D: worktrunk Worktree Management

**Current state:** The runner resolves `-worktree` and `-merge` variants in the YAML but does not actually create or manage git worktrees.

**What to do:**

1. Check `worktrunk` is installed at startup (or install it)
2. In the workflow runner, before executing steps, call `worktrunk create` to create an isolated worktree
3. Track worktree paths per run (store in run directory)
4. On completion or failure, call `worktrunk prune` to clean up

```bash
# Check installation
which worktrunk || echo "worktrunk not found"

# Create worktree
worktrunk create --branch hamilton/<run-id> --base main

# Cleanup
worktrunk prune
```

### Follow-Up E: rtk Hook Configuration

**Current state:** No rtk hook is configured.

**What to do:**

1. Create an rtk configuration file at `~/.hamilton/rtk.yml` or use `rtk init`
2. Configure the hook to reduce token usage for Pi sessions
3. Document in AGENTS.md that rtk must be installed and configured before first use

```bash
rtk init ~/.hamilton
# Edit ~/.hamilton/rtk.yml to add hooks for pi sessions
```

### Follow-Up F: CLI `workflow logs --follow`

**Current state:** The logs command reads the entire JSONL file at once. No real-time tailing.

**What to do:** Add a `--follow` flag that uses `fs.watchFile` or a polling loop to monitor the JSONL file for new lines and print them as they arrive:

```typescript
if (params.follow) {
  let lastSize = Fs.statSync(logFile).size
  while (true) {
    yield* Effect.sleep(Duration.millis(500))
    const currentSize = Fs.statSync(logFile).size
    if (currentSize > lastSize) {
      const fd = Fs.openSync(logFile, "r")
      Fs.readSync(fd, { position: lastSize })
      // print new lines
      lastSize = currentSize
    }
  }
}
```

### Follow-Up G: CLI `workflow pause` and `workflow resume`

**Current state:** These commands are listed in CLI help text but not wired as stateful operations. The runner has no pause/resume mechanism.

**What to do:** After Follow-Up A (@effect/workflow integration), use `DurableDeferred` to:

1. Create a `DurableDeferred` named `PauseSignal` at workflow start
2. `workflow pause <id>` completes the deferred, causing the activity loop to check and yield
3. `workflow resume <id>` re-creates the deferred for the next pause
4. Persist pause state in `runDir/state.json`

### Follow-Up H: Structured Logging with Effect Logger

**Current state:** The runner uses `Effect.log()` in some places but the Logger is not configured with a JSON formatter or file sink.

**What to do:** Configure Effect's Logger at startup with:
- Console sink: human-readable for interactive CLI
- File sink: structured JSON to `~/.hamilton/runs/<run-id>/events.jsonl`

```typescript
import { Logger } from "effect"

const fileLogger = Logger.json.pipe(
  Logger.addAnnotation("run_id", runId),
  Logger.addAnnotation("service", "hamilton")
)

app.pipe(
  Logger.withMinimumLogLevel("Debug"),
  Effect.provide(Logger.replace(Logger.default, fileLogger))
)
```

---
