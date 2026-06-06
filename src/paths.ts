import * as Path from "node:path"
import * as Os from "node:os"
import * as Fs from "node:fs"

export function hamiltonHome(): string {
  const home = process.env.HOME ?? Os.homedir()
  return Path.join(home, ".hamilton")
}

export function workflowsDir(): string {
  return Path.join(hamiltonHome(), "workflows")
}

export function agentsDir(): string {
  return Path.join(hamiltonHome(), "agents")
}

export function runsDir(): string {
  return Path.join(hamiltonHome(), "runs")
}

export function runDir(runId: string): string {
  return Path.join(runsDir(), runId)
}

export function stepOutputsDir(runId: string): string {
  return Path.join(runDir(runId), "step-outputs")
}

export function stepLogsDir(runId: string): string {
  return Path.join(runDir(runId), "logs")
}

export function stepLogFile(runId: string, stepId: string): string {
  return Path.join(stepLogsDir(runId), `${stepId}.jsonl`)
}

export function stepOutputFile(runId: string, stepId: string): string {
  return Path.join(stepOutputsDir(runId), `${stepId}.json`)
}

export function inputFile(runId: string): string {
  return Path.join(runDir(runId), "input.json")
}

export function summaryFile(runId: string): string {
  return Path.join(runDir(runId), "summary.json")
}

export function dbPath(): string {
  return Path.join(hamiltonHome(), "hamilton.db")
}

export function piAgentDir(): string {
  return Path.join(hamiltonHome(), "executors", "pi", "agent")
}

export function eventsFilePath(runId: string): string {
  return Path.join(runDir(runId), "events.jsonl")
}

export function ensureHamiltonHome(): void {
  const dirs = [
    hamiltonHome(),
    agentsDir(),
    workflowsDir(),
    runsDir(),
    piAgentDir()
  ]
  for (const dir of dirs) {
    if (!Fs.existsSync(dir)) {
      Fs.mkdirSync(dir, { recursive: true })
    }
  }
}