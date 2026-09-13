import { spawnSync } from "node:child_process";
import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import type { ProcessPort, ProcessResult } from "./runtime.js";

export interface PreconditionArguments {
  readonly changeDir: string;
  readonly testCommand: string;
}

export type PreconditionResultStatus = "success" | "negative" | "error";

export interface PreconditionResult {
  readonly _tag: "PreconditionResult";
  readonly status: PreconditionResultStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly string[];
  readonly lastLine: string;
}

export interface PreconditionFileSystemPort {
  readonly pathExists: (sourcePath: string) => boolean | Promise<boolean>;
  readonly directoryExists: (sourcePath: string) => boolean | Promise<boolean>;
  readonly realpath: (sourcePath: string) => string | Promise<string>;
}

export interface PreconditionGitPort {
  readonly repositoryRoot: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly statusPorcelain: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
}

export interface PreconditionRuntime {
  readonly cwd: () => string;
  readonly process: ProcessPort;
  readonly fileSystem: PreconditionFileSystemPort;
  readonly git: PreconditionGitPort;
}

export interface PreconditionRuntimeOverrides {
  readonly cwd?: () => string;
  readonly process?: ProcessPort;
  readonly fileSystem?: PreconditionFileSystemPort;
  readonly git?: PreconditionGitPort;
}

const environment = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
};

const productionProcess: ProcessPort = {
  run: (command, args, cwd) => {
    const result = spawnSync(command, [...args], {
      cwd,
      encoding: "utf-8",
      env: environment,
    });
    return {
      status: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  },
};

const productionFileSystem: PreconditionFileSystemPort = {
  pathExists: async (sourcePath) => {
    try {
      await Fs.lstat(sourcePath);
      return true;
    } catch {
      return false;
    }
  },
  directoryExists: async (sourcePath) => {
    try {
      return (await Fs.stat(sourcePath)).isDirectory();
    } catch {
      return false;
    }
  },
  realpath: (sourcePath) => Fs.realpath(sourcePath),
};

const createGitPort = (processPort: ProcessPort): PreconditionGitPort => ({
  repositoryRoot: (cwd) =>
    processPort.run("git", ["rev-parse", "--show-toplevel"], cwd),
  statusPorcelain: (cwd) =>
    processPort.run("git", ["status", "--porcelain"], cwd),
});

export const createPreconditionRuntime = (
  overrides: PreconditionRuntimeOverrides = {},
): PreconditionRuntime => {
  const processPort = overrides.process ?? productionProcess;
  return {
    cwd: overrides.cwd ?? (() => process.cwd()),
    process: processPort,
    fileSystem: overrides.fileSystem ?? productionFileSystem,
    git: overrides.git ?? createGitPort(processPort),
  };
};

const linesOf = (stdout: string): readonly string[] =>
  stdout.split("\n").filter((line) => line !== "");

const result = (
  status: PreconditionResultStatus,
  exitCode: 0 | 1 | 2,
  stdout = "",
  stderr = "",
): PreconditionResult => {
  const lines = linesOf(stdout);
  return {
    _tag: "PreconditionResult",
    status,
    exitCode,
    stdout,
    stderr,
    lines,
    lastLine: lines.at(-1) ?? "",
  };
};

const failure = (message: string): PreconditionResult =>
  result("error", 2, "", `error: ${message}\n`);

const commandFailure = (
  action: string,
  command: ProcessResult,
): PreconditionResult => {
  const detail = command.stderr.trim();
  return failure(`${action}${detail === "" ? "" : `: ${detail}`}`);
};

const text = (command: ProcessResult): string => command.stdout.trim();

const cleanTree = async (
  runtime: PreconditionRuntime,
  root: string,
  label: string,
): Promise<{ readonly output: string; readonly clean: boolean } | PreconditionResult> => {
  let command: ProcessResult;
  try {
    command = await runtime.git.statusPorcelain(root);
  } catch (error) {
    return failure(`cannot inspect ${label.toLowerCase()}: ${String(error)}`);
  }
  if (command.status !== 0)
    return commandFailure(`cannot inspect ${label.toLowerCase()}`, command);
  const dirty = command.stdout.trimEnd();
  if (dirty === "") return { output: `[PASS] ${label}\n`, clean: true };
  const entries = dirty.split(/\r?\n/).filter((line) => line !== "");
  return {
    output: `[FAIL] ${label} (${entries.length} uncommitted path(s))\n${entries
      .map((line) => `       ${line}`)
      .join("\n")}\n`,
    clean: false,
  };
};

export const runTestCommand = async (
  runtime: PreconditionRuntime,
  command: string,
  root: string,
): Promise<ProcessResult | PreconditionResult> => {
  try {
    return await runtime.process.run("bash", ["-c", command], root);
  } catch (error) {
    return failure(`cannot execute test command: ${String(error)}`);
  }
};

const testGate = (
  command: string,
  execution: ProcessResult,
): { readonly output: string; readonly passed: boolean } => {
  if (execution.status === 0)
    return { output: `[PASS] Tests (${command})\n`, passed: true };
  const combined = `${execution.stdout}${execution.stderr}`.trimEnd();
  const tail =
    combined === ""
      ? ""
      : `\n${combined
          .split(/\r?\n/)
          .slice(-15)
          .map((line) => `       ${line}`)
          .join("\n")}\n`;
  return {
    output: `[FAIL] Tests (${command} exited ${execution.status})${tail}`,
    passed: false,
  };
};

const resolveTarget = async (
  args: PreconditionArguments,
  runtime: PreconditionRuntime,
): Promise<string | PreconditionResult> => {
  if (args.changeDir === "") return failure("--change-dir is required");
  if (args.testCommand === "")
    return failure(
      "--test-cmd is required (take it from AGENTS.md or plan.md; this operation will not guess)",
    );
  if (!(await runtime.fileSystem.directoryExists(args.changeDir)))
    return failure(`change dir does not exist: ${args.changeDir}`);
  let changeDir: string;
  try {
    changeDir = await runtime.fileSystem.realpath(args.changeDir);
  } catch (error) {
    return failure(`cannot resolve change dir ${args.changeDir}: ${String(error)}`);
  }
  let repository: ProcessResult;
  try {
    repository = await runtime.git.repositoryRoot(changeDir);
  } catch (error) {
    return failure(`cannot resolve target repository: ${String(error)}`);
  }
  if (repository.status !== 0)
    return commandFailure("not inside a git repository", repository);
  const reportedRoot = text(repository);
  if (reportedRoot === "") return failure("cannot resolve target repository root");
  let root: string;
  try {
    root = await runtime.fileSystem.realpath(reportedRoot);
  } catch (error) {
    return failure(`cannot resolve target repository root: ${String(error)}`);
  }
  if (changeDir === root || !changeDir.startsWith(`${root}${Path.sep}`))
    return failure("change directory is outside the target repository");
  return root;
};

export const precondition = async (
  args: PreconditionArguments,
  runtime: PreconditionRuntime = createPreconditionRuntime(),
): Promise<PreconditionResult> => {
  const target = await resolveTarget(args, runtime);
  if (typeof target !== "string") return target;
  let output = "";
  let failures = 0;

  const initial = await cleanTree(runtime, target, "Clean tree");
  if ("exitCode" in initial) return initial;
  output += initial.output;
  if (!initial.clean) failures += 1;

  const execution = await runTestCommand(runtime, args.testCommand, target);
  if ("exitCode" in execution) return execution;
  const tests = testGate(args.testCommand, execution);
  output += tests.output;
  if (!tests.passed) failures += 1;

  const after = await cleanTree(runtime, target, "Clean tree after verification");
  if ("exitCode" in after) return result("error", 2, output, after.stderr);
  output += after.output;
  if (!after.clean) failures += 1;

  if (failures === 0) {
    const final = await cleanTree(runtime, target, "Final clean tree");
    if ("exitCode" in final) return result("error", 2, output, final.stderr);
    output += final.output;
    if (!final.clean) failures += 1;
  }

  if (failures === 0) {
    output += "gate: open\n";
    return result("success", 0, output);
  }
  output += `gate: closed (${failures} failing)\n`;
  return result("negative", 1, output);
};

export const renderPreconditionResult = (
  preconditionResult: PreconditionResult,
): string =>
  preconditionResult.stdout.trimEnd() === ""
    ? preconditionResult.stderr.trimEnd()
    : preconditionResult.stdout.trimEnd();
