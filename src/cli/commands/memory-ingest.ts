import { Command, Options } from "@effect/cli"
import { Console, Effect, Exit } from "effect"
import { Database } from "bun:sqlite"
import { loadGuidelines } from "../../guidelines/loader.js"
import { guidelinesDir, hamiltonHome, dbPath } from "../../paths.js"
import { createUserMemoryStore } from "../../memory/store.js"
import { ingestGuidelines, type IngestSummary } from "../../memory/guidelines.js"
import { migrate } from "../../db/migrations.js"

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
      lines.push(`  ${atom.guidelineName} → ${atom.id.slice(0, 7)}... (canonical)`)
    }
  }

  if (summary.skipped > 0) {
    lines.push("", "Skipped:")
    lines.push(`  ${summary.skipped} guideline(s) unchanged since last ingestion`)
  }

  return lines.join("\n")
}

export function executeMemoryIngest(projectDir: string): Effect.Effect<string, Error> {
  return Effect.scoped(Effect.gen(function* (_) {
    const loadedGuidelines = yield* _(
      loadGuidelines(guidelinesDir(), projectDir)
    )

    const guidelinesWithInstructions = loadedGuidelines.filter(
      (g) => g.instructions !== null && g.instructions.length > 0
    )

    if (guidelinesWithInstructions.length === 0) {
      return "No matching guideline files found."
    }

    const store = yield* _(Effect.tryPromise(() => createUserMemoryStore(hamiltonHome())))
    yield* _(Effect.addFinalizer(() => Effect.promise(() => store.close())))

    const db = new Database(dbPath())
    migrate(db)

    const summary = yield* _(
      Effect.tryPromise(async () =>
        ingestGuidelines(store.writer, db, guidelinesWithInstructions)
      )
    )

    db.close()

    return formatSummary(summary)
  }))
}

const guidelinesFlag = Options.boolean("guidelines")

export const ingestCommand = Command.make("ingest", { guidelines: guidelinesFlag }, ({ guidelines }) =>
  Effect.gen(function* () {
    if (!guidelines) {
      yield* Console.error("Specify what to ingest. Use --guidelines to ingest guideline files.")
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