#!/usr/bin/env bun
import { Command } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect, Console } from "effect"
import { EventBusLive } from "../events/bus.js"
import { reconcileSettingsToPi } from "../executors/pi/reconcile.js"
import { setupCommand } from "./commands/setup.js"
import { doctorCommand } from "./commands/doctor.js"
import { runCommand } from "./commands/run.js"
import { statusCommand } from "./commands/status.js"
import { listCommand } from "./commands/list.js"
import { runsCommand } from "./commands/runs.js"
import { logsCommand } from "./commands/logs.js"
import { pauseCommand } from "./commands/pause.js"
import { resumeCommand } from "./commands/resume.js"
import { installCommand } from "./commands/install.js"
import { uninstallCommand } from "./commands/uninstall.js"
import { mcpCommand } from "./commands/mcp.js"
import { telemetryCommand } from "./commands/telemetry.js"
import { memoryCommand } from "./commands/memory.js"

const workflowCommand = Command.make("workflow", {}, () =>
  Console.log("Hamilton workflows — use a subcommand or --help")
).pipe(
  Command.withSubcommands([
    runCommand,
    listCommand,
    runsCommand,
    statusCommand,
    logsCommand,
    pauseCommand,
    resumeCommand,
    installCommand,
    uninstallCommand
  ])
)

const rootCommand = Command.make("hamilton", {}, () =>
  Console.log("Hamilton - Workflow-based agentic execution engine\n\nUse --help for available commands")
).pipe(
  Command.withSubcommands([setupCommand, doctorCommand, workflowCommand, mcpCommand, telemetryCommand, memoryCommand])
)

const cli = Command.run(rootCommand, {
  name: "Hamilton",
  version: "0.1.0"
})

const isSetupCommand = process.argv.length > 2 && process.argv[2] === "setup"

const program = isSetupCommand
  ? cli(process.argv)
  : Effect.zipRight(Effect.sync(() => reconcileSettingsToPi()), cli(process.argv))

program.pipe(
  Effect.provide(BunContext.layer),
  Effect.provide(EventBusLive),
  BunRuntime.runMain
)