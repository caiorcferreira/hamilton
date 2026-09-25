import { Command, Options } from "@effect/cli";
import { Console, Data, Effect, Exit } from "effect";
import { SetupService, type SetupResult } from "../setup.service.js";
import { createSetupRuntime } from "../setup-runtime.js";

class SetupFailure extends Data.TaggedError("SetupError")<{
  message: string;
}> {}

export function setupHamilton(_options?: {
  force?: boolean;
}): Effect.Effect<SetupResult, SetupFailure> {
  const runtime = createSetupRuntime();
  const service = new SetupService(
    runtime.fileSystemHome,
    runtime.bundleLocator,
  );
  return Effect.try({
    try: () => service.setup(),
    catch: (error) =>
      new SetupFailure({
        message: error instanceof Error ? error.message : String(error),
      }),
  });
}

const force = Options.boolean("force");

export const setupCommand = Command.make("setup", { force }, ({ force }) =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(setupHamilton({ force }));
    if (Exit.isFailure(result)) {
      yield* Console.error(`Setup failed: ${String(result.cause)}`);
      return;
    }
    const { templates } = Exit.getOrElse(
      result,
      () => ({ templates: [] }) as SetupResult,
    );
    yield* Console.log("Hamilton set up successfully.");
    yield* Console.log(`Installed ${templates.length} templates.`);
    for (const name of templates) {
      yield* Console.log(`  ${name}`);
    }
  }),
).pipe(
  Command.withDescription(
    "Bootstrap Hamilton directories and install templates",
  ),
);
