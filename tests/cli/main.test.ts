import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import { VERSION } from "../../src/index.js";

const projectRoot = Path.resolve(".");
const entrypoint = Path.resolve(projectRoot, "src/cli/main.ts");

const runCli = (arguments_: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync(process.execPath, ["run", entrypoint, ...arguments_], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 5000,
    killSignal: "SIGKILL",
  });

const expectUsageFailure = (result: ReturnType<typeof runCli>) => {
  expect(result.status).toBe(2);
  expect(result.stdout).toBe("");
  expect(result.stderr.match(/error:/g) ?? []).toHaveLength(1);
};

describe("main CLI", () => {
  it("prints the existing root message without arguments", () => {
    const result = runCli([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "Hamilton - Template setup CLI\n\nUse --help for available commands\n",
    );
    expect(result.stderr).toBe("");
  });

  it("shows supported root commands without retired global flags", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("setup");
    expect(result.stdout).toContain("workbench");
    expect(result.stdout).not.toContain("--completions");
    expect(result.stdout).not.toContain("--log-level");
    expect(result.stdout).not.toContain("--wizard");
    expect(result.stderr).toBe("");
  });

  it("prints the canonical project version", () => {
    const result = runCli(["--version"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${VERSION}\n`);
    expect(result.stderr).toBe("");
  });

  it("rejects unknown root commands and options before setup can run", () => {
    const directory = Fs.mkdtempSync(
      Path.join(Os.tmpdir(), "hamilton-main-cli-"),
    );
    const invalidHome = Path.join(directory, "home-file");
    Fs.writeFileSync(invalidHome, "not a directory");

    try {
      const unknownCommand = runCli(["unknown-command"], { HOME: invalidHome });
      const unknownOption = runCli(["setup", "--unknown"], {
        HOME: invalidHome,
      });

      expectUsageFailure(unknownCommand);
      expect(unknownCommand.stderr).toContain(
        "unknown command 'unknown-command'",
      );
      expectUsageFailure(unknownOption);
      expect(unknownOption.stderr).toContain("unknown option '--unknown'");
      expect(unknownOption.stderr).not.toContain("Setup failed:");
    } finally {
      Fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects retired Effect global flags before setup can run", () => {
    const directory = Fs.mkdtempSync(
      Path.join(Os.tmpdir(), "hamilton-main-cli-"),
    );
    const invalidHome = Path.join(directory, "home-file");
    Fs.writeFileSync(invalidHome, "not a directory");

    try {
      for (const arguments_ of [
        ["setup", "--completions", "bash"],
        ["setup", "--log-level", "info"],
        ["setup", "--wizard", "false"],
      ]) {
        const result = runCli(arguments_, { HOME: invalidHome });

        expectUsageFailure(result);
        expect(result.stderr).toMatch(
          /unknown option '--(completions|log-level|wizard)'/,
        );
        expect(result.stderr).not.toContain("Setup failed:");
      }
    } finally {
      Fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reports setup filesystem failures once with exit code 2", () => {
    const directory = Fs.mkdtempSync(
      Path.join(Os.tmpdir(), "hamilton-main-cli-"),
    );
    const invalidHome = Path.join(directory, "home-file");
    Fs.writeFileSync(invalidHome, "not a directory");

    try {
      const result = runCli(["setup"], { HOME: invalidHome });

      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.match(/Setup failed:/g) ?? []).toHaveLength(1);
    } finally {
      Fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
