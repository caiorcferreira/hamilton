#!/usr/bin/env bun
import { Command } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { setupCommand } from "./commands/setup.js";
import { workbenchCommand } from "./commands/workbench.js";

const rootCommand = Command.make("hamilton", {}, () =>
  Console.log(
    "Hamilton - Template setup CLI\n\nUse --help for available commands",
  ),
).pipe(Command.withSubcommands([setupCommand, workbenchCommand]));

const cli = Command.run(rootCommand, {
  name: "Hamilton",
  version: "0.3.0",
});

cli(process.argv).pipe(
  Effect.catchAll(() =>
    Effect.sync(() => {
      process.exitCode = 2;
    }),
  ),
  Effect.provide(BunContext.layer),
  BunRuntime.runMain,
);
