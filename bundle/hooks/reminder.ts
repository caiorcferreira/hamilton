import { Effect } from "effect"

export default function on_agent_exit(ctx: { session: { isActive: () => boolean; prompt: (msg: string) => Promise<unknown> } }) {
  return Effect.gen(function* (_) {
    let sent = 0
    const MAX_REMINDERS = 2
    while (ctx.session.isActive() && sent < MAX_REMINDERS) {
      yield* _(Effect.promise(() =>
        ctx.session.prompt("REMINDER: You must call write_task_output to save your work. Call write_task_output now with the JSON task output.")
      ))
      sent++
    }
    return { action: "continue" as const, data: {} }
  })
}