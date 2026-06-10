import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import { Effect } from "effect"
import { loadWorkflowSpec } from "../workflow/loader.js"
import type { WorkflowDescriptor } from "../workflow/agent-registry.js"
import { resolvePersona } from "../prompts/persona.js"
import { openDb } from "../workflow/state.js"
import { getRunStatus as getDbRunStatus, listRuns } from "../db/queries.js"
import { getRunLogs } from "../cli/commands/logs.js"
import { pauseWorkflow } from "../cli/commands/pause.js"
import { resumeWorkflow } from "../cli/commands/resume.js"
import { EventBusLive } from "../events/bus.js"
import { workflowsDir, hamiltonHome } from "../paths.js"
import * as Fs from "node:fs"
import * as Path from "node:path"

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] }
}

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true }
}

function effectToPromise<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.mapError((e) => e instanceof Error ? e : new Error(String(e)))
    )
  )
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "hamilton",
    version: "0.1.0"
  })

  server.tool("run_workflow", "Run a Hamilton workflow", {
    slug: z.string().describe("Workflow slug"),
    prompt: z.string().describe("Task prompt")
  }, async ({ slug, prompt }) => {
    try {
      const { executeRun } = await import("../cli/commands/run.js")
      const result = await effectToPromise(
        Effect.scoped(executeRun({ workflowSlug: slug as string, prompt: prompt as string })).pipe(Effect.provide(EventBusLive))
      )
      return textResult(JSON.stringify(result, null, 2))
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("get_status", "Get the status of a workflow run", {
    run_id: z.string().describe("Run ID")
  }, async ({ run_id }) => {
    try {
      const db = await effectToPromise(openDb())
      const status = getDbRunStatus(db, run_id as string)
      db.close()
      if (!status) return errorResult(`Run not found: ${run_id}`)
      return textResult(JSON.stringify(status, null, 2))
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("pause_workflow", "Pause a running workflow", {
    run_id: z.string().describe("Run ID to pause")
  }, async ({ run_id }) => {
    try {
      const result = await effectToPromise(pauseWorkflow(run_id as string))
      return textResult(result)
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("resume_workflow", "Resume a paused workflow", {
    run_id: z.string().describe("Run ID to resume")
  }, async ({ run_id }) => {
    try {
      const result = await effectToPromise(resumeWorkflow(run_id as string))
      return textResult(result)
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("list_workflows", "List installed workflows", {}, async () => {
    try {
      const dir = workflowsDir()
      if (!Fs.existsSync(dir)) return textResult("[]")
      const entries = Fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
      const sharedAgentsDir = Path.join(hamiltonHome(), "agents")
      const workflowEntries: WorkflowDescriptor[] = entries.map((name) => ({ name, dir: Path.join(dir, name) }))
      const results = []
      for (const slug of entries) {
        const spec = await Effect.runPromise(Effect.option(loadWorkflowSpec(dir, slug, sharedAgentsDir, workflowEntries)))
        if (spec._tag === "Some") {
          results.push({ name: spec.value.metadata.name, version: spec.value.metadata.version, tasks: spec.value.spec.tasks.length, agents: spec.value.agentRegistry.size })
        }
      }
      return textResult(JSON.stringify(results, null, 2))
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("list_agents", "List available agent personas", {}, async () => {
    try {
      const dir = Path.join(hamiltonHome(), "agents", "shared")
      if (!Fs.existsSync(dir)) return textResult("[]")
      const entries = Fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
      const results = []
      for (const slug of entries) {
        const agentsPath = Path.join(dir, slug, "AGENTS.md")
        if (!Fs.existsSync(agentsPath)) continue
        const persona = await Effect.runPromise(Effect.option(
          resolvePersona(
            { agent: agentsPath, identity: Path.join(dir, slug, "IDENTITY.md"), soul: Path.join(dir, slug, "SOUL.md") },
            dir
          )
        ))
        if (persona._tag === "Some") {
          results.push({ slug, identity: persona.value.identity, soul: persona.value.soul })
        }
      }
      return textResult(JSON.stringify(results, null, 2))
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e))
    }
  })

  server.tool("get_logs", "Get logs for a workflow run", {
    run_id: z.string().describe("Run ID"),
    step_id: z.string().optional().describe("Optional step ID to filter")
  }, async ({ run_id, step_id }) => {
    try {
      const result = await effectToPromise(getRunLogs({ runId: run_id, stepId: step_id }))
      return textResult(JSON.stringify(result, null, 2))
    } catch (e) {
      return errorResult(e instanceof Error ? e.message : String(e))
    }
  })

  server.resource("workflow-definitions", "hamilton://workflows", async () => {
    try {
      const dir = workflowsDir()
      if (!Fs.existsSync(dir)) return { contents: [] }
      const entries = Fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
      const contents = []
      for (const slug of entries) {
        const ymlPath = Path.join(dir, slug, "workflow.yml")
        if (Fs.existsSync(ymlPath)) {
          const content = Fs.readFileSync(ymlPath, "utf-8")
          contents.push({
            uri: `hamilton://workflows/${slug}`,
            mimeType: "text/yaml",
            text: content
          })
        }
      }
      return { contents }
    } catch {
      return { contents: [] }
    }
  })

  server.resource("agent-personas", "hamilton://agents", async () => {
    try {
      const dir = Path.join(hamiltonHome(), "agents", "shared")
      if (!Fs.existsSync(dir)) return { contents: [] }
      const entries = Fs.readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
      const contents = []
      for (const slug of entries) {
        const agentsPath = Path.join(dir, slug, "AGENTS.md")
        if (Fs.existsSync(agentsPath)) {
          const content = Fs.readFileSync(agentsPath, "utf-8")
          contents.push({
            uri: `hamilton://agents/${slug}`,
            mimeType: "text/markdown",
            text: content
          })
        }
      }
      return { contents }
    } catch {
      return { contents: [] }
    }
  })

  return server
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}