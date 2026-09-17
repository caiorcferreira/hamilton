import * as Path from "node:path";
import {
  createIsolationGitAdapter,
  type IsolationGitAdapter,
  type IsolationGitFailure,
  type IsolationGitValue,
} from "./isolation-git.js";
import { createRuntime, type IsolationRuntime } from "./runtime.js";

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

const output = (
  operation: IsolationArguments["mode"],
  status: "success" | "negative",
  stdout: string,
): IsolationResult =>
  result(operation, status, status === "success" ? 0 : 1, stdout);

const adapterFailure = (
  operation: IsolationArguments["mode"],
  value: IsolationGitFailure,
  exitCode: 1 | 2 = 2,
): IsolationResult => failure(operation, value.message, exitCode);

const isFailure = <A>(
  value: IsolationGitValue<A>,
): value is IsolationGitFailure => value._tag === "IsolationGitFailure";

const check = async (
  args: CheckIsolationArguments,
  git: IsolationGitAdapter,
  runtime: IsolationRuntime,
): Promise<IsolationResult> => {
  const cwd = runtime.cwd();
  const root = await git.repositoryRoot(cwd);
  if (isFailure(root)) return adapterFailure(args.mode, root);
  const branch = await git.currentBranch(cwd);
  if (isFailure(branch)) return adapterFailure(args.mode, branch);
  const defaultBranch = await git.defaultBranch(cwd);
  if (isFailure(defaultBranch)) return adapterFailure(args.mode, defaultBranch);
  const linked = await git.linkedWorktree(cwd);
  if (isFailure(linked)) return adapterFailure(args.mode, linked);

  let mode: string;
  let isolated: "yes" | "no";
  let reason = "";
  if (linked.value) {
    mode = "linked-worktree";
    isolated = "yes";
  } else if (branch.value === "HEAD") {
    mode = "detached-head";
    isolated = "no";
    reason = "detached HEAD — check out a branch or create a worktree";
  } else if (branch.value === defaultBranch.value) {
    mode = "none";
    isolated = "no";
    reason = `on the default branch (${defaultBranch.value}) with no worktree`;
  } else {
    mode = "in-place-branch";
    isolated = "yes";
  }

  let stdout = `root: ${root.value}\nbranch: ${branch.value}\ndefault-branch: ${defaultBranch.value}\nmode: ${mode}\n`;
  if (args.changeDir !== undefined) {
    let resolved: string | null;
    try {
      resolved = await runtime.fileSystem.realpath(args.changeDir);
    } catch {
      resolved = null;
    }
    if (
      !(await runtime.fileSystem.directoryExists(args.changeDir)) ||
      resolved === null
    ) {
      stdout += `change-dir: ${args.changeDir} (does not exist)\n`;
      stdout += `isolated: no (change dir does not exist: ${args.changeDir})\n`;
      return output(args.mode, "negative", stdout);
    }
    if (resolved === root.value || resolved.startsWith(root.value + Path.sep)) {
      stdout += `change-dir: ${resolved} (under root)\n`;
    } else {
      stdout += `change-dir: ${resolved} (OUTSIDE root)\n`;
      stdout += `isolated: no (change dir does not resolve under the worktree root ${root.value})\n`;
      return output(args.mode, "negative", stdout);
    }
  }
  stdout +=
    isolated === "yes" ? "isolated: yes\n" : `isolated: no (${reason})\n`;
  return output(args.mode, isolated === "yes" ? "success" : "negative", stdout);
};

const create = async (
  args: CreateIsolationArguments,
  git: IsolationGitAdapter,
  runtime: IsolationRuntime,
): Promise<IsolationResult> => {
  if (args.title.startsWith("-"))
    return failure(args.mode, `unknown option: ${args.title}`);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.title))
    return failure(args.mode, `title must be kebab-case (got: ${args.title})`);

  const root = await git.repositoryRoot(runtime.cwd());
  if (isFailure(root)) return adapterFailure(args.mode, root);
  const linked = await git.linkedWorktree(root.value);
  if (isFailure(linked)) return adapterFailure(args.mode, linked);
  if (linked.value)
    return result(
      args.mode,
      "error",
      1,
      "",
      `already in a linked worktree: ${root.value}\nrun --check instead of creating a nested worktree\n`,
    );

  const worktreePath = Path.join(root.value, ".worktrees", args.title);
  if (await runtime.fileSystem.pathExists(worktreePath))
    return failure(
      args.mode,
      `.worktrees/${args.title} already exists — stop and ask; never silently reuse it`,
      1,
    );
  const branch = await git.branchExists(root.value, args.title);
  if (isFailure(branch)) return adapterFailure(args.mode, branch);
  if (branch.value)
    return failure(
      args.mode,
      `branch ${args.title} already exists — stop and ask; never silently reuse it`,
      1,
    );
  const ignored = await git.ensureIgnored(
    root.value,
    Path.join(root.value, ".worktrees/"),
  );
  if (isFailure(ignored)) return adapterFailure(args.mode, ignored);
  const added = await git.addWorktree(
    root.value,
    `.worktrees/${args.title}`,
    args.title,
  );
  if (isFailure(added)) return adapterFailure(args.mode, added);
  return output(
    args.mode,
    "success",
    `created worktree: .worktrees/${args.title}\ncreated branch: ${args.title}\n${worktreePath}\n`,
  );
};

const verify = async (
  args: VerifyIsolationArguments,
  git: IsolationGitAdapter,
  runtime: IsolationRuntime,
): Promise<IsolationResult> => {
  const root = await git.verifyWorktree(runtime.cwd(), args.title);
  if (isFailure(root)) {
    return root.message.startsWith("not in .worktrees/")
      ? result(args.mode, "error", 1, "", `${root.message}\n`)
      : adapterFailure(args.mode, root);
  }
  return output(args.mode, "success", `verified: ${root.value}\n`);
};

export const isolate = async (
  args: IsolationArguments,
  runtime: IsolationRuntime = createRuntime(),
): Promise<IsolationResult> => {
  const git = createIsolationGitAdapter(runtime);
  if (args.mode === "check") return check(args, git, runtime);
  if (args.mode === "create") return create(args, git, runtime);
  return verify(args, git, runtime);
};

export const checkIsolation = (
  changeDir?: string,
  runtime?: IsolationRuntime,
): Promise<IsolationResult> => isolate({ mode: "check", ...(changeDir === undefined ? {} : { changeDir }) }, runtime);

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
