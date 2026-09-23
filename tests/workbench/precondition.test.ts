import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Path from "node:path";
import {
  createPreconditionRuntime,
  precondition,
} from "../../src/workbench/precondition.js";
import {
  cleanupRepos,
  commitAll,
  commitPaths,
  git,
  makeChangeDir,
  makeRepo,
  write,
} from "./helpers.js";

afterEach(cleanupRepos);

const evidencePath = (slug: string, file: string): string =>
  `.hamilton/changes/${slug}/${file}`;

type ReviewFixtureMode =
  | "compatibility"
  | "multi-pass"
  | "legacy-multi-pass"
  | "migrated"
  | "malformed-latest"
  | "stale-latest"
  | "ambiguous-compatibility";

const reviewDocument = (
  kind: "feedback" | "review",
  base: string,
  material: string,
  mode: ReviewFixtureMode,
  blockingFeedback = false,
  taskTitle = "Implement",
): string => {
  const compatibility =
    mode === "compatibility" || mode === "ambiguous-compatibility";
  const legacyMultiPass = mode === "legacy-multi-pass";
  const metadata =
    kind === "feedback"
      ? [
          "---",
          "artifact: feedback",
          "change: demo",
          "task: 1",
          "created: 2026-09-12",
          "status: resolved",
          "decision: accepted",
          ...(compatibility || legacyMultiPass
            ? [`base: ${base}`, `head: ${material}`, "verdict: approved"]
            : []),
          "---",
        ]
      : [
          "---",
          "artifact: review",
          "change: demo",
          "created: 2026-09-12",
          "status: complete",
          "decision: accepted",
          ...(compatibility || legacyMultiPass
            ? [`base: ${base}`, `head: ${material}`, "verdict: approved"]
            : []),
          "---",
        ];
  const title =
    kind === "feedback"
      ? `# Code Feedback: Task 1 — ${taskTitle}`
      : "# Whole-branch Review: Demo";
  const blocking = blockingFeedback
    ? "- [src/main.ts:1] Fix this (violates: acceptance)"
    : "- None.";
  if (mode === "compatibility")
    return `${metadata.join(
      "\n",
    )}\n${title}\n\n## Pass 1 — 2026-09-12\n\n### Blocking\n${blocking}\n\n### Suggestions\n- None.\n`;
  if (mode === "ambiguous-compatibility")
    return `${metadata.join(
      "\n",
    )}\n${title}\n\n## Pass 1 — 2026-09-12\n\nBase: ${base}\nHead: ${base}\nVerdict: approved\n\n### Blocking\n- None.\n\n### Suggestions\n- None.\n`;
  if (mode === "legacy-multi-pass")
    return `${metadata.join(
      "\n",
    )}\n${title}\n\n## Pass 1 — 2026-09-12\n\n### Blocking\n- [src/main.ts:1] Fix the historical issue (violates: acceptance)\n\n### Suggestions\n- None.\n\n## Pass 2 — 2026-09-13\n\n### Blocking\n- None.\n\n### Suggestions\n- None.\n`;
  if (mode === "migrated")
    return `${metadata.join(
      "\n",
    )}\n${title}\n\n## Pass 1 — 2026-09-12\n\n### Blocking\n- [src/main.ts:1] Fix the historical issue (violates: acceptance)\n\n### Suggestions\n- None.\n\n## Pass 2 — 2026-09-13\n\nBase: ${base}\nHead: ${material}\nVerdict: approved\n\n### Blocking\n- None.\n\n### Suggestions\n- None.\n`;
  if (mode === "malformed-latest")
    return `${metadata.join(
      "\n",
    )}\n${title}\n\n## Pass 1 — 2026-09-12\n\n### Blocking\n- [src/main.ts:1] Fix the historical issue (violates: acceptance)\n\n### Suggestions\n- None.\n\n## Pass 2 — 2026-09-13\n\nBase: ${base}\nHead: ${material}\n\n### Blocking\n- None.\n\n### Suggestions\n- None.\n`;
  const firstVerdict =
    mode === "multi-pass" ? "changes-requested" : "approved";
  const firstBlocking =
    firstVerdict === "changes-requested"
      ? "- [src/main.ts:1] Fix this (violates: acceptance)"
      : "- None.";
  const latestHead = mode === "stale-latest" ? base : material;
  const latest = `## Pass 2 — 2026-09-13\n\nBase: ${base}\nHead: ${latestHead}\nVerdict: approved\n\n### Blocking\n- None.\n\n### Suggestions\n- None.\n`;
  return `${metadata.join(
    "\n",
  )}\n${title}\n\n## Pass 1 — 2026-09-12\n\nBase: ${base}\nHead: ${material}\nVerdict: ${firstVerdict}\n\n### Blocking\n${firstBlocking}\n\n### Suggestions\n- None.\n\n${latest}`;
};

const makeEvidence = (
  repository: string,
  options: {
    readonly blockingFeedback?: boolean;
    readonly taskProgressStatus?: string;
    readonly metadataStatus?: string;
    readonly taskTitle?: string;
    readonly metadataTitle?: string;
    readonly feedbackMode?: ReviewFixtureMode;
    readonly reviewMode?: ReviewFixtureMode;
  } = {},
): {
  readonly base: string;
  readonly material: string;
  readonly changeDir: string;
} => {
  const changeDir = makeChangeDir(repository, "demo");
  const base = git(repository, "rev-parse", "HEAD");
  const taskTitle = options.taskTitle ?? "Implement";
  const metadataTitle = options.metadataTitle ?? taskTitle;
  const displayTitle = taskTitle.replaceAll("|", "\\|");
  write(
    repository,
    evidencePath("demo", "plan.md"),
    `---\nartifact: plan\nchange: demo\nstatus: approved\ncreated: 2026-09-12\nauthor: test\ndecision: accepted\nroute_unit: null\n---\n# Plan: Demo\n\n## Overview\nA plan.\n\n## Tasks\n\n### Task 1: ${taskTitle}\n\n## Done when\nIt works.\n`,
  );
  write(
    repository,
    evidencePath("demo", "progress.md"),
    `---\nartifact: progress\nchange: demo\nstatus: complete\nupdated: 2026-09-12\ndecision: accepted\ntasks:\n  - id: 1\n    title: ${metadataTitle}\n    status: ${options.metadataStatus ?? "done"}\n    progress: tasks/task-1/progress.md\n---\n# Progress: Demo\n\n| Task | Status | Progress |\n| --- | --- | --- |\n| Task 1: ${displayTitle} | done | [details](tasks/task-1/progress.md) |\n`,
  );
  write(
    repository,
    evidencePath("demo", "tasks/task-1/progress.md"),
    `---\nartifact: task-progress\nchange: demo\ntask: 1\nstatus: ${options.taskProgressStatus ?? "done"}\nupdated: 2026-09-12\ndecision: accepted\n---\n# Task Progress: Task 1 — ${taskTitle}\n\n## Attempt 1 — 2026-09-12\n- Outcome: done\n`,
  );
  const material = commitAll(repository, "material");
  write(
    repository,
    evidencePath("demo", "tasks/task-1/feedback.md"),
    reviewDocument(
      "feedback",
      base,
      material,
      options.feedbackMode ?? "compatibility",
      options.blockingFeedback,
      taskTitle,
    ),
  );
  commitPaths(
    repository,
    "feedback",
    evidencePath("demo", "tasks/task-1/feedback.md"),
  );
  write(
    repository,
    evidencePath("demo", "review.md"),
    reviewDocument(
      "review",
      base,
      material,
      options.reviewMode ?? "compatibility",
    ),
  );
  commitPaths(repository, "review", evidencePath("demo", "review.md"));
  return { base, material, changeDir };
};

const makeEmptyProgressEvidence = (
  repository: string,
  abandoned: boolean,
): { readonly changeDir: string } => {
  const changeDir = makeChangeDir(repository, "demo");
  const base = git(repository, "rev-parse", "HEAD");
  const taskHeading = abandoned
    ? "### Task 1: Retired (abandoned — no longer needed)"
    : "### Task 1: Implement";
  write(
    repository,
    evidencePath("demo", "plan.md"),
    `---
artifact: plan
change: demo
status: approved
created: 2026-09-12
author: test
decision: accepted
route_unit: null
---
# Plan: Demo

## Overview
A plan.

## Tasks

${taskHeading}

## Done when
It works.
`,
  );
  write(
    repository,
    evidencePath("demo", "progress.md"),
    `---
artifact: progress
change: demo
status: complete
updated: 2026-09-12
decision: accepted
tasks: []
---
# Progress: Demo

| Task | Status | Progress |
| --- | --- | --- |
`,
  );
  const material = commitAll(repository, "material");
  write(
    repository,
    evidencePath("demo", "review.md"),
    reviewDocument("review", base, material, "compatibility"),
  );
  commitPaths(repository, "review", evidencePath("demo", "review.md"));
  return { changeDir };
};

describe("precondition repository gates", () => {
  it("closes the gate when workflow evidence is absent", async () => {
    const repository = makeRepo();
    const changeDir = makeChangeDir(repository, "add-auth");

    const result = await precondition({
      changeDir,
      testCommand: "true",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("[PASS] Clean tree");
    expect(result.stdout).toContain("[PASS] Tests (true)");
    expect(result.stdout).toContain("[PASS] Clean tree after verification");
    expect(result.stdout).toContain("[FAIL] Tasks");
    expect(result.lastLine).toContain("gate: closed");
  });

  it("requires a supplied test command", async () => {
    const repository = makeRepo();
    const changeDir = makeChangeDir(repository, "add-auth");

    const result = await precondition({ changeDir, testCommand: "" });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("--test-cmd is required");
    expect(result.lastLine).toBe("");
  });

  it("closes the gate for a dirty target tree and names the path", async () => {
    const repository = makeRepo();
    const changeDir = makeChangeDir(repository, "add-auth");
    write(repository, "stray.ts", "never committed\n");

    const result = await precondition({
      changeDir,
      testCommand: "true",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "[FAIL] Clean tree (1 uncommitted path(s))",
    );
    expect(result.stdout).toContain("?? stray.ts");
    expect(result.lastLine).toContain("gate: closed");
  });

  it("checks and runs the test command in the target repository", async () => {
    const caller = makeRepo();
    const target = makeRepo();
    const changeDir = makeChangeDir(target, "add-auth");
    write(target, "target-only.txt", "target\n");
    commitAll(target, "add target marker");

    const result = await precondition(
      {
        changeDir,
        testCommand: "test -f target-only.txt",
      },
      createPreconditionRuntime({ cwd: () => caller }),
    );

    expect(result.exitCode, result.stdout + result.stderr).toBe(1);
    expect(result.stdout).toContain("[PASS] Tests (test -f target-only.txt)");
    expect(result.stdout).toContain("[FAIL] Tasks");
    expect(result.lastLine).toContain("gate: closed");
  });

  it("does not borrow a passing command from the caller repository", async () => {
    const caller = makeRepo();
    const target = makeRepo();
    const changeDir = makeChangeDir(target, "add-auth");
    write(caller, "caller-only.txt", "caller\n");
    commitAll(caller, "add caller marker");

    const result = await precondition(
      {
        changeDir,
        testCommand: "test -f caller-only.txt",
      },
      createPreconditionRuntime({ cwd: () => caller }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(
      "[FAIL] Tests (test -f caller-only.txt exited 1)",
    );
    expect(result.lastLine).toContain("gate: closed");
  });

  it("reports a failed test command and its output", async () => {
    const repository = makeRepo();
    const changeDir = makeChangeDir(repository, "add-auth");

    const result = await precondition({
      changeDir,
      testCommand: "echo 'boom: 2 failed'; exit 3",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain("exited 3");
    expect(result.stdout).toContain("boom: 2 failed");
    expect(result.lastLine).toContain("gate: closed");
  });

  it("closes the gate when the test command is unavailable", async () => {
    const repository = makeRepo();
    const changeDir = makeChangeDir(repository, "add-auth");
    const result = await precondition(
      { changeDir, testCommand: "unavailable-test" },
      createPreconditionRuntime({
        process: {
          run: () => {
            throw new Error("command unavailable");
          },
        },
        git: {
          repositoryRoot: () => ({
            status: 0,
            stdout: `${repository}\n`,
            stderr: "",
          }),
          statusPorcelain: () => ({ status: 0, stdout: "", stderr: "" }),
        },
      }),
    );

    expect(result).toEqual({
      _tag: "PreconditionResult",
      status: "error",
      exitCode: 2,
      stdout: "",
      stderr:
        "error: cannot execute test command: Error: command unavailable\n",
      lines: [],
      lastLine: "",
    });
  });

  it("closes the gate when verification mutates the target worktree", async () => {
    const caller = makeRepo();
    const target = makeRepo();
    const changeDir = makeChangeDir(target, "add-auth");
    const command = "printf mutation >> README.md";

    const result = await precondition(
      { changeDir, testCommand: command },
      createPreconditionRuntime({ cwd: () => caller }),
    );

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`[PASS] Tests (${command})`);
    expect(result.stdout).toContain("[FAIL] Clean tree after verification");
    expect(result.stdout).toContain(" M README.md");
    expect(result.lastLine).toContain("gate: closed");
  });

  it("keeps command and Git policy seams injectable", async () => {
    const repository = makeRepo();
    const changeDir = makeChangeDir(repository, "add-auth");
    const calls: string[] = [];
    const runtime = createPreconditionRuntime({
      cwd: () => repository,
      process: {
        run: (command, args, cwd) => {
          calls.push(`${command} ${args.join(" ")} @ ${cwd}`);
          return { status: 0, stdout: "", stderr: "" };
        },
      },
      git: {
        repositoryRoot: () => ({
          status: 0,
          stdout: `${repository}\n`,
          stderr: "",
        }),
        statusPorcelain: () => ({ status: 0, stdout: "", stderr: "" }),
      },
    });
    const result = await precondition(
      { changeDir, testCommand: "injected-test" },
      runtime,
    );

    expect(result.exitCode).toBe(1);
    expect(calls[0]).toBe("bash -c injected-test @ " + repository);
    expect(result.lastLine).toContain("gate: closed");
  });
});

it("opens the gate with a committed synchronized all-done ledger", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository);

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.stdout).toContain("[PASS] Tasks (1 implemented)");
  expect(result.stdout).toContain("[PASS] Reviews");
  expect(result.stdout).toContain("[PASS] Whole-branch review freshness");
  expect(result.stdout).toContain("[PASS] Final clean tree");
  expect(result.lastLine).toBe("gate: open");
});

it("opens the gate for a committed synchronized renamed task title", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    taskTitle: "Rename | delimiter",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.stdout).toContain("[PASS] Clean tree");
  expect(result.stdout).toContain("[PASS] Tasks (1 implemented)");
  expect(result.lastLine).toBe("gate: open");
});

it("rejects a committed stale metadata title with the ledger diagnostic", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    taskTitle: "Rename | delimiter",
    metadataTitle: "Stale title",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("[PASS] Clean tree");
  expect(result.stdout).not.toContain("[FAIL] Clean tree");
  expect(result.stdout).toContain("progress metadata ledger does not match");
  expect(result.lastLine).toContain("gate: closed");
});

it("rejects a committed metadata status mismatch despite a synchronized task row", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, { metadataStatus: "pending" });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("progress metadata ledger does not match");
  expect(result.lastLine).toContain("gate: closed");
});

it("opens the gate for an all-abandoned plan with an empty progress ledger", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEmptyProgressEvidence(repository, true);

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.stdout).toContain("[PASS] Tasks (0 implemented)");
  expect(result.lastLine).toBe("gate: open");
});

it("rejects an empty progress ledger when the plan has an active task", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEmptyProgressEvidence(repository, false);

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("plan and progress ledgers do not match");
  expect(result.lastLine).toContain("gate: closed");
});

it("opens the gate with requested-change then approved per-pass evidence", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    feedbackMode: "multi-pass",
    reviewMode: "multi-pass",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.stdout).toContain("[PASS] Reviews");
  expect(result.stdout).toContain("[PASS] Whole-branch review freshness");
  expect(result.lastLine).toBe("gate: open");
});

it("opens the gate with a legacy-global history whose latest pass is approved", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    feedbackMode: "legacy-multi-pass",
    reviewMode: "legacy-multi-pass",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.stdout).toContain("[PASS] Reviews");
  expect(result.stdout).toContain("[PASS] Whole-branch review freshness");
  expect(result.lastLine).toBe("gate: open");
});

it("opens the gate with a migrated fieldless prefix and explicit latest pass", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    feedbackMode: "migrated",
    reviewMode: "migrated",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode, result.stdout).toBe(0);
  expect(result.stdout).toContain("[PASS] Reviews");
  expect(result.stdout).toContain("[PASS] Whole-branch review freshness");
  expect(result.lastLine).toBe("gate: open");
});

it("rejects a malformed physical-last task feedback pass", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    feedbackMode: "malformed-latest",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("Task 1 feedback malformed");
  expect(result.lastLine).toContain("gate: closed");
});

it("rejects a malformed physical-last whole-branch review pass", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    reviewMode: "malformed-latest",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("whole-branch review malformed");
  expect(result.lastLine).toContain("gate: closed");
});

it("rejects a stale latest task feedback approval", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    feedbackMode: "stale-latest",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("Task 1 feedback is stale");
  expect(result.lastLine).toContain("gate: closed");
});

it("rejects a stale latest whole-branch review approval", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    reviewMode: "stale-latest",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("review head does not contain material");
  expect(result.lastLine).toContain("gate: closed");
});

it("rejects contradictory one-pass compatibility provenance", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, {
    feedbackMode: "ambiguous-compatibility",
  });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("Task 1 feedback malformed");
  expect(result.lastLine).toContain("gate: closed");
});

it("fails closed when split ledgers or task evidence contradict", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository);
  write(repository, evidencePath("demo", "progress.md"), "broken\n");
  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("[FAIL] Clean tree");
  expect(result.lastLine).toContain("gate: closed");
});

it.each(["pending", "blocked"])(
  "rejects a task progress status that contradicts its done attempt (%s)",
  async (status) => {
    const repository = makeRepo();
    const { changeDir } = makeEvidence(repository, {
      taskProgressStatus: status,
    });

    const result = await precondition({ changeDir, testCommand: "true" });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`Task 1 progress status: ${status}`);
    expect(result.lastLine).toContain("gate: closed");
  },
);

it("rejects contradictory approved blocking findings", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository, { blockingFeedback: true });

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("Task 1 feedback malformed");
  expect(result.lastLine).toContain("gate: closed");
});

it("waives only whole-change material freshness", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository);
  write(repository, "material.txt", "new material\n");
  commitAll(repository, "material after review");

  const closed = await precondition({ changeDir, testCommand: "true" });
  const waived = await precondition({
    changeDir,
    testCommand: "true",
    wholeChangeWaived: true,
  });

  expect(closed.exitCode).toBe(1);
  expect(closed.stdout).toContain("review head does not contain material");
  expect(waived.exitCode, waived.stdout).toBe(0);
  expect(waived.stdout).toContain("[WAIVED] Whole-branch review freshness");
  expect(waived.lastLine).toBe("gate: open");
});

it("rejects a stale task feedback range", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository);
  const feedback = Fs.readFileSync(
    Path.join(changeDir, "tasks", "task-1", "feedback.md"),
    "utf8",
  ).replace(
    /head: [0-9a-f]{40}/,
    `head: ${git(repository, "rev-parse", "HEAD~3")}`,
  );
  write(repository, evidencePath("demo", "tasks/task-1/feedback.md"), feedback);
  commitPaths(
    repository,
    "stale feedback",
    evidencePath("demo", "tasks/task-1/feedback.md"),
  );

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("Task 1 feedback is stale");
  expect(result.lastLine).toContain("gate: closed");
});

it("rejects a mixed feedback commit", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository);
  const feedback = Fs.readFileSync(
    Path.join(changeDir, "tasks", "task-1", "feedback.md"),
    "utf8",
  ).replace("created: 2026-09-12", "created: 2026-09-13");
  write(
    repository,
    evidencePath("demo", "tasks/task-1/feedback.md"),
    feedback,
  );
  write(repository, "mixed.txt", "mixed\n");
  commitAll(repository, "mixed feedback");

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain(
    "Task 1 feedback is not tracked and committed exactly at HEAD",
  );
  expect(result.lastLine).toContain("gate: closed");
});

it("rejects a missing review without inheriting task approval", async () => {
  const repository = makeRepo();
  const { changeDir } = makeEvidence(repository);
  Fs.unlinkSync(Path.join(changeDir, "review.md"));
  commitAll(repository, "remove review");

  const result = await precondition({ changeDir, testCommand: "true" });

  expect(result.exitCode).toBe(1);
  expect(result.stdout).toContain("whole-branch review missing");
  expect(result.lastLine).toContain("gate: closed");
});

it("rejects a missing change directory before running gates", async () => {
  const repository = makeRepo();

  const result = await precondition({
    changeDir: Path.join(repository, "nope"),
    testCommand: "true",
  });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("change dir does not exist");
});

it("preserves a target repository environment failure", async () => {
  const repository = makeRepo();
  const changeDir = makeChangeDir(repository, "add-auth");
  const result = await precondition(
    { changeDir, testCommand: "true" },
    createPreconditionRuntime({
      fileSystem: {
        pathExists: () => true,
        directoryExists: () => true,
        realpath: () => changeDir,
      },
      git: {
        repositoryRoot: () => ({
          status: 128,
          stdout: "",
          stderr: "not a repo",
        }),
        statusPorcelain: () => ({ status: 0, stdout: "", stderr: "" }),
      },
    }),
  );

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain("not inside a git repository");
});
