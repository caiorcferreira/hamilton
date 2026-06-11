import { Command, Args } from "@effect/cli"
import { Console, Effect, Option } from "effect"
import { Database } from "bun:sqlite"
import { dbPath } from "../../paths.js"
import { migrate } from "../../db/migrations.js"
import { loadTelemetryConfig, saveTelemetryConfig } from "../../telemetry/config.js"
import { makeTelemetryStatusRepository } from "../../telemetry/repositories/telemetry-status-repository.js"
import { green, red, dim, bold } from "../formatting/colors.js"

function openTelemetryDb(): Effect.Effect<Database, Error> {
  return Effect.try({
    try: () => {
      const dp = dbPath()
      const db = new Database(dp)
      db.run("PRAGMA journal_mode = WAL")
      migrate(db)
      return db
    },
    catch: (e) => new Error("Failed to open telemetry DB: " + String(e))
  })
}

export const telemetryStatus: Effect.Effect<void, Error> = Effect.gen(function* (_) {
  const config = yield* _(loadTelemetryConfig)
  const db = yield* _(openTelemetryDb())
  const repo = makeTelemetryStatusRepository(db, () => config)
  const status = yield* _(repo.getStatus())

  db.close()

  if (status.enabled) {
    yield* Console.log(green("Telemetry: enabled"))
  } else {
    yield* Console.log(red("Telemetry: disabled (all stores)"))
  }

  const fileLabel = config.disableStores.has("file") ? red("file disabled") : green("file enabled")
  const dbLabel = config.disableStores.has("db") ? red("db disabled") : green("db enabled")
  yield* Console.log("  Stores: " + fileLabel + " | " + dbLabel)
  yield* Console.log("  DB: " + dim(dbPath()))
  yield* Console.log(
    "  Runs: " + bold(String(status.runCount)) +
    " | Turns: " + bold(String(status.turnCount)) +
    " | Tool calls: " + bold(String(status.toolCallCount)) +
    " | Provider requests: " + bold(String(status.providerRequestCount))
  )
})

export const telemetryEnable: (store?: string) => Effect.Effect<void, Error> = (store) =>
  Effect.gen(function* (_) {
    const config = yield* _(loadTelemetryConfig)
    if (!store) {
      config.disableStores.clear()
    } else if (store === "file" || store === "db") {
      config.disableStores.delete(store)
    }
    yield* _(saveTelemetryConfig(config))
    yield* Console.log(green("Telemetry store(s) enabled"))
  })

export const telemetryDisable: (store: "file" | "db") => Effect.Effect<void, Error> = (store) =>
  Effect.gen(function* (_) {
    const config = yield* _(loadTelemetryConfig)
    config.disableStores.add(store)
    yield* _(saveTelemetryConfig(config))
    yield* Console.log("Telemetry store " + red(store) + " disabled")
  })

const storeArg = Args.text({ name: "store" }).pipe(Args.optional)

const statusCommand = Command.make("status", {}, () => telemetryStatus)

const enableCommand = Command.make("enable", { store: storeArg }, ({ store }) =>
  telemetryEnable(Option.getOrUndefined(store))
)

const disableCommand = Command.make("disable", { store: Args.text({ name: "store" }) }, ({ store }) =>
  telemetryDisable(store as "file" | "db")
)

export const telemetryCommand = Command.make("telemetry", {}, () =>
  Console.log("Hamilton telemetry — use a subcommand or --help")
).pipe(
  Command.withSubcommands([statusCommand, enableCommand, disableCommand])
)
