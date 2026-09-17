import * as Path from "node:path";
import type {
  IsolationRuntime,
  ProcessResult,
} from "./runtime.js";

export interface IsolationGitFailure {
  readonly _tag: "IsolationGitFailure";
  readonly message: string;
}

export type IsolationGitValue<A> =
  | { readonly _tag: "IsolationGitValue"; readonly value: A }
  | IsolationGitFailure;

const success = <A>(value: A): IsolationGitValue<A> => ({
  _tag: "IsolationGitValue",
  value,
});

const failure = (message: string): IsolationGitFailure => ({
  _tag: "IsolationGitFailure",
  message,
});

const text = (command: ProcessResult): string => command.stdout.trim();

const successful = (command: ProcessResult): boolean => command.status === 0;

const absolutePath = async (
  sourcePath: string,
  runtime: IsolationRuntime,
): Promise<IsolationGitValue<string>> => {
  try {
    return success(await runtime.fileSystem.realpath(sourcePath));
  } catch {
    return failure(`cannot resolve Git path: ${sourcePath}`);
  }
};

const pathFromGit = async (
  cwd: string,
  command: ProcessResult,
  runtime: IsolationRuntime,
): Promise<IsolationGitValue<string>> => {
  if (!successful(command))
    return failure(
      `cannot resolve Git directory${
        command.stderr.trim() === "" ? "" : `: ${command.stderr.trim()}`
      }`,
    );
  const path = text(command);
  const resolved = Path.isAbsolute(path) ? path : Path.resolve(cwd, path);
  const real = await absolutePath(resolved, runtime);
  return real._tag === "IsolationGitFailure" ? real : success(real.value);
};

export interface IsolationGitAdapter {
  readonly repositoryRoot: (
    cwd: string,
  ) => Promise<IsolationGitValue<string>>;
  readonly linkedWorktree: (
    cwd: string,
  ) => Promise<IsolationGitValue<boolean>>;
  readonly currentBranch: (
    cwd: string,
  ) => Promise<IsolationGitValue<string>>;
  readonly defaultBranch: (
    cwd: string,
  ) => Promise<IsolationGitValue<string>>;
  readonly branchExists: (
    cwd: string,
    branch: string,
  ) => Promise<IsolationGitValue<boolean>>;
  readonly ensureIgnored: (
    root: string,
    sourcePath: string,
  ) => Promise<IsolationGitValue<true>>;
  readonly addWorktree: (
    root: string,
    sourcePath: string,
    branch: string,
  ) => Promise<IsolationGitValue<true>>;
  readonly verifyWorktree: (
    cwd: string,
    title: string,
  ) => Promise<IsolationGitValue<string>>;
}

export const createIsolationGitAdapter = (
  runtime: IsolationRuntime,
): IsolationGitAdapter => {
  const repositoryRoot = async (
    cwd: string,
  ): Promise<IsolationGitValue<string>> => {
    const command = await runtime.git.repositoryRoot(cwd);
    if (!successful(command))
      return failure(
        `not inside a git repository${
          command.stderr.trim() === "" ? "" : `: ${command.stderr.trim()}`
        }`,
      );
    const root = await absolutePath(text(command), runtime);
    return root._tag === "IsolationGitFailure"
      ? failure(`cannot resolve repository root: ${text(command)}`)
      : success(root.value);
  };

  const linkedWorktree = async (
    cwd: string,
  ): Promise<IsolationGitValue<boolean>> => {
    const [gitDirectoryCommand, commonDirectoryCommand] = await Promise.all([
      runtime.git.gitDirectory(cwd),
      runtime.git.gitCommonDirectory(cwd),
    ]);
    const gitDirectory = await pathFromGit(
      cwd,
      gitDirectoryCommand,
      runtime,
    );
    if (gitDirectory._tag === "IsolationGitFailure") return gitDirectory;
    const commonDirectory = await pathFromGit(
      cwd,
      commonDirectoryCommand,
      runtime,
    );
    if (commonDirectory._tag === "IsolationGitFailure") return commonDirectory;
    return success(gitDirectory.value !== commonDirectory.value);
  };

  const currentBranch = async (
    cwd: string,
  ): Promise<IsolationGitValue<string>> => {
    const command = await runtime.git.currentBranch(cwd);
    if (!successful(command))
      return failure(
        `cannot determine current branch${
          command.stderr.trim() === "" ? "" : `: ${command.stderr.trim()}`
        }`,
      );
    return success(text(command));
  };

  const defaultBranch = async (
    cwd: string,
  ): Promise<IsolationGitValue<string>> => {
    const remote = await runtime.git.remoteDefaultBranch(cwd);
    if (successful(remote)) {
      const ref = text(remote);
      if (ref !== "") return success(ref.replace(/^refs\/remotes\/origin\//, ""));
    }
    for (const branch of ["main", "master"]) {
      const local = await runtime.git.branchExists(cwd, branch);
      if (successful(local)) return success(branch);
    }
    return success("main");
  };

  const branchExists = async (
    cwd: string,
    branch: string,
  ): Promise<IsolationGitValue<boolean>> => {
    const command = await runtime.git.branchExists(cwd, branch);
    if (command.status === 0) return success(true);
    if (command.status === 1) return success(false);
    return failure(
      `cannot inspect branch ${branch}${
        command.stderr.trim() === "" ? "" : `: ${command.stderr.trim()}`
      }`,
    );
  };

  const ensureIgnored = async (
    root: string,
    sourcePath: string,
  ): Promise<IsolationGitValue<true>> => {
    const ignored = await runtime.git.ignored(root, sourcePath);
    if (successful(ignored)) return success(true);
    const commonDirectoryCommand = await runtime.git.gitCommonDirectory(root);
    const commonDirectory = await pathFromGit(
      root,
      commonDirectoryCommand,
      runtime,
    );
    if (commonDirectory._tag === "IsolationGitFailure") return commonDirectory;
    const excludeFile = Path.join(commonDirectory.value, "info", "exclude");
    let contents = "";
    try {
      contents = await runtime.fileSystem.readFile(excludeFile);
    } catch {
      contents = "";
    }
    if (contents.split(/\r?\n/).includes(".worktrees/")) return success(true);
    try {
      await runtime.fileSystem.mkdir(Path.dirname(excludeFile));
      await runtime.fileSystem.appendFile(excludeFile, ".worktrees/\n");
      return success(true);
    } catch (error) {
      return failure(`cannot write ${excludeFile}: ${String(error)}`);
    }
  };

  const addWorktree = async (
    root: string,
    sourcePath: string,
    branch: string,
  ): Promise<IsolationGitValue<true>> => {
    const command = await runtime.git.addWorktree(root, sourcePath, branch);
    if (!successful(command))
      return failure(
        `git worktree add ${sourcePath} -b ${branch} failed${
          command.stderr.trim() === "" ? "" : `: ${command.stderr.trim()}`
        }`,
      );
    return success(true);
  };

  const verifyWorktree = async (
    cwd: string,
    title: string,
  ): Promise<IsolationGitValue<string>> => {
    const root = await repositoryRoot(cwd);
    if (root._tag === "IsolationGitFailure") return root;
    const expectedSuffix = `${Path.sep}.worktrees${Path.sep}${title}`;
    return root.value.endsWith(expectedSuffix)
      ? success(root.value)
      : failure(`not in .worktrees/${title} — current root is ${root.value}`);
  };

  return {
    repositoryRoot,
    linkedWorktree,
    currentBranch,
    defaultBranch,
    branchExists,
    ensureIgnored,
    addWorktree,
    verifyWorktree,
  };
};

export const isolationGit = createIsolationGitAdapter;
