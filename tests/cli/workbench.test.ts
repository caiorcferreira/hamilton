import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import { spawnSync } from "node:child_process";
import { VERSION } from "../../src/index.js";

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

const gitOutput = (cwd: string, ...arguments_: string[]) => {
  const result = spawnSync("git", arguments_, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
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

  it("reports the shared CLI version", () => {
    const result = runCli(temporaryDirectory, "--version");

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
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
      /\/hamilton-diff-whole-change-[^\n]+\/package\.diff$/,
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

  it("uses the physical latest feedback and review pass across consumers", () => {
    const repositoryDirectory = Fs.realpathSync(temporaryDirectory);
    const changeDirectory = Path.join(
      repositoryDirectory,
      ".hamilton",
      "changes",
      "sample",
    );
    const taskDirectory = Path.join(
      changeDirectory,
      "tasks",
      "task-1",
    );
    const write = (relativePath: string, contents: string) => {
      Fs.mkdirSync(Path.dirname(Path.join(repositoryDirectory, relativePath)), {
        recursive: true,
      });
      Fs.writeFileSync(Path.join(repositoryDirectory, relativePath), contents);
    };
    const lines = (...items: string[]) => items.join("\n");

    git(repositoryDirectory, "init", "-q", "-b", "main");
    git(repositoryDirectory, "config", "user.email", "test@example.com");
    git(repositoryDirectory, "config", "user.name", "Test");
    write("seed", "seed\n");
    git(repositoryDirectory, "add", ".");
    git(repositoryDirectory, "commit", "-qm", "initial");
    const base = gitOutput(repositoryDirectory, "rev-parse", "HEAD");
    git(repositoryDirectory, "switch", "-c", "feature");

    write(
      ".hamilton/changes/sample/plan.md",
      lines(
        "---",
        "artifact: plan",
        "change: sample",
        "author: Test Agent",
        "route_unit: null",
        "created: 2026-09-17",
        "status: complete",
        "decision: accepted",
        "---",
        "",
        "# Plan: sample",
        "",
        "## Overview",
        "",
        "Exercise per-pass evidence consumers.",
        "",
        "## Tasks",
        "",
        "### Task 1: Example",
        "",
        "- Depends on: none",
        "- Files:",
        "  - Created: none",
        "  - Modified: src/example.ts",
        "  - Deleted: none",
        "- Acceptance:",
        "  - Evidence consumers agree on the latest pass.",
        "- Steps:",
        "  1. Exercise the evidence consumers.",
        "- Verify: true",
        "- Commit: example",
        "",
        "## Done when",
        "",
        "- The latest valid pass is used and malformed latest evidence closes every gate.",
        "",
      ),
    );
    write(
      ".hamilton/changes/sample/progress.md",
      lines(
        "---",
        "artifact: progress",
        "change: sample",
        "status: complete",
        "updated: 2026-09-16",
        "decision: accepted",
        "tasks:",
        "  - id: 1",
        "    title: Example",
        "    status: done",
        "    progress: tasks/task-1/progress.md",
        "---",
        "",
        "# Progress: sample",
        "",
        "| Task | Status | Progress |",
        "| --- | --- | --- |",
        "| Task 1: Example | done | [details](tasks/task-1/progress.md) |",
        "",
      ),
    );
    write(
      ".hamilton/changes/sample/tasks/task-1/progress.md",
      lines(
        "---",
        "artifact: task-progress",
        "change: sample",
        "task: 1",
        "status: done",
        "updated: 2026-09-16",
        "decision: accepted",
        "---",
        "",
        "# Task Progress: Task 1 — Example",
        "",
        "## Attempt 1 — 2026-09-16",
        "",
        "- Outcome: done",
        "",
        "Created: none",
        "Modified: src/example.ts",
        "Deleted: none",
        "Verification: `true`",
        "Notes: Initial implementation.",
        "",
      ),
    );
    write("src/example.ts", "export const example = true;\n");
    git(repositoryDirectory, "add", ".");
    git(repositoryDirectory, "commit", "-qm", "implementation");
    const implementationHead = gitOutput(
      repositoryDirectory,
      "rev-parse",
      "HEAD",
    );
    const pass = (number: number, verdict: string) =>
      lines(
        `## Pass ${number} — 2026-09-17`,
        "",
        `Base: ${base}`,
        `Head: ${implementationHead}`,
        `Verdict: ${verdict}`,
        "",
        "### Blocking",
        "",
        verdict === "approved"
          ? ""
          : "- [tests/cli/workbench.test.ts:1] Latest evidence is not consumed consistently (action: align every consumer with the physical latest pass)",
        "",
        "### Suggestions",
        "",
      );
    write(
      ".hamilton/changes/sample/tasks/task-1/feedback.md",
      lines(
        "---",
        "artifact: feedback",
        "change: sample",
        "task: 1",
        "created: 2026-09-17",
        "status: open",
        "decision: accepted",
        "---",
        "",
        "# Code Feedback: Task 1 — Example",
        "",
        pass(1, "changes-requested"),
        pass(2, "approved"),
      ),
    );
    write(
      ".hamilton/changes/sample/review.md",
      lines(
        "---",
        "artifact: review",
        "change: sample",
        "created: 2026-09-17",
        "status: complete",
        "decision: accepted",
        "---",
        "",
        "# Whole-branch Review: sample",
        "",
        pass(1, "changes-requested"),
        pass(2, "approved"),
      ),
    );
    git(
      repositoryDirectory,
      "add",
      ".hamilton/changes/sample/tasks/task-1/feedback.md",
    );
    git(repositoryDirectory, "commit", "-qm", "feedback evidence");
    git(repositoryDirectory, "add", ".hamilton/changes/sample/review.md");
    git(repositoryDirectory, "commit", "-qm", "review evidence");

    const lintValid = runCli(
      repositoryDirectory,
      "workbench",
      "lint",
      "--change-dir",
      changeDirectory,
    );
    const contextValid = runCli(
      repositoryDirectory,
      "workbench",
      "context",
      changeDirectory,
    );
    const preconditionValid = runCli(
      repositoryDirectory,
      "workbench",
      "precondition",
      "--change-dir",
      changeDirectory,
      "--test-cmd",
      "true",
    );

    expect(lintValid.status).toBe(0);
    expect(lintValid.stdout.trimEnd()).toMatch(/lint: success$/);
    expect(contextValid.status).toBe(0);
    expect(contextValid.stdout).toContain(
      "Task 1: done, feedback: approved",
    );
    expect(contextValid.stdout).toContain(
      "whole change: approved",
    );
    expect(preconditionValid.status).toBe(0);
    expect(preconditionValid.stdout).toContain("[PASS] Clean tree");
    expect(preconditionValid.stdout).not.toContain("feedback malformed");
    expect(preconditionValid.stdout).not.toContain(
      "whole-branch review malformed",
    );

    const malformedPass = lines(
      "",
      "## Pass 3 — 2026-09-17",
      "",
      `Base: ${base}`,
      `Head: ${implementationHead}`,
      "",
    );
    Fs.appendFileSync(Path.join(taskDirectory, "feedback.md"), malformedPass);
    Fs.appendFileSync(Path.join(changeDirectory, "review.md"), malformedPass);
    git(repositoryDirectory, "add", ".");
    git(repositoryDirectory, "commit", "-qm", "malformed latest evidence");

    const lintMalformed = runCli(
      repositoryDirectory,
      "workbench",
      "lint",
      "--change-dir",
      changeDirectory,
    );
    const contextMalformed = runCli(
      repositoryDirectory,
      "workbench",
      "context",
      changeDirectory,
    );
    const preconditionMalformed = runCli(
      repositoryDirectory,
      "workbench",
      "precondition",
      "--change-dir",
      changeDirectory,
      "--test-cmd",
      "true",
    );

    expect(lintMalformed.status).toBe(1);
    expect(lintMalformed.stdout).toContain("review.md");
    expect(lintMalformed.stdout).toContain("feedback.md");
    expect(lintMalformed.stdout).toContain(
      "Pass must declare exactly one Verdict field before child sections",
    );
    expect(lintMalformed.stdout.trimEnd()).toMatch(/lint: findings$/);
    expect(contextMalformed.status).toBe(0);
    expect(contextMalformed.stdout).toContain("format: invalid");
    expect(contextMalformed.stdout).not.toContain(
      "Task 1: done, feedback: approved",
    );
    expect(contextMalformed.stdout).not.toContain(
      "whole change: approved",
    );
    expect(preconditionMalformed.status).toBe(1);
    expect(preconditionMalformed.stdout).toContain("feedback malformed");
    expect(preconditionMalformed.stdout).toContain(
      "whole-branch review malformed",
    );
  });
});
