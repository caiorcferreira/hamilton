import { Effect, PubSub, Stream, Context, Layer, Scope } from "effect"

type EventBusService = {
  readonly publish: (event: Event) => Effect.Effect<void>
  readonly subscribeAll: Stream.Stream<Event>
  readonly subscribeTo: <T extends Event["_tag"]>(
    tag: T
  ) => Stream.Stream<Extract<Event, { readonly _tag: T }>>
}

export type Event =
  | { readonly _tag: "WorkflowStarted"; readonly runId: string }
  | { readonly _tag: "StepStarted"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepCompleted"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepFailed"; readonly runId: string; readonly stepId: string; readonly message: string }
  | { readonly _tag: "StepTimedOut"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepRetrying"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "StepPaused"; readonly runId: string; readonly stepId: string }
  | { readonly _tag: "WorkflowCompleted"; readonly runId: string; readonly message?: string }
  | { readonly _tag: "LlmMessage"; readonly runId: string; readonly stepId: string; readonly text: string }
  | { readonly _tag: "ToolCall"; readonly runId: string; readonly stepId: string; readonly tool: string; readonly input: unknown }
  | { readonly _tag: "ToolResult"; readonly runId: string; readonly stepId: string; readonly tool: string; readonly isError: boolean }
  | { readonly _tag: "TurnEnd"; readonly runId: string; readonly stepId: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "TokenUsage"; readonly runId: string; readonly stepId: string; readonly tokensIn: number; readonly tokensOut: number }
  | { readonly _tag: "PromptBuilt"; readonly runId: string; readonly stepId: string; readonly systemPrompt: string; readonly taskPrompt: string }

export type EventBusSubscriptionOperations = {
  readonly subscribeAll: Stream.Stream<Event>
  readonly subscribeTo: <T extends Event["_tag"]>(
    tag: T
  ) => Stream.Stream<Extract<Event, { readonly _tag: T }>>
}

export class EventBus extends Context.Tag("EventBus")<
  EventBus,
  EventBusService
>() {}

export const EventBusLive = Layer.scoped(
  EventBus,
  Effect.gen(function* (_) {
    const pubsub = yield* _(PubSub.unbounded<Event>())

    return {
      publish: (event: Event) => PubSub.publish(pubsub, event),
      subscribeAll: Stream.fromPubSub(pubsub),
      subscribeTo: <T extends Event["_tag"]>(tag: T) =>
        Stream.fromPubSub(pubsub).pipe(
          Stream.filter(
            (event): event is Extract<Event, { readonly _tag: T }> =>
              event._tag === tag
          )
        )
    } as EventBusService
  })
)

export type SubscriptionSelector<E extends Event> =
  (bus: EventBusSubscriptionOperations) => Stream.Stream<E>

export const createSubscriber = <E extends Event>(
  select: SubscriptionSelector<E>,
  handler: (event: E) => Effect.Effect<void>
): Effect.Effect<void, never, Scope.Scope | EventBus> =>
  Effect.gen(function* (_) {
    const bus = yield* _(EventBus)
    yield* _(Effect.forkScoped(
      select(bus).pipe(
        Stream.tap((event) => handler(event).pipe(Effect.catchAll(() => Effect.void))),
        Stream.runDrain
      )
    ))
  })