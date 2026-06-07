import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import { startMcpServer } from "../../mcp/server.js"

export const mcpCommand = Command.make("mcp", {}, () =>
  Effect.gen(function* () {
    yield* Console.error("Starting Hamilton MCP server...")
    yield* Effect.promise(() => startMcpServer())
  })
).pipe(Command.withDescription("Run Hamilton as an MCP server"))