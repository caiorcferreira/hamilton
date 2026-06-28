import { Command, Options } from "@effect/cli"
import { Console, Data, Effect, Exit, Option } from "effect"
import { Database } from "bun:sqlite"
import { loadAllGuidelines } from "../../guidelines/loader.js"
import { guidelinesDir, hamiltonHome, dbPath } from "../../paths.js"
import { createUserMemoryStore } from "../../memory/store.js"
import { ingestGuidelines, type IngestSummary } from "../../memory/guidelines.js"
import { migrate } from "../../db/migrations.js"

export class IngestError extends Data.TaggedError("IngestError")<{
  message: string
}> {}

export function formatSummary(summary: IngestSummary): string {
  const lines: string[] = [
    "Guideline ingestion complete",
    "────────────────────────────",
    `  Processed: ${summary.processed}`,
    `  Ingested:  ${summary.ingested}  (atoms created)`,
    `  Skipped:   ${summary.skipped}  (unchanged)`,
    `  Tombstoned: ${summary.tombstoned} (stale atoms replaced)`,
  ]

  if (summary.atoms.length > 0) {
    lines.push("", "New atoms:")
    for (const atom of summary.atoms) {
      lines.push(`  ${atom.guidelineName}/${atom.fileName} → ${atom.id.slice(0, 7)}... (canonical)`)
    }
  }

  if (summary.skipped > 0) {
    lines.push("", "Skipped:")
    lines.push(`  ${summary.skipped} guideline(s) unchanged since last ingestion`)
  }

  return lines.join("\n")
}

export function executeMemoryIngest(projectDir: string): Effect.Effect<string, IngestError> {
  return Effect.scoped(Effect.gen(function* (_) {
    const loadedGuidelines = yield* _(
      loadAllGuidelines(guidelinesDir()).pipe(
        Effect.mapError((e) => new IngestError({ message: String(e) }))
      )
    )

    if (loadedGuidelines.length === 0) {
      return "No matching guideline files found."
    }

    const store = yield* _(
      Effect.tryPromise({
        try: () => createUserMemoryStore(hamiltonHome()),
        catch: (e) => new IngestError({ message: String(e) })
      })
    )
    yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))

    const db = new Database(dbPath())
    migrate(db)
    yield* _(Effect.addFinalizer(() => Effect.sync(() => db.close())))

    const summary = yield* _(
      Effect.tryPromise({
        try: async () => ingestGuidelines(store.writer, db, loadedGuidelines),
        catch: (e) => new IngestError({ message: String(e) })
      })
    )

    return formatSummary(summary)
  }))
}

const guidelinesFlag = Options.boolean("guidelines").pipe(Options.optional)

export const ingestCommand = Command.make("ingest", { guidelines: guidelinesFlag }, ({ guidelines }) =>
  Effect.gen(function* () {
    if (guidelines._tag !== "Some" || !guidelines.value) {
      yield* Console.error("No ingest mode specified. Use --guidelines.")
      return
    }

    const result = yield* Effect.exit(executeMemoryIngest(process.cwd()))
    if (Exit.isFailure(result)) {
      yield* Console.error(`Ingestion failed: ${String(result.cause)}`)
      return
    }
    yield* Console.log(result.value)
  })
).pipe(Command.withDescription("Ingest files into the memory store"))