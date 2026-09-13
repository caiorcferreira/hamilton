import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import { spawnSync } from "node:child_process";

const entrypoint = Path.resolve("src/cli/main.ts");

const runCli = (cwd: string, ...arguments_: string[]) =>
  spawnSync(process.execPath, ["run", entrypoint, ...arguments_], {
    cwd,
    encoding: "utf8",
  });

const git = (cwd: string, ...arguments_: string[]) => {
  const result = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
};

describe("workbench CLI", () => {
  let temporaryDirectory: string;

  beforeEach(() => {
    temporaryDirectory = Fs.mkdtempSync(
      Path.join(Os.tmpdir(), "hamilton-workbench-cli-"),
    );
  });

  afterEach(() => {
    Fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it("lists every operation in help output", () => {
    const result = runCli(temporaryDirectory, "workbench", "--help");

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("isolate");
    expect(result.stdout).toContain("diff");
    expect(result.stdout).toContain("precondition");
    expect(result.stdout).toContain("context");
    expect(result.stdout).toContain("prototype");
    expect(result.stdout).toContain("lint");
  });

  it("rejects an omitted workbench operation", () => {
    const result = runCli(temporaryDirectory, "workbench");

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("requires a subcommand");
  });

  it("lints an unrelated file successfully", () => {
    const file = Path.join(temporaryDirectory, "note.md");
    Fs.writeFileSync(file, "# Note\n");

    const result = runCli(
      temporaryDirectory,
      "workbench",
      "lint",
      "--file",
      file,
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("SKIPPED");
    expect(result.stdout.trimEnd()).toMatch(/lint: success$/);
  });

  it("returns findings for a conventional artifact without frontmatter", () => {
    const file = Path.join(temporaryDirectory, "plan.md");
    Fs.writeFileSync(file, "# Plan\n");

    const result = runCli(
      temporaryDirectory,
      "workbench",
      "lint",
      "--file",
      file,
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("WARNING");
    expect(result.stdout).toContain(file);
    expect(result.stdout.trimEnd()).toMatch(/lint: findings$/);
  });

  it("rejects invalid lint scopes before inspecting files", () => {
    const file = Path.join(temporaryDirectory, "note.md");
    Fs.writeFileSync(file, "# Note\n");

    const missing = runCli(temporaryDirectory, "workbench", "lint");
    const both = runCli(
      temporaryDirectory,
      "workbench",
      "lint",
      "--file",
      file,
      "--change-dir",
      temporaryDirectory,
    );
    const unknown = runCli(
      temporaryDirectory,
      "workbench",
      "lint",
      "--unknown",
    );

    expect(missing.status).toBe(2);
    expect(both.status).toBe(2);
    expect(unknown.status).toBe(2);
  });

  it("preserves isolate negative checks", () => {
    git(temporaryDirectory, "init", "-q", "-b", "main");
    git(temporaryDirectory, "config", "user.email", "test@example.com");
    git(temporaryDirectory, "config", "user.name", "Test");
    Fs.writeFileSync(Path.join(temporaryDirectory, "file.txt"), "content\n");
    git(temporaryDirectory, "add", "file.txt");
    git(temporaryDirectory, "commit", "-qm", "initial");

    const result = runCli(
      temporaryDirectory,
      "workbench",
      "isolate",
      "--check",
    );

    expect(result.status).toBe(1);
    expect(result.stdout.trimEnd()).toMatch(/isolated: no \(.+\)$/);
  });

  it("preserves prototype verification failures", () => {
    git(temporaryDirectory, "init", "-q", "-b", "main");
    git(temporaryDirectory, "config", "user.email", "test@example.com");
    git(temporaryDirectory, "config", "user.name", "Test");
    Fs.writeFileSync(Path.join(temporaryDirectory, "file.txt"), "content\n");
    git(temporaryDirectory, "add", "file.txt");
    git(temporaryDirectory, "commit", "-qm", "initial");

    const result = runCli(
      temporaryDirectory,
      "workbench",
      "prototype",
      "--verify",
      "prototype/expected",
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("not on prototype/expected");
  });

  it("packages a whole-change diff", () => {
    git(temporaryDirectory, "init", "-q", "-b", "main");
    git(temporaryDirectory, "config", "user.email", "test@example.com");
    git(temporaryDirectory, "config", "user.name", "Test");
    Fs.writeFileSync(Path.join(temporaryDirectory, "file.txt"), "initial\n");
    git(temporaryDirectory, "add", "file.txt");
    git(temporaryDirectory, "commit", "-qm", "initial");
    git(temporaryDirectory, "switch", "-c", "feature");
    Fs.writeFileSync(Path.join(temporaryDirectory, "file.txt"), "changed\n");
    git(temporaryDirectory, "commit", "-am", "change");

    const result = runCli(
      temporaryDirectory,
      "workbench",
      "diff",
      "--whole-change",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("range:");
    expect(result.stdout.trimEnd()).toMatch(
      /\/tmp\/hamilton-diff-whole-change-[^\n]+$/,
    );
  });

  it("runs precondition gates and reports a closed gate", () => {
    git(temporaryDirectory, "init", "-q", "-b", "main");
    git(temporaryDirectory, "config", "user.email", "test@example.com");
    git(temporaryDirectory, "config", "user.name", "Test");
    const changeDirectory = Path.join(
      temporaryDirectory,
      ".hamilton",
      "changes",
      "sample",
    );
    Fs.mkdirSync(changeDirectory, { recursive: true });
    Fs.writeFileSync(Path.join(changeDirectory, "placeholder"), "content\n");
    git(temporaryDirectory, "add", ".");
    git(temporaryDirectory, "commit", "-qm", "initial");

    const result = runCli(
      temporaryDirectory,
      "workbench",
      "precondition",
      "--change-dir",
      changeDirectory,
      "--test-cmd",
      "true",
    );

    expect(result.status).toBe(1);
    expect(result.stdout.trimEnd()).toMatch(/gate: closed \(.+\)$/);
  });

  it("reports failed operations without helper scripts", () => {
    const result = runCli(
      temporaryDirectory,
      "workbench",
      "context",
      Path.join(temporaryDirectory, "missing"),
    );

    expect(result.status).toBe(2);
    expect(result.stdout).toContain("change dir does not exist");
  });
});
