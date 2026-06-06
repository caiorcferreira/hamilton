#!/usr/bin/env node
import { Effect, Exit } from "effect"
import { listWorkflows } from "./commands/list.js"
import { executeRun } from "./commands/run.js"
import { getRunStatus, formatStatus } from "./commands/status.js"
import { getRunLogs, followLogs } from "./commands/logs.js"
import { verifyRtk } from "./commands/rtk.js"
import { installWorkflow, uninstallWorkflow, installAllWorkflows } from "./commands/install.js"
import { pauseWorkflow } from "./commands/pause.js"
import { resumeWorkflow } from "./commands/resume.js"
import { initHamilton } from "./commands/init.js"

const args = process.argv.slice(2)

if (args.length === 0) {
  console.log("Hamilton - Workflow-based agentic execution engine")
  console.log("")
  console.log("Commands:")
  console.log("  init [--force]                       Bootstrap Hamilton directories and install workflows")
  console.log("  workflow run <slug> <prompt>       Run a workflow")
  console.log("  workflow status <id>                Show run status")
  console.log("  workflow pause <id>                Pause a running workflow")
  console.log("  workflow resume <id>               Resume a paused workflow")
  console.log("  workflow list                      List installed workflows")
  console.log("  workflow logs <id> [--step <id>] [--follow]   View run logs")
  console.log("  workflow install <id> [--force]       Install a workflow")
  console.log("  workflow install --all [--force]      Install all bundled workflows")
  console.log("  workflow uninstall <id>              Remove a workflow")
  console.log("  rtk verify                          Check rtk installation")
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
    void Effect.runPromiseExit(getRunStatus(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(formatStatus(result.value))
      } else {
        console.error("Status not found:", args[2])
        process.exitCode = 1
      }
    })
  } else if (subcommand === "logs" && args[2]) {
    const stepIdx = args.indexOf("--step")
    const stepId = stepIdx !== -1 ? args[stepIdx + 1] : undefined
    const follow = args.includes("--follow")

    if (follow) {
      const controller = followLogs({ runId: args[2] })
      process.on("SIGINT", () => { controller.stop(); process.exit(0) })
    } else {
      void Effect.runPromiseExit(getRunLogs({ runId: args[2], stepId })).then((result) => {
        if (Exit.isSuccess(result)) {
          for (const event of result.value) {
            console.log(JSON.stringify(event))
          }
        }
      })
    }
  } else if (subcommand === "run" && args[2]) {
    const slug = args[2]
    const prompt = args.slice(3).join(" ")

    if (!prompt) {
      console.error("Usage: hamilton workflow run <slug> <prompt>")
      process.exit(1)
    }

    void Effect.runPromiseExit(
      executeRun({ workflowSlug: slug, prompt })
    ).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(`Run ID: ${result.value.runId}`)
        console.log(`Status: ${result.value.status}`)
        console.log("Step results:")
        for (const [step, status] of Object.entries(result.value.stepResults)) {
          console.log(`  ${step}: ${status}`)
        }
      } else {
        console.error("Workflow failed:", String(result.cause))
        process.exitCode = 1
      }
    })
  } else if (subcommand === "pause" && args[2]) {
    void Effect.runPromiseExit(pauseWorkflow(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(result.value)
      } else {
        console.error("Pause failed:", String(result.cause))
        process.exitCode = 1
      }
    })
  } else if (subcommand === "resume" && args[2]) {
    void Effect.runPromiseExit(resumeWorkflow(args[2])).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(result.value)
      } else {
        console.error("Resume failed:", String(result.cause))
        process.exitCode = 1
      }
    })
  } else if (subcommand === "install") {
    const allFlag = args.includes("--all")
    const forceFlag = args.includes("--force")

    if (allFlag) {
      void Effect.runPromiseExit(installAllWorkflows({ force: forceFlag })).then((result) => {
        if (Exit.isSuccess(result)) {
          for (const id of result.value) {
            console.log(`Installed: ${id}`)
          }
        } else {
          console.error("Install failed:", String(result.cause))
          process.exitCode = 1
        }
      })
    } else {
      const workflowId = args[2]
      if (!workflowId || workflowId.startsWith("--")) {
        console.error("Usage: hamilton workflow install <id> [--force]")
        process.exit(1)
      }
      void Effect.runPromiseExit(installWorkflow(workflowId, { force: forceFlag })).then((result) => {
        if (Exit.isSuccess(result)) {
          console.log(`Installed: ${workflowId}`)
        } else {
          console.error("Install failed:", String(result.cause))
          process.exitCode = 1
        }
      })
    }
  } else if (subcommand === "uninstall" && args[2]) {
    const workflowId = args[2]
    void Effect.runPromiseExit(uninstallWorkflow(workflowId)).then((result) => {
      if (Exit.isSuccess(result)) {
        console.log(`Uninstalled: ${workflowId}`)
      } else {
        console.error("Uninstall failed:", String(result.cause))
        process.exitCode = 1
      }
    })
  } else if (subcommand) {
    console.error(`Unknown subcommand: ${subcommand}`)
    process.exit(1)
  }
} else if (command === "init") {
  const forceFlag = args.includes("--force")
  void Effect.runPromiseExit(initHamilton({ force: forceFlag })).then((result) => {
    if (Exit.isSuccess(result)) {
      console.log("Hamilton initialized successfully.")
      console.log(`Installed ${result.value.length} workflows.`)
      for (const id of result.value) {
        console.log(`  ${id}`)
      }
      console.log("")
      console.log("Directories created:")
      console.log("  ~/.hamilton/agents/")
      console.log("  ~/.hamilton/workflows/")
      console.log("  ~/.hamilton/runs/")
      console.log("  ~/.hamilton/executors/pi/agent/")
    } else {
      console.error("Init failed:", String(result.cause))
      process.exitCode = 1
    }
  })
} else if (command === "rtk") {
  const subcommand = args[1]
  if (subcommand === "verify") {
    void Effect.runPromiseExit(verifyRtk).then((result) => {
      if (Exit.isSuccess(result)) {
        const s = result.value
        if (s.installed) {
          console.log(`rtk ${s.version} found at ${s.path}`)
          console.log(`Status: ${s.message}`)
        } else {
          console.log(`rtk not found in PATH`)
          console.log(`Status: MISSING — install with: npm install -g @rtk-ai/rtk`)
        }
      }
    })
  } else {
    console.log("rtk commands:")
    console.log("  rtk verify    Check if rtk is installed and meets minimum version")
    process.exit(0)
  }
} else if (command) {
  console.error(`Unknown command: ${command}`)
  process.exit(1)
}