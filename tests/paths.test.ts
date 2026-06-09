import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as Path from "node:path"
import {
  hamiltonHome,
  workflowsDir,
  agentsDir,
  runsDir,
  runDir,
  stepOutputsDir,
  stepLogsDir,
  stepLogFile,
  stepOutputFile,
  inputFile,
  summaryFile,
  progressDir,
  progressFile,
  instructionDir
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

  it("stepOutputsDir returns ~/.hamilton/runs/<runId>/step-outputs", () => {
    expect(stepOutputsDir("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123/step-outputs")
  })

  it("stepLogsDir returns ~/.hamilton/runs/<runId>/logs", () => {
    expect(stepLogsDir("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123/logs")
  })

  it("stepLogFile returns ~/.hamilton/runs/<runId>/logs/<stepId>.jsonl", () => {
    expect(stepLogFile("abc-123", "triage")).toBe(
      "/tmp/test-home/.hamilton/runs/abc-123/logs/triage.jsonl"
    )
  })

  it("stepOutputFile returns ~/.hamilton/runs/<runId>/step-outputs/<stepId>.json", () => {
    expect(stepOutputFile("abc-123", "triage")).toBe(
      "/tmp/test-home/.hamilton/runs/abc-123/step-outputs/triage.json"
    )
  })

  it("inputFile returns ~/.hamilton/runs/<runId>/input.json", () => {
    expect(inputFile("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123/input.json")
  })

  it("summaryFile returns ~/.hamilton/runs/<runId>/summary.json", () => {
    expect(summaryFile("abc-123")).toBe("/tmp/test-home/.hamilton/runs/abc-123/summary.json")
  })

  it("progressDir returns .hamilton/workflows relative to cwd", () => {
    const cwdSpy = process.cwd
    try {
      (process as any).cwd = () => "/fake/project"
      expect(progressDir()).toBe("/fake/project/.hamilton/workflows")
    } finally {
      process.cwd = cwdSpy
    }
  })

  it("progressFile returns dated filename", () => {
    const origDate = globalThis.Date
    const origCwd = process.cwd
    try {
      (globalThis as any).Date = class extends origDate {
        toISOString() { return "2026-06-09T00:00:00.000Z" }
      }
      try {
        (process as any).cwd = () => "/fake/project"
        expect(progressFile()).toBe("/fake/project/.hamilton/workflows/progress-2026-06-09.txt")
      } finally {
        process.cwd = origCwd
      }
    } finally {
      globalThis.Date = origDate
    }
  })

  it("instructionDir returns ~/.hamilton/instruction", () => {
    expect(instructionDir()).toBe("/tmp/test-home/.hamilton/instruction")
  })
})