import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import {
  createPrototypeRuntime,
  prototype,
  type PrototypeGitPort,
} from "../../src/workbench/prototype.js";
import {
  cleanupRepos,
  git,
  makeRepo,
  runCommand,
  write,
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

const failingGit = (
  repository: string,
  failure: keyof PrototypeGitPort,
): PrototypeGitPort => {
  const runtime = createPrototypeRuntime({ cwd: () => repository });
  return {
    repositoryRoot: runtime.git.repositoryRoot,
    currentBranch: runtime.git.currentBranch,
    branchExists: (cwd, branch) =>
      failure === "branchExists"
        ? { status: 9, stdout: "", stderr: "simulated branch lookup failure" }
        : runtime.git.branchExists(cwd, branch),
    switchBranch: (cwd, branch) =>
      failure === "switchBranch"
        ? { status: 9, stdout: "", stderr: "simulated switch failure" }
        : runtime.git.switchBranch(cwd, branch),
    createBranch: (cwd, branch) =>
      failure === "createBranch"
        ? { status: 9, stdout: "", stderr: "simulated create failure" }
        : runtime.git.createBranch(cwd, branch),
  };
};

describe("prototype create and resume", () => {
  it("creates a mapped branch from the current branch and switches to it", async () => {
    const repo = inDirectory(makeRepo());

    const result = await prototype({
      mode: "mapped",
      mapName: "payments-redesign",
      ticketName: "03-storage-model",
    });

    expect(result.exitCode).toBe(0);
    expect(result.lastLine).toBe(
      "prototype/payments-redesign/03-storage-model",
    );
    expect(result.stdout).toContain("mode: created");
    expect(git(repo, "branch", "--show-current")).toBe(
      "prototype/payments-redesign/03-storage-model",
    );
  });

  it("carries an uncommitted change along the switch", async () => {
    const repo = inDirectory(makeRepo());
    const file = write(repo, "scratch.txt", "wip\n");

    const result = await prototype({
      mode: "mapped",
      mapName: "payments-redesign",
      ticketName: "03-storage-model",
    });

    expect(result.exitCode).toBe(0);
    expect(Fs.existsSync(file)).toBe(true);
    expect(Fs.readFileSync(file, "utf8")).toBe("wip\n");
  });

  it("resumes an existing mapped branch and switches to it", async () => {
    const repo = inDirectory(makeRepo());
    await prototype({
      mode: "mapped",
      mapName: "payments-redesign",
      ticketName: "03-storage-model",
    });
    git(repo, "checkout", "-q", "main");

    const result = await prototype({
      mode: "mapped",
      mapName: "payments-redesign",
      ticketName: "03-storage-model",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mode: resumed");
    expect(result.lastLine).toBe(
      "prototype/payments-redesign/03-storage-model",
    );
    expect(git(repo, "branch", "--show-current")).toBe(
      "prototype/payments-redesign/03-storage-model",
    );
  });

  it("creates a standalone branch from a question slug", async () => {
    const repo = inDirectory(makeRepo());

    const result = await prototype({ mode: "standalone", slug: "my-question" });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("mode: created");
    expect(result.lastLine).toBe("prototype/my-question");
    expect(git(repo, "branch", "--show-current")).toBe("prototype/my-question");
  });
});

describe("prototype verify", () => {
  it("succeeds when the current branch matches", async () => {
    const repo = inDirectory(makeRepo());
    await prototype({
      mode: "mapped",
      mapName: "payments-redesign",
      ticketName: "03-storage-model",
    });

    const result = await prototype({
      mode: "verify",
      expectedBranch: "prototype/payments-redesign/03-storage-model",
    });

    expect(result.exitCode).toBe(0);
    expect(result.lastLine).toBe(
      "verified: prototype/payments-redesign/03-storage-model",
    );
  });

  it("fails when the current branch does not match", async () => {
    inDirectory(makeRepo());

    const result = await prototype({
      mode: "verify",
      expectedBranch: "prototype/payments-redesign/03-storage-model",
    });

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("not on prototype/payments-redesign/03-storage-model");
  });
});

describe("prototype usage and environment errors", () => {
  it("rejects invalid mapped arguments before repository work", async () => {
    const repo = inDirectory(makeRepo());

    const result = await prototype({
      mode: "mapped",
      mapName: "",
      ticketName: "03-storage-model",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("map name");
    expect(git(repo, "branch", "--show-current")).toBe("main");
  });

  it("rejects invalid standalone arguments before repository work", async () => {
    const repo = inDirectory(makeRepo());

    const result = await prototype({ mode: "standalone", slug: "" });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("slug");
    expect(git(repo, "branch", "--show-current")).toBe("main");
  });

  it("exits 2 outside a git repository", async () => {
    const directory = Fs.mkdtempSync(Path.join(Fs.realpathSync(Os.tmpdir()), "hamilton-nogit-"));
    try {
      inDirectory(directory);
      const result = await prototype({
        mode: "mapped",
        mapName: "payments-redesign",
        ticketName: "03-storage-model",
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain("not inside a git repository");
    } finally {
      Fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects a failed branch lookup without mutating the repository", async () => {
    const repo = inDirectory(makeRepo());
    const runtime = createPrototypeRuntime({
      cwd: () => repo,
      git: failingGit(repo, "branchExists"),
    });

    const result = await prototype(
      {
        mode: "mapped",
        mapName: "payments-redesign",
        ticketName: "03-storage-model",
      },
      runtime,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("branch lookup");
    expect(git(repo, "branch", "--show-current")).toBe("main");
    expect(git(repo, "branch", "--list", "prototype/*")).toBe("");
  });

  it("does not report success when branch creation fails", async () => {
    const repo = inDirectory(makeRepo());
    const runtime = createPrototypeRuntime({
      cwd: () => repo,
      git: failingGit(repo, "createBranch"),
    });

    const result = await prototype(
      {
        mode: "mapped",
        mapName: "payments-redesign",
        ticketName: "03-storage-model",
      },
      runtime,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("create");
    expect(git(repo, "branch", "--show-current")).toBe("main");
    expect(git(repo, "branch", "--list", "prototype/*")).toBe("");
  });

  it("does not report success when switching an existing branch fails", async () => {
    const repo = inDirectory(makeRepo());
    git(repo, "branch", "prototype/payments-redesign/03-storage-model");
    const runtime = createPrototypeRuntime({
      cwd: () => repo,
      git: failingGit(repo, "switchBranch"),
    });

    const result = await prototype(
      {
        mode: "mapped",
        mapName: "payments-redesign",
        ticketName: "03-storage-model",
      },
      runtime,
    );

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("switch");
    expect(git(repo, "branch", "--show-current")).toBe("main");
  });

  it("rejects an invalid process result without attempting creation", async () => {
    const repo = inDirectory(makeRepo());
    const process = (command: string, args: readonly string[], cwd: string) => {
      if (command === "git" && args[0] === "show-ref")
        return { status: 1, stdout: "", stderr: "" };
      return runCommand(command, args, cwd);
    };
    const runtime = createPrototypeRuntime({
      cwd: () => repo,
      process: { run: process },
    });

    const result = await prototype(
      {
        mode: "mapped",
        mapName: "payments-redesign",
        ticketName: "03-storage-model",
      },
      runtime,
    );

    expect(result.exitCode).toBe(0);
    expect(result.lastLine).toBe(
      "prototype/payments-redesign/03-storage-model",
    );
  });
});
