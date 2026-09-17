import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import {
  checkIsolation,
  createIsolation,
  isolate,
  renderIsolationResult,
  verifyIsolation,
  type IsolationResult,
} from "../../src/workbench/isolate.js";
import {
  createRuntime,
  type ProcessPort,
} from "../../src/workbench/runtime.js";
import {
  git,
  makeChangeDir,
  makeRepo,
  runCommand,
  cleanupRepos,
} from "./helpers.js";

const originalDirectory = process.cwd();

afterEach(() => {
  process.chdir(originalDirectory);
  cleanupRepos();
});

const inDirectory = (directory: string) => {
  process.chdir(directory);
  return directory;
};

const outputField = (output: string, key: string): string | undefined =>
  output
    .split("\n")
    .find((line) => line.startsWith(`${key}: `))
    ?.slice(key.length + 2);

const failingWorktreeProcess = (): ProcessPort => ({
  run: (command, args, cwd) => {
    if (command === "git" && args[0] === "worktree")
      return { status: 9, stdout: "", stderr: "simulated worktree failure" };
    return runCommand(command, args, cwd);
  },
});

describe("isolation rendering", () => {
  it("renders stderr when stdout is empty", () => {
    const result: IsolationResult = {
      _tag: "IsolationResult",
      operation: "check",
      status: "error",
      exitCode: 2,
      stdout: "",
      stderr: "error: not inside a git repository\n",
      lines: [],
      lastLine: "",
    };

    expect(renderIsolationResult(result)).toBe(
      "error: not inside a git repository",
    );
  });
});

describe("isolation check", () => {
  it("uses the injected cwd instead of the process cwd", async () => {
    const repo = makeRepo();
    process.chdir(Os.tmpdir());
    const runtime = createRuntime({ cwd: () => repo });

    const checkResult = await checkIsolation(undefined, runtime);
    expect(checkResult.exitCode).toBe(1);
    expect(outputField(checkResult.stdout, "root")).toBe(repo);

    const created = await createIsolation("add-auth", runtime);
    expect(created.exitCode).toBe(0);

    const worktree = Path.join(repo, ".worktrees", "add-auth");
    const verifyResult = await verifyIsolation(
      "add-auth",
      createRuntime({ cwd: () => worktree }),
    );
    expect(verifyResult.exitCode).toBe(0);
    expect(verifyResult.lastLine).toContain(worktree);
  });

  it("reports not isolated on the default branch", async () => {
    const repo = inDirectory(makeRepo());
    const result = await checkIsolation(undefined);

    expect(result.exitCode).toBe(1);
    expect(outputField(result.stdout, "mode")).toBe("none");
    expect(outputField(result.stdout, "default-branch")).toBe("main");
    expect(result.lastLine).toBe(
      "isolated: no (on the default branch (main) with no worktree)",
    );
    expect(result.stderr).toBe("");
  });

  it("reports isolated on a dedicated branch", async () => {
    const repo = inDirectory(makeRepo());
    git(repo, "checkout", "-q", "-b", "add-auth");

    const result = await checkIsolation(undefined);

    expect(result.exitCode).toBe(0);
    expect(outputField(result.stdout, "mode")).toBe("in-place-branch");
    expect(outputField(result.stdout, "branch")).toBe("add-auth");
    expect(result.lastLine).toBe("isolated: yes");
  });

  it("detects master as the default branch", async () => {
    inDirectory(makeRepo({ defaultBranch: "master" }));

    const result = await checkIsolation(undefined);

    expect(result.exitCode).toBe(1);
    expect(outputField(result.stdout, "default-branch")).toBe("master");
  });

  it("prefers origin/HEAD over a local main", async () => {
    const repo = inDirectory(makeRepo());
    git(repo, "update-ref", "refs/remotes/origin/trunk", "HEAD");
    git(
      repo,
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
      "refs/remotes/origin/trunk",
    );

    const result = await checkIsolation(undefined);

    expect(outputField(result.stdout, "default-branch")).toBe("trunk");
    expect(result.exitCode).toBe(0);
  });

  it("fails closed on a detached HEAD", async () => {
    const repo = inDirectory(makeRepo());
    git(repo, "checkout", "-q", "--detach", "HEAD");

    const result = await checkIsolation(undefined);

    expect(result.exitCode).toBe(1);
    expect(outputField(result.stdout, "mode")).toBe("detached-head");
    expect(result.lastLine).toContain("detached HEAD");
  });

  it("reports isolated inside a linked worktree", async () => {
    const repo = inDirectory(makeRepo());
    const created = await createIsolation("add-auth");
    expect(created.exitCode).toBe(0);

    inDirectory(Path.join(repo, ".worktrees", "add-auth"));
    const result = await checkIsolation(undefined);

    expect(result.exitCode).toBe(0);
    expect(outputField(result.stdout, "mode")).toBe("linked-worktree");
  });

  it("rejects a change dir outside the worktree root", async () => {
    const repo = inDirectory(makeRepo());
    const other = makeRepo();
    git(repo, "checkout", "-q", "-b", "add-auth");
    const outside = makeChangeDir(other, "add-auth");

    const result = await checkIsolation(outside);

    expect(result.exitCode).toBe(1);
    expect(outputField(result.stdout, "change-dir")).toContain("OUTSIDE root");
    expect(result.lastLine).toContain(
      "does not resolve under the worktree root",
    );
  });

  it("accepts a change dir under the worktree root", async () => {
    const repo = inDirectory(makeRepo());
    git(repo, "checkout", "-q", "-b", "add-auth");
    const inside = makeChangeDir(repo, "add-auth");

    const result = await checkIsolation(inside);

    expect(result.exitCode).toBe(0);
    expect(outputField(result.stdout, "change-dir")).toContain("under root");
    expect(result.lastLine).toBe("isolated: yes");
  });

  it("rejects a change dir that does not exist", async () => {
    const repo = inDirectory(makeRepo());
    git(repo, "checkout", "-q", "-b", "add-auth");

    const result = await checkIsolation(Path.join(repo, "nope"));

    expect(result.exitCode).toBe(1);
    expect(result.lastLine).toContain("change dir does not exist");
  });

  it("errors outside a git repository", async () => {
    const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-nogit-"));
    try {
      inDirectory(directory);
      const result = await checkIsolation(undefined);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("not inside a git repository");
    } finally {
      Fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe("isolation create", () => {
  it("creates the worktree and branch and prints the path last", async () => {
    const repo = inDirectory(makeRepo());

    const result = await createIsolation("add-auth");

    expect(result.exitCode).toBe(0);
    expect(result.lastLine).toBe(Path.join(repo, ".worktrees", "add-auth"));
    expect(Fs.existsSync(result.lastLine)).toBe(true);
    expect(git(repo, "show-ref", "--verify", "refs/heads/add-auth")).toContain(
      "add-auth",
    );
  });

  it("leaves the tree clean by excluding .worktrees/", async () => {
    const repo = inDirectory(makeRepo());

    const result = await createIsolation("add-auth");

    expect(result.exitCode).toBe(0);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("does not touch info/exclude when .worktrees/ is already ignored", async () => {
    const repo = inDirectory(makeRepo());
    Fs.writeFileSync(Path.join(repo, ".gitignore"), ".worktrees/\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "ignore worktrees");
    const exclude = Path.join(repo, ".git", "info", "exclude");
    const before = Fs.existsSync(exclude)
      ? Fs.readFileSync(exclude, "utf8")
      : undefined;

    const result = await createIsolation("add-auth");

    expect(result.exitCode).toBe(0);
    const after = Fs.existsSync(exclude)
      ? Fs.readFileSync(exclude, "utf8")
      : undefined;
    expect(after).toBe(before);
  });

  it("refuses a title that is not kebab-case", async () => {
    inDirectory(makeRepo());

    const result = await createIsolation("Add_Auth");

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("kebab-case");
  });

  it("refuses to reuse an existing branch", async () => {
    const repo = inDirectory(makeRepo());
    git(repo, "branch", "add-auth");

    const result = await createIsolation("add-auth");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("never silently reuse it");
  });

  it("refuses to reuse an existing worktree directory", async () => {
    const repo = inDirectory(makeRepo());
    Fs.mkdirSync(Path.join(repo, ".worktrees", "add-auth"), {
      recursive: true,
    });

    const result = await createIsolation("add-auth");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists");
  });

  it("refuses to nest a worktree inside a worktree", async () => {
    const repo = inDirectory(makeRepo());
    const created = await createIsolation("add-auth");
    expect(created.exitCode).toBe(0);

    inDirectory(Path.join(repo, ".worktrees", "add-auth"));
    const result = await createIsolation("add-more");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already in a linked worktree");
    expect(result.stdout).not.toContain("created worktree");
  });

  it("returns a failed mutation without a successful verdict", async () => {
    inDirectory(makeRepo());

    const result = await createIsolation(
      "add-auth",
      createRuntime({ process: failingWorktreeProcess() }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("simulated worktree failure");
    expect(result.stdout).toBe("");
    expect(result.lastLine).toBe("");
  });
});

describe("isolation verify", () => {
  it("succeeds inside the named worktree", async () => {
    const repo = inDirectory(makeRepo());
    const created = await createIsolation("add-auth");
    expect(created.exitCode).toBe(0);
    inDirectory(Path.join(repo, ".worktrees", "add-auth"));

    const result = await verifyIsolation("add-auth");

    expect(result.exitCode).toBe(0);
    expect(result.lastLine).toContain(Path.join(".worktrees", "add-auth"));
  });

  it("fails when the cd never took effect", async () => {
    inDirectory(makeRepo());
    const created = await createIsolation("add-auth");
    expect(created.exitCode).toBe(0);
    const result = await verifyIsolation("add-auth");

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("not in .worktrees/add-auth");
    expect(result.stdout).not.toContain("verified:");
  });

  it("reports command failures without a successful verification", async () => {
    inDirectory(makeRepo());
    const result = await verifyIsolation(
      "add-auth",
      createRuntime({
        process: {
          run: () => ({
            status: 3,
            stdout: "",
            stderr: "simulated git failure",
          }),
        },
      }),
    );

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("simulated git failure");
    expect(result.stdout).toBe("");
  });
});

describe("isolate operation arguments", () => {
  it("dispatches typed operation modes", async () => {
    inDirectory(makeRepo());
    const result = await isolate({ mode: "check" });
    expect(result.operation).toBe("check");
    expect(result._tag).toBe("IsolationResult");
  });
});
