import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Path from "node:path";
import {
  context,
  createContextRuntime,
  renderContextResult,
} from "../../src/workbench/context.js";
import {
  cleanupRepos,
  commitAll,
  commitPaths,
  git,
  makeChangeDir,
  makeRepo,
  write,
} from "./helpers.js";

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
const currentReview = (
  change: string,
  title: string,
  base: string,
  head = base,
) => `---
artifact: review
change: ${change}
created: 2026-09-13
status: complete
verdict: approved
decision: accepted
base: ${base}
head: ${head}
---
# Whole-branch Review: ${title}

## Pass 1 — 2026-09-13
### Blocking
- None.
### Suggestions
- None.
`;

type EvidenceVerdict = "approved" | "changes-requested";

const reviewPass = (
  number: number,
  date: string,
  base: string,
  head: string,
  verdict: EvidenceVerdict,
  blocking = "- None.",
) => `## Pass ${number} — ${date}
Base: ${base}
Head: ${head}
Verdict: ${verdict}
### Blocking
${blocking}
### Suggestions
- None.
`;

const legacyReviewPass = (
  number: number,
  date: string,
  blocking = "- None.",
) => `## Pass ${number} — ${date}
### Blocking
${blocking}
### Suggestions
- None.
`;

const feedbackEvidence = (
  change: string,
  passes: string,
  global?: { readonly base: string; readonly head: string; readonly verdict: EvidenceVerdict },
) => `---
artifact: feedback
change: ${change}
task: 1
created: 2026-09-13
status: resolved
decision: accepted
${global ? `base: ${global.base}\nhead: ${global.head}\nverdict: ${global.verdict}\n` : ""}---
# Code Feedback: Task 1 — Add the auth | session

${passes}`;

const reviewEvidence = (
  change: string,
  title: string,
  passes: string,
  global?: { readonly base: string; readonly head: string; readonly verdict: EvidenceVerdict },
) => `---
artifact: review
change: ${change}
created: 2026-09-13
status: complete
decision: accepted
${global ? `base: ${global.base}\nhead: ${global.head}\nverdict: ${global.verdict}\n` : ""}---
# Whole-branch Review: ${title}

${passes}`;

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

  it("classifies a current change with an empty pending task log as split", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "pending-task", {
      "proposal.md": "# Proposal: pending-task\n",
      "plan.md": `---
artifact: plan
change: pending-task
status: approved
created: 2026-09-12
author: caio
decision: accepted
route_unit: null
---
# Plan: pending-task

## Overview
## Tasks

### Task 1: Build it

## Done when
`,
      "progress.md": `---
artifact: progress
change: pending-task
status: pending
updated: 2026-09-12
decision: accepted
tasks:
  - id: 1
    title: Build it
    status: pending
    progress: tasks/task-1/progress.md
---
# Progress: pending-task

| Task | Status | Progress |
|---|---|---|
| Task 1: Build it | pending | [details](tasks/task-1/progress.md) |
`,
      "tasks/task-1/progress.md": `---
artifact: task-progress
change: pending-task
task: 1
status: pending
updated: 2026-09-12
decision: accepted
---
# Task Progress: Task 1 — Build it
`,
      "requirements/auth.md": "# Auth\n",
    });

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.changes[0]?.format).toBe("split");
    expect(result.stdout).toContain("Task 1: pending");
    expect(result.lastLine).toBe(
      "summary: pending-task — 0/1 tasks done, whole change: not reviewed",
    );
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

  it("returns an environment error for unreadable all-scope discovery", async () => {
    const repository = makeRepo();
    Fs.mkdirSync(Path.join(repository, ".hamilton", "changes"), {
      recursive: true,
    });
    const runtime = createContextRuntime({ cwd: () => repository });
    const result = await context(
      { all: true },
      createContextRuntime({
        cwd: () => repository,
        fileSystem: {
          ...runtime.fileSystem,
          readDirectory: () => {
            throw new Error("permission denied");
          },
        },
        git: runtime.git,
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.status).toBe("error");
    expect(result.stdout).toBe("");
    expect(result.changes).toHaveLength(0);
    expect(result.stderr).toContain("cannot discover changes");
  });

  it("returns an environment error when all-scope directory discovery fails", async () => {
    const repository = makeRepo();
    const runtime = createContextRuntime({ cwd: () => repository });
    const changesDir = Path.join(repository, ".hamilton", "changes");
    const result = await context(
      { all: true },
      createContextRuntime({
        cwd: () => repository,
        fileSystem: {
          ...runtime.fileSystem,
          directoryExists: (sourcePath) => {
            if (sourcePath === changesDir) throw new Error("permission denied");
            return runtime.fileSystem.directoryExists(sourcePath);
          },
        },
        git: runtime.git,
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.status).toBe("error");
    expect(result.stdout).toBe("");
    expect(result.changes).toHaveLength(0);
    expect(result.stderr).toContain("cannot discover changes");
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
      "proposal.md",
      "# Proposal: current\n\n| Route unit | legacy-body |\n",
    );
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
| Route unit | body-invented |
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
    expect(result.stdout).not.toContain("route-unit: body-invented");
    expect(result.stdout).not.toContain("route-unit: legacy-body");
    expect(result.stdout).toContain("Task 1: in-progress");
  });

  it("reports the latest parsed pass for valid multi-pass feedback and review", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "multi-pass", splitFiles);
    const base = commitAll(repository, "change artifacts");
    const passes =
      reviewPass(1, "2026-09-13", base, base, "approved") +
      reviewPass(2, "2026-09-14", base, base, "approved");
    write(
      directory,
      "tasks/task-1/feedback.md",
      feedbackEvidence("multi-pass", passes),
    );
    commitPaths(
      repository,
      "feedback",
      ".hamilton/changes/multi-pass/tasks/task-1/feedback.md",
    );
    write(directory, "review.md", reviewEvidence("multi-pass", "add auth", passes));
    commitPaths(repository, "review", ".hamilton/changes/multi-pass/review.md");

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("success");
    expect(result.stdout).toContain("Task 1: done, feedback: approved (fresh)");
    expect(result.stdout).toContain("whole change: approved (fresh)");
    expect(result.lastLine).toBe(
      "summary: multi-pass — 1/2 tasks done, whole change: approved (fresh)",
    );
  });

  it("reports approval after a requested-change then approved history", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "requested-approved", splitFiles);
    const base = commitAll(repository, "change artifacts");
    const passes =
      reviewPass(
        1,
        "2026-09-13",
        base,
        base,
        "changes-requested",
        "- [src/auth.ts:1] Fix the auth issue.",
      ) + reviewPass(2, "2026-09-14", base, base, "approved");
    write(
      directory,
      "tasks/task-1/feedback.md",
      feedbackEvidence("requested-approved", passes),
    );
    commitPaths(
      repository,
      "feedback",
      ".hamilton/changes/requested-approved/tasks/task-1/feedback.md",
    );
    write(
      directory,
      "review.md",
      reviewEvidence("requested-approved", "add auth", passes),
    );
    commitPaths(
      repository,
      "review",
      ".hamilton/changes/requested-approved/review.md",
    );

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("success");
    expect(result.stdout).toContain(
      "Task 1: done, feedback: approved (fresh)",
    );
    expect(result.stdout).toContain("whole change: approved (fresh)");
    expect(result.stdout).not.toContain("changes-requested (fresh)");
  });

  it("reports the physical latest legacy-global pass without reviving historical blockers", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "legacy-global-history", splitFiles);
    const base = commitAll(repository, "change artifacts");
    const global = { base, head: base, verdict: "approved" as const };
    const passes =
      legacyReviewPass(
        1,
        "2026-09-13",
        "- [src/auth.ts:1] Fix the historical auth issue.",
      ) + legacyReviewPass(2, "2026-09-14");
    write(
      directory,
      "tasks/task-1/feedback.md",
      feedbackEvidence("legacy-global-history", passes, global),
    );
    commitPaths(
      repository,
      "feedback",
      ".hamilton/changes/legacy-global-history/tasks/task-1/feedback.md",
    );
    write(
      directory,
      "review.md",
      reviewEvidence("legacy-global-history", "add auth", passes, global),
    );
    commitPaths(
      repository,
      "review",
      ".hamilton/changes/legacy-global-history/review.md",
    );

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("success");
    expect(result.stdout).toContain("Task 1: done, feedback: approved (fresh)");
    expect(result.stdout).toContain("whole change: approved (fresh)");
    expect(result.stdout).not.toContain("changes-requested (fresh)");
  });

  it("reports the explicit latest pass after a fieldless migrated prefix", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "migrated-history", splitFiles);
    const base = commitAll(repository, "change artifacts");
    const passes =
      legacyReviewPass(
        1,
        "2026-09-13",
        "- [src/auth.ts:1] Fix the historical auth issue.",
      ) + reviewPass(2, "2026-09-14", base, base, "approved");
    write(
      directory,
      "tasks/task-1/feedback.md",
      feedbackEvidence("migrated-history", passes),
    );
    commitPaths(
      repository,
      "feedback",
      ".hamilton/changes/migrated-history/tasks/task-1/feedback.md",
    );
    write(
      directory,
      "review.md",
      reviewEvidence("migrated-history", "add auth", passes),
    );
    commitPaths(
      repository,
      "review",
      ".hamilton/changes/migrated-history/review.md",
    );

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("success");
    expect(result.stdout).toContain("Task 1: done, feedback: approved (fresh)");
    expect(result.stdout).toContain("whole change: approved (fresh)");
    expect(result.stdout).not.toContain("changes-requested (fresh)");
  });

  it("reports malformed physical-last feedback without a context error", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "malformed-physical-last", splitFiles);
    const base = commitAll(repository, "change artifacts");
    const passes =
      legacyReviewPass(
        1,
        "2026-09-13",
        "- [src/auth.ts:1] Fix the historical auth issue.",
      ) +
      reviewPass(2, "2026-09-14", base, base, "approved") +
      "## Notes\n- Context only.\n";
    write(
      directory,
      "tasks/task-1/feedback.md",
      feedbackEvidence("malformed-physical-last", passes),
    );
    commitPaths(
      repository,
      "feedback",
      ".hamilton/changes/malformed-physical-last/tasks/task-1/feedback.md",
    );

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("success");
    expect(result.stdout).toContain("Task 1: done, feedback: malformed");
    expect(result.stderr).toBe("");
  });

  it("keeps one-pass global provenance compatibility", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "one-pass", splitFiles);
    const base = commitAll(repository, "change artifacts");
    const passes = legacyReviewPass(1, "2026-09-13");
    const global = { base, head: base, verdict: "approved" as const };
    write(
      directory,
      "tasks/task-1/feedback.md",
      feedbackEvidence("one-pass", passes, global),
    );
    commitPaths(
      repository,
      "feedback",
      ".hamilton/changes/one-pass/tasks/task-1/feedback.md",
    );
    write(
      directory,
      "review.md",
      reviewEvidence("one-pass", "add auth", passes, global),
    );
    commitPaths(repository, "review", ".hamilton/changes/one-pass/review.md");

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.status).toBe("success");
    expect(result.stdout).toContain("Task 1: done, feedback: approved (fresh)");
    expect(result.stdout).toContain("whole change: approved (fresh)");
  });

  it("rejects malformed recognized inventory artifacts before format discovery", async () => {
    for (const [filename, artifact] of [
      ["proposal.md", "proposal"],
      ["design.md", "design"],
      ["finish.md", "finish"],
      ["critique.md", "critique"],
    ] as const) {
      const repository = makeRepo();
      const directory = seed(repository, `malformed-${artifact}`, {
        [filename]: `---\nartifact: ${artifact}\n---\n# ${artifact}\n`,
      });
      const result = await context({ changeDir: directory });

      expect(result.exitCode).toBe(0);
      expect(result.changes[0]?.format).toBe("invalid");
      expect(result.lastLine).toBe(`summary: malformed-${artifact} — invalid`);
    }
  });

  it("classifies recognized task artifacts in legacy layouts", async () => {
    for (const [taskSource, expectedFormat] of [
      [
        `---\nartifact: task-progress\nchange: legacy-task\n---\n# Task Progress: Task 1 — Build it\n\n## Attempt 1 — 2026-09-12\n\n- Outcome: done\n`,
        "invalid",
      ],
      [
        `---\nartifact: task-progress\nchange: legacy-task\ntask: 1\nstatus: done\nupdated: 2026-09-12\ndecision: accepted\n---\n# Task Progress: Task 1 — Build it\n\n## Attempt 1 — 2026-09-12\n\n- Outcome: done\n`,
        "legacy-unsupported",
      ],
    ] as const) {
      const repository = makeRepo();
      const directory = seed(repository, "legacy-task", {
        "plan.md": "# Plan: legacy-task\n\n### Task 1: Build it\n",
        "progress.md":
          "# Progress: legacy-task\n\n| Task | Status | Progress |\n|---|---|---|\n| Task 1: Build it | done | [details](tasks/task-1/progress.md) |\n",
        "tasks/task-1/progress.md": taskSource,
      });
      const result = await context({ changeDir: directory });

      expect(result.exitCode).toBe(0);
      expect(result.changes[0]?.format).toBe(expectedFormat);
    }
  });

  it("propagates unreadable artifact path errors", async () => {
    const repository = makeRepo();
    const blocked = Path.join(repository, "blocked");
    Fs.mkdirSync(blocked);
    Fs.chmodSync(blocked, 0o000);
    try {
      await expect(
        createContextRuntime().fileSystem.pathExists(
          Path.join(blocked, "proposal.md"),
        ),
      ).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      Fs.chmodSync(blocked, 0o755);
    }
  });

  it("rejects malformed current feedback instead of parsing its legacy body", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "malformed-feedback", {
      ...splitFiles,
      "tasks/task-1/feedback.md": `---
artifact: feedback
change: malformed-feedback
task: 1
created: 2026-09-12
status: invalid
verdict: approved
decision: accepted
base: 0000000000000000000000000000000000000000
head: 0000000000000000000000000000000000000000
---
# Code Feedback: Task 1 — Add the auth | session

## Pass 1 — 2026-09-12
Base: 0000000000000000000000000000000000000000
Head: 0000000000000000000000000000000000000000
Verdict: approved
### Blocking
- None.
### Suggestions
- None.
`,
    });

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Task 1: done, feedback: malformed");
  });

  it("reports uncommitted current review evidence before freshness", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "uncommitted-review", splitFiles);
    const base = commitAll(repository, "change artifacts");
    const review = currentReview("uncommitted-review", "add auth", base);
    write(directory, "review.md", review);
    commitPaths(
      repository,
      "review",
      ".hamilton/changes/uncommitted-review/review.md",
    );

    write(directory, "review.md", `${review}\n`);
    const unstaged = await context({ changeDir: directory });
    expect(unstaged.stdout).toContain("whole change: approved (uncommitted)");

    write(directory, "review.md", `${review}\n`);
    git(
      repository,
      "add",
      "--",
      ".hamilton/changes/uncommitted-review/review.md",
    );
    const staged = await context({ changeDir: directory });
    expect(staged.stdout).toContain("whole change: approved (uncommitted)");
  });

  it("matches current reviews whose plan titles contain regex metacharacters", async () => {
    const repository = makeRepo();
    const title = "add auth [v1].";
    const directory = seed(repository, "regex-review", {
      ...splitFiles,
      "plan.md": splitFiles["plan.md"].replace(
        "# Plan: add auth",
        `# Plan: ${title}`,
      ),
    });
    const base = commitAll(repository, "change artifacts");
    write(directory, "review.md", currentReview("regex-review", title, base));
    commitPaths(
      repository,
      "review",
      ".hamilton/changes/regex-review/review.md",
    );

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("whole change: approved (fresh)");
  });

  it("rejects malformed current review instead of parsing its legacy body", async () => {
    const repository = makeRepo();
    const directory = seed(repository, "malformed-review", {
      ...splitFiles,
      "review.md": `---
artifact: review
change: malformed-review
created: 2026-09-12
status: invalid
verdict: approved
decision: accepted
base: 0000000000000000000000000000000000000000
head: 0000000000000000000000000000000000000000
---
# Whole-branch Review: add auth

## Pass 1 — 2026-09-12
Base: 0000000000000000000000000000000000000000
Head: 0000000000000000000000000000000000000000
Verdict: approved
### Blocking
- None.
### Suggestions
- None.
`,
    });

    const result = await context({ changeDir: directory });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("format: invalid");
    expect(result.stdout).not.toContain("legacy-unsupported");
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
