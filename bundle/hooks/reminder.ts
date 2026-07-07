import { Effect } from "effect"

export default function on_agent_exit(ctx: { session: { isActive: () => boolean; prompt: (msg: string) => Promise<unknown> } }) {
  return Effect.gen(function* (_) {
    let sent = 0
    const MAX_REMINDERS = 2
    while (ctx.session.isActive() && sent < MAX_REMINDERS) {
      yield* _(Effect.promise(() =>
        ctx.session.prompt(
          "REMINDER: Your work is NOT saved and the workflow cannot continue until you call the `write_task_output` tool. " +
          "Call it now with a single JSON object that conforms to this task's output schema, using the real values you produced. " +
          "If the task is complete, fill in every field the schema requires. " +
          "If you could not finish, still call `write_task_output` — set a status that reflects that (a failed/retry status per the schema) and explain what blocked you; do not end your turn without reporting. " +
          "Do not restate the JSON in prose — call the tool."
        )
      ))
      sent++
    }
    return { action: "continue" as const, data: {} }
  })
}