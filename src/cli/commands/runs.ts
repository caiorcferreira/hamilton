import { Command, Options } from "@effect/cli"
import { Console, Effect } from "effect"
import { openDb } from "../../workflow/state.js"
import { listRuns, RunSummary } from "../../db/queries.js"
import { renderTable, Column } from "../formatting/table.js"
import { statusColor, dim } from "../formatting/colors.js"

const statusOpt = Options.choice("status", ["running", "completed", "failed", "paused"] as const).pipe(Options.optional)
const limitOpt = Options.integer("limit").pipe(Options.withDefault(20))

export const listRunHistory = (opts?: { status?: string; limit?: number }) =>
  Effect.gen(function* () {
    const db = yield* openDb()
    const runs = listRuns(db, { status: opts?.status, limit: opts?.limit ?? 20 })
    db.close()
    return runs
  })

const runColumns: Column<RunSummary>[] = [
  { header: "RUN ID", width: 22, render: (r) => r.id.slice(0, 22) },
  { header: "WORKFLOW", width: 16, render: (r) => r.workflow_id },
  { header: "STATUS", width: 10, render: (r) => statusColor(r.status)(r.status) },
  { header: "STARTED", width: 20, render: (r) => dim(r.started_at.slice(0, 19)) },
  { header: "STEP", width: 12, render: (r) => r.current_step ?? "-" }
]

export const runsCommand = Command.make("runs", { status: statusOpt, limit: limitOpt }, ({ status, limit }) =>
  Effect.gen(function* () {
    const opts = {
      status: status._tag === "Some" ? status.value : undefined,
      limit
    }
    const runs = yield* listRunHistory(opts)
    if (runs.length === 0) {
      yield* Console.log("No runs found.")
    } else {
      yield* Console.log(renderTable(runs, runColumns))
    }
  })
).pipe(Command.withDescription("List run history"))