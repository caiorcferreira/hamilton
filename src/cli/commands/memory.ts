import { Command } from "@effect/cli"
import { Console } from "effect"
import { ingestCommand } from "./memory-ingest.js"

export const memoryCommand = Command.make("memory", {}, () =>
  Console.log("Use a subcommand: ingest\n\nUse --help for details")
).pipe(
  Command.withSubcommands([ingestCommand])
)