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
    expect(spec.slug).toBe("bug-fix")
    expect(spec.name).toBe("Bug Fix Workflow")
    expect(spec.version).toBe(1)
    expect(spec.agents).toHaveLength(1)
    expect(spec.steps).toHaveLength(1)
    expect(spec.agents[0].role).toBe("analysis")
    expect(spec.steps[0].max_retries).toBe(4)
  })

  it("should reject a workflow with no agents", () => {
    const raw = { slug: "bad", name: "Bad", version: 1, agents: [], steps: [] }
    expect(() => decode(raw)).toThrow()
  })

  it("should reject an invalid agent role", () => {
    const raw = {
      slug: "bad", name: "Bad", version: 1,
      agents: [{ slug: "a", role: "invalid", workspace: { baseDir: "x", files: {} } }],
      steps: []
    }
    expect(() => decode(raw)).toThrow()
  })

  it("should reject a missing step agent reference", () => {
    const raw = {
      slug: "bad", name: "Bad", version: 1,
      agents: [{ slug: "a", role: "coding", workspace: { baseDir: "x", files: {} } }],
      steps: [{ slug: "s1", agent: "b", input: "x" }]
    }
    expect(() => decode(raw)).toThrow()
  })
})