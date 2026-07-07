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

export function taskOutputsDir(runId: string): string {
  return Path.join(runDir(runId), "task-outputs")
}

export function taskLogsDir(runId: string): string {
  return Path.join(runDir(runId), "logs")
}

export function taskLogFile(runId: string, taskId: string): string {
  return Path.join(taskLogsDir(runId), `${taskId}.jsonl`)
}

export function taskOutputFile(runId: string, taskId: string): string {
  return Path.join(taskOutputsDir(runId), `${taskId}.json`)
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

export function guidelinesDir(): string {
  return Path.join(hamiltonHome(), "guidelines")
}

export function skillsDir(): string {
  return Path.join(hamiltonHome(), "skills")
}

export function hooksDir(): string {
  return Path.join(hamiltonHome(), "hooks")
}

export function memoryDir(): string {
  return Path.join(hamiltonHome(), "memory")
}

export function userMemoryDir(): string {
  return Path.join(memoryDir(), "user")
}

export function userMemoryDBPath(): string {
  return Path.join(userMemoryDir(), "qmd.db")
}

export function templatesDir(): string {
  return Path.join(hamiltonHome(), "templates")
}

export function settingsPath(): string {
  return Path.join(hamiltonHome(), "settings.yaml")
}

export function eventsFilePath(runId: string): string {
  return Path.join(runDir(runId), "events.jsonl")
}

export function changeDir(changeId: string, projectDir?: string): string {
  const base = projectDir ?? process.cwd()
  return Path.join(base, ".hamilton", "changes", changeId)
}

export function changeMetadataFile(changeId: string, projectDir?: string): string {
  return Path.join(changeDir(changeId, projectDir), "workflow.metadata.json")
}

export function ensureHamiltonHome(): void {
  const dirs = [
    hamiltonHome(),
    agentsDir(),
    workflowsDir(),
    runsDir(),
    Path.join(hamiltonHome(), "executors", "pi", "agent"),
    Path.join(memoryDir(), "user", "canonical"),
    guidelinesDir(),
    skillsDir(),
    hooksDir(),
    templatesDir()
  ]
  for (const dir of dirs) {
    if (!Fs.existsSync(dir)) {
      Fs.mkdirSync(dir, { recursive: true })
    }
  }
}