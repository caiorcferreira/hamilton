import { Effect, Data, Either } from "effect"
import { executeWithPi } from "../executors/pi/pi-executor.js"
import { EventBus } from "../events/bus.js"

export class CuratorError extends Data.TaggedError("CuratorError")<{
  message: string
}> {}

export const CURATOR_SYSTEM_PROMPT = `You are the Hamilton curator agent. Your sole responsibility is to determine a change ID title from a user's request.

Given a user prompt describing a software change, extract a concise, kebab-case title (max 5 words) that summarizes the intent.

Rules:
- Use kebab-case (lowercase, hyphens between words)
- Keep it short — 1 to 5 words maximum
- Do NOT include a sequential number, prefix, or suffix
- Extract the core action or feature: "add-dark-mode", "fix-login-timeout", "refactor-auth-module"
- If the request is too vague, use a reasonable generic name like "untitled-change"

Return your answer via write_task_output.`

export function makeCuratorPrompt(userPrompt: string): string {
  return `Given this user request, what is a good kebab-case title for this change? Return exactly the title portion (no sequential number, no prefix).

Request: ${userPrompt}`
}

function fallbackTitle(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
  return `untitled-${timestamp}`
}

export function determineChangeId(
  userPrompt: string,
  runId: string
): Effect.Effect<string, CuratorError, EventBus> {
  return Effect.gen(function* (_) {
    const result = yield* _(
      executeWithPi({
        prompt: {
          systemPrompt: CURATOR_SYSTEM_PROMPT,
          taskPrompt: makeCuratorPrompt(userPrompt),
          guidelineFiles: []
        },
        taskId: `curator-${runId}`,
        agentId: "curator",
        runId,
        timeoutSeconds: 30,
        model: undefined,
        settings: {
          thinking: "off",
          retryOnTransient: false,
          compactionEnabled: false
        }
      }).pipe(Effect.either)
    )

    if (Either.isLeft(result)) {
      return fallbackTitle()
    }

    const output = result.right as Record<string, unknown>
    const changeId = output?.change_id

    if (
      changeId === undefined ||
      changeId === null ||
      changeId === "" ||
      changeId === "undefined" ||
      changeId === "null"
    ) {
      return fallbackTitle()
    }

    return String(changeId)
  })
}