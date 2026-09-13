import { afterEach, describe, expect, it } from "vitest";
import * as Path from "node:path";
import {
  createPreconditionRuntime,
  precondition,
} from "../../src/workbench/precondition.js";
import {
  cleanupRepos,
  commitAll,
  makeChangeDir,
  makeRepo,
  write,
} from "./helpers.js";

afterEach(cleanupRepos);

describe("precondition repository gates", () => {
  it("opens the gate for a clean target repository", async () => {
    const repository = makeRepo();
    const changeDir = makeChangeDir(repository, "add-auth");

    const result = await precondition({
      changeDir,
      testCommand: "true",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[PASS] Clean tree");
    expect(result.stdout).toContain("[PASS] Tests (true)");
    expect(result.stdout).toContain("[PASS] Clean tree after verification");
    expect(result.stdout).toContain("[PASS] Final clean tree");
    expect(result.lastLine).toBe("gate: open");
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

    expect(result.exitCode, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain("[PASS] Tests (test -f target-only.txt)");
    expect(result.lastLine).toBe("gate: open");
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
      stderr: "error: cannot execute test command: Error: command unavailable\n",
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

    expect(result.exitCode).toBe(0);
    expect(calls).toEqual(["bash -c injected-test @ " + repository]);
    expect(result.lastLine).toBe("gate: open");
  });
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
