import { describe, it, expect } from "vitest"
import { Effect, Exit } from "effect"
import reminderFn from "../../bundle/hooks/reminder.js"

describe("reminder hook (on_agent_exit)", () => {
  it("does nothing when session is already inactive", async () => {
    const session = {
      isActive: () => false,
      prompt: async (_msg: string) => { throw new Error("should not be called") }
    }
    const result = await Effect.runPromiseExit(reminderFn({ session }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
    }
  })

  it("sends reminders until session becomes inactive", async () => {
    const prompts: string[] = []
    let callCount = 0
    const session = {
      isActive: () => {
        callCount++
        return callCount < 3
      },
      prompt: async (msg: string) => { prompts.push(msg) }
    }
    const result = await Effect.runPromiseExit(reminderFn({ session }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
    }
    expect(prompts).toHaveLength(2)
    for (const p of prompts) {
      expect(p).toContain("REMINDER: You must call write_task_output")
    }
  })

  it("caps reminders at MAX_REMINDERS (2)", async () => {
    const prompts: string[] = []
    const session = {
      isActive: () => true,
      prompt: async (msg: string) => { prompts.push(msg) }
    }
    const result = await Effect.runPromiseExit(reminderFn({ session }))
    expect(Exit.isSuccess(result)).toBe(true)
    if (Exit.isSuccess(result)) {
      expect(result.value.action).toBe("continue")
    }
    expect(prompts).toHaveLength(2)
  })
})