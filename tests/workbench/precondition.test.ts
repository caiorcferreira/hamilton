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

const makeEvidence = (
  repository: string,
  options: {
    readonly blockingFeedback?: boolean;
    readonly taskProgressStatus?: string;
  } = {},
): {
  readonly base: string;
  readonly material: string;
  readonly changeDir: string;
} => {
  const changeDir = makeChangeDir(repository, "demo");
  const base = git(repository, "rev-parse", "HEAD");
  write(
    repository,
    evidencePath("demo", "plan.md"),
    `---\nartifact: plan\nchange: demo\nstatus: approved\ncreated: 2026-09-12\nauthor: test\ndecision: accepted\nroute_unit: null\n---\n# Plan: Demo\n\n## Overview\nA plan.\n\n## Tasks\n\n### Task 1: Implement\n\n## Done when\nIt works.\n`,
  );
  write(
    repository,
    evidencePath("demo", "progress.md"),
    `---\nartifact: progress\nchange: demo\nstatus: complete\nupdated: 2026-09-12\ndecision: accepted\ntasks:\n  - id: 1\n    title: Implement\n    status: done\n    progress: tasks/task-1/progress.md\n---\n# Progress: Demo\n\n| Task | Status | Progress |\n| --- | --- | --- |\n| Task 1: Implement | done | [details](tasks/task-1/progress.md) |\n`,
  );
  write(
    repository,
    evidencePath("demo", "tasks/task-1/progress.md"),
    `---\nartifact: task-progress\nchange: demo\ntask: 1\nstatus: ${options.taskProgressStatus ?? "done"}\nupdated: 2026-09-12\ndecision: accepted\n---\n# Task Progress: Task 1 — Implement\n\n## Attempt 1 — 2026-09-12\n- Outcome: done\n`,
  );
  const material = commitAll(repository, "material");
  const blocking = options.blockingFeedback
    ? "- [src/main.ts:1] Fix this (violates: acceptance)"
    : "- None.";
  write(
    repository,
    evidencePath("demo", "tasks/task-1/feedback.md"),
    `---\nartifact: feedback\nchange: demo\ntask: 1\ncreated: 2026-09-12\nstatus: resolved\nverdict: approved\ndecision: accepted\nbase: ${base}\nhead: ${material}\n---\n# Code Feedback: Task 1 — Implement\n\n## Pass 1 — 2026-09-12\n\n### Blocking\n${blocking}\n\n### Suggestions\n- None.\n`,
  );
  commitPaths(
    repository,
    "feedback",
    evidencePath("demo", "tasks/task-1/feedback.md"),
  );
  write(
    repository,
    evidencePath("demo", "review.md"),
    `---\nartifact: review\nchange: demo\ncreated: 2026-09-12\nstatus: complete\nverdict: approved\ndecision: accepted\nbase: ${base}\nhead: ${material}\n---\n# Whole-branch Review: Demo\n\n## Pass 1 — 2026-09-12\n\n### Blocking\n- None.\n\n### Suggestions\n- None.\n`,
  );
  commitPaths(repository, "review", evidencePath("demo", "review.md"));
  return { base, material, changeDir };
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

it("opens the gate with current split evidence", async () => {
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
  );
  write(
    repository,
    evidencePath("demo", "tasks/task-1/feedback.md"),
    `${feedback}\n## Pass 2 — 2026-09-13\n\n### Blocking\n- None.\n\n### Suggestions\n- None.\n`,
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
