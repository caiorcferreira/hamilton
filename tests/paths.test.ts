import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Path from "node:path"
import {
  hamiltonHome,
  workflowsDir,
  agentsDir,
  runsDir,
  runDir,
  taskOutputsDir,
  taskLogsDir,
  taskLogFile,
  taskOutputFile,
  inputFile,
  summaryFile,
  guidelinesDir,
  settingsPath,
  skillsDir
} from "../src/paths.js"

describe("paths", () => {
  const originalHome = process.env.HOME

  beforeEach(() => {
    process.env.HOME = "/tmp/test-home"
  })

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
  })

  it("hamiltonHome returns ~/.hamilton", () => {
    expect(hamiltonHome()).toBe("/tmp/test-home/.hamilton")
  })

  it("workflowsDir returns ~/.hamilton/workflows", () => {
    expect(workflowsDir()).toBe("/tmp/test-home/.hamilton/workflows")
  })

  it("agentsDir returns ~/.hamilton/agents", () => {
    expect(agentsDir()).toBe("/tmp/test-home/.hamilton/agents")
  })

  it("runsDir returns ~/.hamilton/runs", () => {
    expect(runsDir()).toBe("/tmp/test-home/.hamilton/runs")
  })

  it("runDir returns ~/.hamilton/runs/<runId>", () => {
    expect(runDir("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123")
  })

  it("taskOutputsDir returns ~/.hamilton/runs/<runId>/task-outputs", () => {
    expect(taskOutputsDir("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123/task-outputs")
  })

  it("taskLogsDir returns ~/.hamilton/runs/<runId>/logs", () => {
    expect(taskLogsDir("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123/logs")
  })

  it("taskLogFile returns ~/.hamilton/runs/<runId>/logs/<taskId>.jsonl", () => {
    expect(taskLogFile("abc-123", "triage")).toBe(
      "/tmp/test-home/.hamilton/runs/abc-123/logs/triage.jsonl"
    )
  })

  it("taskOutputFile returns ~/.hamilton/runs/<runId>/task-outputs/<taskId>.json", () => {
    expect(taskOutputFile("abc-123", "triage")).toBe(
      "/tmp/test-home/.hamilton/runs/abc-123/task-outputs/triage.json"
    )
  })

  it("inputFile returns ~/.hamilton/runs/<runId>/input.json", () => {
    expect(inputFile("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123/input.json")
  })

  it("summaryFile returns ~/.hamilton/runs/<runId>/summary.json", () => {
    expect(summaryFile("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123/summary.json")
  })

  it("guidelinesDir returns ~/.hamilton/guidelines", () => {
    expect(guidelinesDir()).toBe("/tmp/test-home/.hamilton/guidelines")
  })

  it("settingsPath returns ~/.hamilton/settings.yaml", () => {
    expect(settingsPath()).toBe("/tmp/test-home/.hamilton/settings.yaml")
  })

  it("skillsDir returns path under hamilton home", () => {
    const result = skillsDir()
    expect(result).toBe(Path.join(hamiltonHome(), "skills"))
  })
})