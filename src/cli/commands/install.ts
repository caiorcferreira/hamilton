import { Command, Args, Options } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import { installWorkflow, installAllWorkflows } from "./install-logic.js"

const workflowId = Args.text({ name: "id" }).pipe(Args.optional)
const allFlag = Options.boolean("all")
const forceFlag = Options.boolean("force")

export const installCommand = Command.make("install", { id: workflowId, all: allFlag, force: forceFlag }, ({ id, all, force }) =>
  Effect.gen(function* () {
    if (all) {
      const result = yield* Effect.exit(installAllWorkflows({ force }))
      if (Exit.isFailure(result)) {
        yield* Console.error(`Install failed: ${String(result.cause)}`)
        return
      }
      for (const wid of result.value) {
        yield* Console.log(`Installed: ${wid}`)
      }
      return
    }

    if (id._tag === "None") {
      yield* Console.error("Usage: hamilton workflow install <id> [--force] | --all [--force]")
      return
    }

    const result = yield* Effect.exit(installWorkflow(id.value, { force }))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Install failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Installed: ${id.value}`)
  })
).pipe(Command.withDescription("Install a workflow"))