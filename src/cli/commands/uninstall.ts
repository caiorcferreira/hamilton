import { Command, Args } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import { uninstallWorkflow } from "./install-logic.js"

const workflowId = Args.text({ name: "id" })

export const uninstallCommand = Command.make("uninstall", { id: workflowId }, ({ id }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(uninstallWorkflow(id))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Uninstall failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(`Uninstalled: ${id}`)
  })
).pipe(Command.withDescription("Remove a workflow"))