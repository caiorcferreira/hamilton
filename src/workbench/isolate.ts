import * as Path from "node:path";
import {
  createRuntime,
  type IsolationRuntime,
  type ProcessResult,
} from "./runtime.js";

export interface CheckIsolationArguments {
  readonly mode: "check";
  readonly changeDir?: string;
}

export interface CreateIsolationArguments {
  readonly mode: "create";
  readonly title: string;
}

export interface VerifyIsolationArguments {
  readonly mode: "verify";
  readonly title: string;
}

export type IsolationArguments =
  | CheckIsolationArguments
  | CreateIsolationArguments
  | VerifyIsolationArguments;

export type IsolationResultStatus = "success" | "negative" | "error";

export interface IsolationResult {
  readonly _tag: "IsolationResult";
  readonly operation: IsolationArguments["mode"];
  readonly status: IsolationResultStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly string[];
  readonly lastLine: string;
}

const linesOf = (stdout: string): readonly string[] =>
  stdout.split("\n").filter((line) => line !== "");

const result = (
  operation: IsolationArguments["mode"],
  status: IsolationResultStatus,
  exitCode: 0 | 1 | 2,
  stdout = "",
  stderr = "",
): IsolationResult => {
  const lines = linesOf(stdout);
  return {
    _tag: "IsolationResult",
    operation,
    status,
    exitCode,
    stdout,
    stderr,
    lines,
    lastLine: lines.at(-1) ?? "",
  };
};

const failure = (
  operation: IsolationArguments["mode"],
  message: string,
  exitCode: 1 | 2 = 2,
): IsolationResult =>
  result(operation, "error", exitCode, "", `error: ${message}\n`);

const commandError = (
  operation: IsolationArguments["mode"],
  action: string,
  command: ProcessResult,
): IsolationResult => {
  const detail = command.stderr.trim();
  return failure(
    operation,
    `${action}${detail === "" ? "" : `: ${detail}`}`,
    2,
  );
};

const output = (
  operation: IsolationArguments["mode"],
  status: "success" | "negative",
  stdout: string,
): IsolationResult =>
  result(operation, status, status === "success" ? 0 : 1, stdout);

const text = (command: ProcessResult): string => command.stdout.trim();

const successful = (command: ProcessResult): boolean => command.status === 0;

const absolutePath = async (
  sourcePath: string,
  runtime: IsolationRuntime,
): Promise<string | undefined> => {
  try {
    return await runtime.fileSystem.realpath(sourcePath);
  } catch {
    return undefined;
  }
};

const repositoryRoot = async (
  cwd: string,
  operation: IsolationArguments["mode"],
  runtime: IsolationRuntime,
): Promise<string | IsolationResult> => {
  const command = await runtime.git.repositoryRoot(cwd);
  if (!successful(command))
    return commandError(operation, "not inside a git repository", command);
  const root = await absolutePath(text(command), runtime);
  return root === undefined
    ? failure(operation, `cannot resolve repository root: ${text(command)}`)
    : root;
};

const pathFromGit = async (
  cwd: string,
  command: ProcessResult,
  operation: IsolationArguments["mode"],
  runtime: IsolationRuntime,
): Promise<string | IsolationResult> => {
  if (!successful(command))
    return commandError(operation, "cannot resolve Git directory", command);
  const path = text(command);
  const resolved = Path.isAbsolute(path) ? path : Path.resolve(cwd, path);
  const real = await absolutePath(resolved, runtime);
  return real === undefined
    ? failure(operation, `cannot resolve Git directory: ${resolved}`)
    : real;
};

const linkedWorktree = async (
  cwd: string,
  operation: IsolationArguments["mode"],
  runtime: IsolationRuntime,
): Promise<boolean | IsolationResult> => {
  const [gitDirectoryCommand, commonDirectoryCommand] = await Promise.all([
    runtime.git.gitDirectory(cwd),
    runtime.git.gitCommonDirectory(cwd),
  ]);
  const gitDirectory = await pathFromGit(
    cwd,
    gitDirectoryCommand,
    operation,
    runtime,
  );
  if (typeof gitDirectory !== "string") return gitDirectory;
  const commonDirectory = await pathFromGit(
    cwd,
    commonDirectoryCommand,
    operation,
    runtime,
  );
  if (typeof commonDirectory !== "string") return commonDirectory;
  return gitDirectory !== commonDirectory;
};

const defaultBranch = async (
  cwd: string,
  operation: IsolationArguments["mode"],
  runtime: IsolationRuntime,
): Promise<string | IsolationResult> => {
  const remote = await runtime.git.remoteDefaultBranch(cwd);
  if (successful(remote)) {
    const ref = text(remote);
    if (ref !== "") return ref.replace(/^refs\/remotes\/origin\//, "");
  }
  for (const branch of ["main", "master"]) {
    const local = await runtime.git.branchExists(cwd, branch);
    if (successful(local)) return branch;
  }
  return "main";
};

const check = async (
  args: CheckIsolationArguments,
  runtime: IsolationRuntime,
): Promise<IsolationResult> => {
  const cwd = runtime.cwd();
  const rootResult = await repositoryRoot(cwd, args.mode, runtime);
  if (typeof rootResult !== "string") return rootResult;
  const branchCommand = await runtime.git.currentBranch(cwd);
  if (!successful(branchCommand))
    return commandError(
      args.mode,
      "cannot determine current branch",
      branchCommand,
    );
  const branch = text(branchCommand);
  const defaultResult = await defaultBranch(cwd, args.mode, runtime);
  if (typeof defaultResult !== "string") return defaultResult;
  const linkedResult = await linkedWorktree(cwd, args.mode, runtime);
  if (typeof linkedResult !== "boolean") return linkedResult;

  let mode: string;
  let isolated: "yes" | "no";
  let reason = "";
  if (linkedResult) {
    mode = "linked-worktree";
    isolated = "yes";
  } else if (branch === "HEAD") {
    mode = "detached-head";
    isolated = "no";
    reason = "detached HEAD — check out a branch or create a worktree";
  } else if (branch === defaultResult) {
    mode = "none";
    isolated = "no";
    reason = `on the default branch (${defaultResult}) with no worktree`;
  } else {
    mode = "in-place-branch";
    isolated = "yes";
  }

  let stdout = `root: ${rootResult}\nbranch: ${branch}\ndefault-branch: ${defaultResult}\nmode: ${mode}\n`;
  if (args.changeDir !== undefined) {
    const resolved = await absolutePath(args.changeDir, runtime);
    if (
      !(await runtime.fileSystem.directoryExists(args.changeDir)) ||
      resolved === undefined
    ) {
      stdout += `change-dir: ${args.changeDir} (does not exist)\n`;
      stdout += `isolated: no (change dir does not exist: ${args.changeDir})\n`;
      return output(args.mode, "negative", stdout);
    }
    if (resolved === rootResult || resolved.startsWith(rootResult + Path.sep)) {
      stdout += `change-dir: ${resolved} (under root)\n`;
    } else {
      stdout += `change-dir: ${resolved} (OUTSIDE root)\n`;
      stdout += `isolated: no (change dir does not resolve under the worktree root ${rootResult})\n`;
      return output(args.mode, "negative", stdout);
    }
  }
  stdout +=
    isolated === "yes" ? "isolated: yes\n" : `isolated: no (${reason})\n`;
  return output(args.mode, isolated === "yes" ? "success" : "negative", stdout);
};

const create = async (
  args: CreateIsolationArguments,
  runtime: IsolationRuntime,
): Promise<IsolationResult> => {
  if (args.title.startsWith("-"))
    return failure(args.mode, `unknown option: ${args.title}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.title))
    return failure(args.mode, `title must be kebab-case (got: ${args.title})`);

  const cwd = runtime.cwd();
  const rootResult = await repositoryRoot(cwd, args.mode, runtime);
  if (typeof rootResult !== "string") return rootResult;
  const linkedResult = await linkedWorktree(cwd, args.mode, runtime);
  if (typeof linkedResult !== "boolean") return linkedResult;
  if (linkedResult)
    return result(
      args.mode,
      "error",
      1,
      "",
      `already in a linked worktree: ${rootResult}\nrun --check instead of creating a nested worktree\n`,
    );

  const worktreePath = Path.join(rootResult, ".worktrees", args.title);
  if (await runtime.fileSystem.pathExists(worktreePath))
    return failure(
      args.mode,
      `.worktrees/${args.title} already exists — stop and ask; never silently reuse it`,
      1,
    );
  const branch = await runtime.git.branchExists(rootResult, args.title);
  if (successful(branch))
    return failure(
      args.mode,
      `branch ${args.title} already exists — stop and ask; never silently reuse it`,
      1,
    );
  const worktreesPath = Path.join(rootResult, ".worktrees/");
  const ignored = await runtime.git.ignored(rootResult, worktreesPath);
  if (!successful(ignored)) {
    const commonResult = await runtime.git.gitCommonDirectory(rootResult);
    const commonDirectory = await pathFromGit(
      rootResult,
      commonResult,
      args.mode,
      runtime,
    );
    if (typeof commonDirectory !== "string") return commonDirectory;
    const excludeFile = Path.join(commonDirectory, "info", "exclude");
    let contents = "";
    try {
      contents = await runtime.fileSystem.readFile(excludeFile);
    } catch {
      contents = "";
    }
    if (!contents.split(/\r?\n/).includes(".worktrees/")) {
      try {
        await runtime.fileSystem.mkdir(Path.dirname(excludeFile));
        await runtime.fileSystem.appendFile(excludeFile, ".worktrees/\n");
      } catch (error) {
        return failure(
          args.mode,
          `cannot write ${excludeFile}: ${String(error)}`,
        );
      }
    }
  }

  const added = await runtime.git.addWorktree(
    rootResult,
    `.worktrees/${args.title}`,
    args.title,
  );
  if (!successful(added))
    return commandError(
      args.mode,
      `git worktree add .worktrees/${args.title} -b ${args.title} failed`,
      added,
    );
  return output(
    args.mode,
    "success",
    `created worktree: .worktrees/${args.title}\ncreated branch: ${args.title}\n${worktreePath}\n`,
  );
};

const verify = async (
  args: VerifyIsolationArguments,
  runtime: IsolationRuntime,
): Promise<IsolationResult> => {
  const rootResult = await repositoryRoot(runtime.cwd(), args.mode, runtime);
  if (typeof rootResult !== "string") return rootResult;
  const expectedSuffix = `${Path.sep}.worktrees${Path.sep}${args.title}`;
  if (rootResult.endsWith(expectedSuffix))
    return output(args.mode, "success", `verified: ${rootResult}\n`);
  return result(
    args.mode,
    "error",
    1,
    "",
    `not in .worktrees/${args.title} — current root is ${rootResult}\n`,
  );
};

export const isolate = async (
  args: IsolationArguments,
  runtime: IsolationRuntime = createRuntime(),
): Promise<IsolationResult> => {
  if (args.mode === "check") return check(args, runtime);
  if (args.mode === "create") return create(args, runtime);
  return verify(args, runtime);
};

export const checkIsolation = (
  changeDir: string | undefined,
  runtime?: IsolationRuntime,
): Promise<IsolationResult> => isolate({ mode: "check", changeDir }, runtime);

export const createIsolation = (
  title: string,
  runtime?: IsolationRuntime,
): Promise<IsolationResult> => isolate({ mode: "create", title }, runtime);

export const verifyIsolation = (
  title: string,
  runtime?: IsolationRuntime,
): Promise<IsolationResult> => isolate({ mode: "verify", title }, runtime);

export const renderIsolationResult = (
  isolationResult: IsolationResult,
): string => isolationResult.stdout.trimEnd();
