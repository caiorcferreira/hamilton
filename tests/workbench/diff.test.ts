import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import {
  createDiffRuntime,
  diff,
  type DiffFileSystemPort,
  type DiffGitPort,
} from "../../src/workbench/diff.js";
import { cleanupRepos, commitAll, git, makeChangeDir, makeRepo, write } from "./helpers.js";

const originalDirectory = process.cwd();

afterEach(() => {
  process.chdir(originalDirectory);
  cleanupRepos();
});

const inDirectory = (directory: string) => {
  process.chdir(directory);
  return directory;
};

const taskPlan = (task: number, title = "Test task") => `### Task ${task}: ${title}\n`;

const addTask = (changeDir: string, task: number, status = "pending") => {
  write(changeDir, "plan.md", taskPlan(task));
  write(
    changeDir,
    "progress.md",
    `# Progress: test\n\n| Task | Status | Progress |\n|---|---|---|\n| Task ${task}: Test task | ${status} | [details](tasks/task-${task}/progress.md) |\n`,
  );
  write(changeDir, `tasks/task-${task}/progress.md`, `# Task Progress: Task ${task} — Test task\n`);
};

const prepareTask = (repo: string, changeDir: string, task: number) => {
  addTask(changeDir, task);
  commitAll(repo, `add task ${task}`);
};

const basePath = (changeDir: string, task: number) =>
  Path.join(changeDir, "tasks", `task-${task}`, ".base");

const failingGit = (repository: string, failure: keyof DiffGitPort): DiffGitPort => {
  const runtime = createDiffRuntime({ cwd: () => repository });
  return {
    ...runtime.git,
    ...(failure === "diff"
      ? { diff: () => ({ status: 9, stdout: "", stderr: "simulated diff failure" }) }
      : {}),
    ...(failure === "isAncestor"
      ? { isAncestor: () => ({ status: 1, stdout: "", stderr: "not an ancestor" }) }
      : {}),
  };
};

const failingFileSystem = (repository: string): DiffFileSystemPort => {
  const runtime = createDiffRuntime({ cwd: () => repository });
  return {
    ...runtime.fileSystem,
    writeFile: () => {
      throw new Error("simulated output failure");
    },
  };
};

describe("diff checkpoint recording", () => {
  it("records HEAD exactly once and keeps the checkpoint ignored", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    prepareTask(repo, changeDir, 2);
    const base = git(repo, "rev-parse", "HEAD");

    const first = await diff({ mode: "record", task: "2", changeDir });
    const second = await diff({ mode: "record", task: "2", changeDir });

    expect(first.exitCode).toBe(0);
    expect(first.lastLine).toBe(basePath(changeDir, 2));
    expect(first.stdout).toContain(`base: ${base}`);
    expect(second.exitCode).toBe(0);
    expect(Fs.readFileSync(basePath(changeDir, 2), "utf8").trim()).toBe(base);
    expect(Fs.readFileSync(Path.join(repo, ".git", "info", "exclude"), "utf8").match(/task-2\/\.base/g)).toHaveLength(1);
  });

  it("does not overwrite a historical checkpoint on retry", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    prepareTask(repo, changeDir, 2);
    const base = git(repo, "rev-parse", "HEAD");
    const recorded = await diff({ mode: "record", task: "2", changeDir });
    write(repo, "src/auth.ts", "export const auth = true\n");
    commitAll(repo, "implement auth");

    const retry = await diff({ mode: "record", task: "2", changeDir });

    expect(recorded.exitCode).toBe(0);
    expect(retry.exitCode).toBe(0);
    expect(Fs.readFileSync(basePath(changeDir, 2), "utf8").trim()).toBe(base);
  });

  it.each(["done", "blocked", "in-progress"])("rejects first recording for a %s row", async (status) => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    addTask(changeDir, 2, status);
    commitAll(repo, `add ${status} task`);

    const result = await diff({ mode: "record", task: "2", changeDir });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("historical recovery");
    expect(Fs.existsSync(basePath(changeDir, 2))).toBe(false);
  });

  it("rejects malformed, off-history, and same-head checkpoints", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    prepareTask(repo, changeDir, 2);
    const checkpoint = basePath(changeDir, 2);
    write(changeDir, "tasks/task-2/.base", "not-a-commit\n");
    const malformed = await diff({ mode: "task", task: "2", changeDir });
    expect(malformed.exitCode).toBe(2);
    expect(malformed.stderr).toContain("exactly one full commit ID");

    git(repo, "checkout", "-q", "-b", "other");
    write(repo, "src/other.ts", "export const other = true\n");
    const offHistory = commitAll(repo, "other history");
    git(repo, "checkout", "-q", "main");
    write(changeDir, "tasks/task-2/.base", `${offHistory}\n`);
    const unrelated = await diff({ mode: "task", task: "2", changeDir });
    expect(unrelated.exitCode).toBe(2);
    expect(unrelated.stderr).toContain("not an ancestor");

    const head = git(repo, "rev-parse", "HEAD");
    write(changeDir, "tasks/task-2/.base", `${head}\n`);
    const sameHead = await diff({ mode: "task", task: "2", changeDir });
    expect(sameHead.exitCode).toBe(1);
    expect(sameHead.stderr).toContain("BASE equals HEAD");
    expect(Fs.existsSync(checkpoint)).toBe(true);
  });
});

describe("diff package ranges", () => {
  it("packages only the recorded task range and discovers its change directory", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    prepareTask(repo, changeDir, 2);
    const recorded = await diff({ mode: "record", task: "2", changeDir });
    const base = git(repo, "rev-parse", "HEAD");
    write(repo, "src/auth.ts", "export const auth = true\n");
    const head = commitAll(repo, "add auth");
    const output = Path.join(repo, "task.diff");

    const result = await diff({ mode: "task", task: "2", out: "task.diff" }, createDiffRuntime({ cwd: () => changeDir }));

    expect(recorded.exitCode).toBe(0);
    expect(result.exitCode).toBe(0);
    expect(result.lastLine).toBe(output);
    expect(result.stdout).toContain(`Base: ${base}`);
    expect(result.stdout).toContain(`Head: ${head}`);
    expect(result.stdout).toContain(`Package: ${output}`);
    expect(Fs.readFileSync(output, "utf8")).toContain("export const auth = true");
    Fs.rmSync(output);
  });

  it("packages an explicit base without a recorded checkpoint", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    const base = git(repo, "rev-parse", "HEAD");
    write(repo, "src/auth.ts", "export const auth = true\n");
    const head = commitAll(repo, "add auth");

    const result = await diff({ mode: "base", base, changeDir });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Base: ${base}`);
    expect(result.stdout).toContain(`Head: ${head}`);
    expect(Fs.readFileSync(result.lastLine, "utf8")).toContain("auth = true");
    Fs.rmSync(result.lastLine);
  });

  it("packages the whole change from origin default branch", async () => {
    const repo = inDirectory(makeRepo());
    const base = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "-q", "-b", "add-auth");
    write(repo, "src/auth.ts", "export const auth = true\n");
    const head = commitAll(repo, "add auth");

    const result = await diff({ mode: "whole-change" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("default-branch: main");
    expect(result.stdout).toContain(`Base: ${base}`);
    expect(result.stdout).toContain(`Head: ${head}`);
    Fs.rmSync(result.lastLine);
  });

  it("rejects invalid ancestry before reporting a package", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    prepareTask(repo, changeDir, 2);
    await diff({ mode: "record", task: "2", changeDir });
    const runtime = createDiffRuntime({ cwd: () => repo, git: failingGit(repo, "isAncestor") });

    const result = await diff({ mode: "task", task: "2", changeDir }, runtime);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("not an ancestor");
  });

  it("stops before success when Git or output fails", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    prepareTask(repo, changeDir, 2);
    await diff({ mode: "record", task: "2", changeDir });
    write(repo, "src/auth.ts", "export const auth = true\n");
    commitAll(repo, "add auth");

    const gitResult = await diff({ mode: "task", task: "2", changeDir }, createDiffRuntime({ cwd: () => repo, git: failingGit(repo, "diff") }));
    const outputResult = await diff({ mode: "task", task: "2", changeDir, out: "failed.diff" }, createDiffRuntime({ cwd: () => repo, fileSystem: failingFileSystem(repo) }));

    expect(gitResult.exitCode).toBe(2);
    expect(gitResult.stdout).toBe("");
    expect(gitResult.stderr).toContain("diff");
    expect(outputResult.exitCode).toBe(2);
    expect(outputResult.stdout).toBe("");
    expect(outputResult.stderr).toContain("write");
  });
});

describe("diff validation", () => {
  it("rejects invalid task arguments and abandoned tasks", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    addTask(changeDir, 2);
    commitAll(repo, "add task");

    for (const task of ["", "0", "-1", "02", "2x", "3"]) {
      const result = await diff({ mode: "record", task, changeDir });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("task");
    }

    write(changeDir, "plan.md", "### Task 2: Retired work (abandoned — no longer needed)\n");
    commitAll(repo, "abandon task");
    const abandoned = await diff({ mode: "record", task: "2", changeDir });
    expect(abandoned.exitCode).toBe(2);
    expect(abandoned.stderr).toContain("abandoned");
  });

  it("rejects invalid explicit bases and whole-change combinations", async () => {
    const repo = inDirectory(makeRepo());
    const changeDir = makeChangeDir(repo, "add-auth");
    const invalid = await diff({ mode: "base", base: "0000000000000000000000000000000000000000" });
    const invalidWhole = await diff({ mode: "whole-change", changeDir } as never);

    expect(invalid.exitCode).toBe(2);
    expect(invalid.stderr).toContain("not a commit");
    expect(invalidWhole.exitCode).toBe(2);
  });

  it("returns an environment error outside a repository", async () => {
    const directory = Fs.mkdtempSync(Path.join(Fs.realpathSync(Os.tmpdir()), "hamilton-nogit-"));
    try {
      const result = await diff({ mode: "whole-change" }, createDiffRuntime({ cwd: () => directory }));
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("not inside a git repository");
    } finally {
      Fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
