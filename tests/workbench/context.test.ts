import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Path from "node:path";
import {
  context,
  createContextRuntime,
  renderContextResult,
} from "../../src/workbench/context.js";
import { cleanupRepos, makeChangeDir, makeRepo, write } from "./helpers.js";

const proposal = `# Proposal: Add auth

| Route unit | .hamilton/maps/auth/route.md — unit 2 |
`;
const plan = `# Plan: add auth

## Tasks

### Task 1: Add the auth | session

### Task 2: Wire it into the router
`;
const progress = `# Progress: add auth

| Task | Status | Progress |
|---|---|---|
| Task 1: Add the auth \\| session | done | [details](tasks/task-1/progress.md) |
| Task 2: Wire it into the router | blocked | [details](tasks/task-2/progress.md) |
`;
const taskProgress = (
  task: number,
  title: string,
  outcome = "done",
) => `# Task Progress: Task ${task} — ${title}

## Attempt 1 — 2026-09-12

- Outcome: ${outcome}
`;
const splitFiles = {
  "proposal.md": proposal,
  "plan.md": plan,
  "progress.md": progress,
  "tasks/task-1/progress.md": taskProgress(1, "Add the auth | session"),
  "tasks/task-2/progress.md": taskProgress(
    2,
    "Wire it into the router",
    "blocked",
  ),
  "requirements/auth.md": "# Auth\n",
};

const seed = (
  repository: string,
  slug: string,
  files: Record<string, string>,
) => {
  const directory = makeChangeDir(repository, slug);
  for (const [file, content] of Object.entries(files))
    write(directory, file, content);
  return directory;
};

afterEach(cleanupRepos);

describe("change context", () => {
  it("renders a deterministic split inventory and task standing", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "add-auth", splitFiles);
    const first = await context({ changeDir: directory });
    const second = await context({ changeDir: directory });

    expect(first.exitCode).toBe(0);
    expect(first.stdout).toBe(second.stdout);
    expect(first.stdout).toContain("format: split");
    expect(first.stdout).toContain(
      "route-unit: .hamilton/maps/auth/route.md — unit 2",
    );
    expect(first.stdout).toMatch(/proposal\.md\s+present/);
    expect(first.stdout).toContain("requirements/  present  auth");
    expect(first.stdout).toContain("Task 1: done, feedback: absent");
    expect(first.stdout).toContain("Task 2: blocked, feedback: absent");
    expect(first.lastLine).toBe(
      "summary: add-auth — 1/2 tasks done, whole change: not reviewed",
    );
    expect(renderContextResult(first)).toBe(first.stdout.trimEnd());
  });

  it("preserves pre-plan and legacy classifications", async () => {
    const repository = makeRepo();
    const prePlan = seed(repository, "pre-plan", { "proposal.md": proposal });
    const legacy = seed(repository, "legacy", {
      "plan.md": plan,
      "progress.md":
        "# Progress: add auth\n\n## Task 1: Add auth — 2026-09-12\n\n- Outcome: done\n",
    });

    const prePlanResult = await context({ changeDir: prePlan });
    const legacyResult = await context({ changeDir: legacy });

    expect(prePlanResult.exitCode).toBe(0);
    expect(prePlanResult.stdout).toContain("format: pre-plan");
    expect(prePlanResult.lastLine).toBe("summary: pre-plan — pre-plan");
    expect(legacyResult.exitCode).toBe(0);
    expect(legacyResult.stdout).toContain("format: legacy-unsupported");
    expect(legacyResult.stdout).not.toContain("tasks:");
  });

  it("lists all changes in reverse modification order with stable ties", async () => {
    const repository = makeRepo();
    const older = seed(repository, "older", { "proposal.md": proposal });
    const newer = seed(repository, "newer", splitFiles);
    const stamp = new Date("2026-01-02T12:00:00Z");
    Fs.utimesSync(older, stamp, stamp);
    Fs.utimesSync(
      newer,
      new Date("2026-01-03T12:00:00Z"),
      new Date("2026-01-03T12:00:00Z"),
    );
    const result = await context(
      { all: true },
      createContextRuntime({ cwd: () => repository }),
    );

    expect(result.exitCode).toBe(0);
    expect(result.lines[0]).toMatch(/^change\s+format\s+artifacts/);
    expect(result.lines[1]).toContain("newer");
    expect(result.lines[1]).toContain("split");
    expect(result.lines[2]).toContain("older");
    expect(result.lines[2]).toContain("pre-plan");
    expect(result.changes).toHaveLength(2);
  });

  it("returns an environment error for invalid paths", async () => {
    const repository = makeRepo();
    const result = await context({
      changeDir: Path.join(repository, "missing"),
    });

    expect(result.exitCode).toBe(2);
    expect(result.status).toBe("error");
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("change dir does not exist");
  });

  it("accepts current frontmatter artifacts through shared inspection", async () => {
    const repository = makeRepo();
    const directory = makeChangeDir(repository, "current");
    write(
      directory,
      "plan.md",
      `---
artifact: plan
change: current
status: approved
created: 2026-09-12
author: caio
decision: accepted
route_unit: null
---
# Plan: current
## Overview
## Tasks
## Done when
### Task 1: Build it
`,
    );
    write(
      directory,
      "progress.md",
      `---
artifact: progress
change: current
status: in-progress
updated: 2026-09-12
decision: accepted
tasks:
  - id: 1
    title: Build it
    status: in-progress
    progress: tasks/task-1/progress.md
---
# Progress: current

| Task | Status | Progress |
|---|---|---|
| Task 1: Build it | in-progress | [details](tasks/task-1/progress.md) |
`,
    );
    write(
      directory,
      "tasks/task-1/progress.md",
      `---
artifact: task-progress
change: current
task: 1
status: in-progress
updated: 2026-09-12
decision: accepted
---
# Task Progress: Task 1 — Build it

## Attempt 1 — 2026-09-12

- Outcome: blocked
`,
    );

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.changes[0]?.format).toBe("split");
    expect(result.stdout).toContain("Task 1: in-progress");
  });

  it("returns invalid context for malformed current artifacts", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "malformed", {
      "plan.md":
        "---\nartifact: plan\nchange: malformed\n: bad\n---\n# Plan: malformed\n",
    });

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("format: invalid");
    expect(result.lastLine).toBe("summary: malformed — invalid");
  });
});
