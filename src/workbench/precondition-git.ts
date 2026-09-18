import * as Path from "node:path";
import type { ProcessResult } from "./runtime.js";
import type { PreconditionRuntime } from "./precondition-runtime.js";

export const successful = (command: ProcessResult): boolean =>
  command.status === 0;

export const text = (command: ProcessResult): string => command.stdout.trim();

export const fullCommit = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{40}$/.test(value);

export const relativePath = (root: string, sourcePath: string): string =>
  Path.relative(root, sourcePath).split(Path.sep).join("/");

export const gitCommand = async (
  runtime: PreconditionRuntime,
  args: readonly string[],
  root: string,
): Promise<ProcessResult> => runtime.process.run("git", args, root);

export const gitCurrentHead = async (
  runtime: PreconditionRuntime,
  root: string,
): Promise<ProcessResult> =>
  runtime.git.currentHead
    ? runtime.git.currentHead(root)
    : gitCommand(runtime, ["rev-parse", "HEAD"], root);

export const gitResolveCommit = async (
  runtime: PreconditionRuntime,
  root: string,
  reference: string,
): Promise<ProcessResult> =>
  runtime.git.resolveCommit
    ? runtime.git.resolveCommit(root, reference)
    : gitCommand(
        runtime,
        ["rev-parse", "--verify", `${reference}^{commit}`],
        root,
      );

export const gitIsAncestor = async (
  runtime: PreconditionRuntime,
  root: string,
  base: string,
  head: string,
): Promise<ProcessResult> =>
  runtime.git.isAncestor
    ? runtime.git.isAncestor(root, base, head)
    : gitCommand(runtime, ["merge-base", "--is-ancestor", base, head], root);

export const gitHeadBlob = async (
  runtime: PreconditionRuntime,
  root: string,
  sourcePath: string,
): Promise<ProcessResult> =>
  runtime.git.headBlob
    ? runtime.git.headBlob(root, sourcePath)
    : gitCommand(runtime, ["rev-parse", `HEAD:${sourcePath}`], root);

export const gitWorktreeBlob = async (
  runtime: PreconditionRuntime,
  root: string,
  sourcePath: string,
): Promise<ProcessResult> =>
  runtime.git.worktreeBlob
    ? runtime.git.worktreeBlob(root, sourcePath)
    : gitCommand(runtime, ["hash-object", "--", sourcePath], root);

export const gitStagedDiff = async (
  runtime: PreconditionRuntime,
  root: string,
  sourcePath: string,
): Promise<ProcessResult> =>
  runtime.git.stagedDiff
    ? runtime.git.stagedDiff(root, sourcePath)
    : gitCommand(
        runtime,
        ["diff", "--cached", "--quiet", "HEAD", "--", sourcePath],
        root,
      );

export const gitLatestCommit = async (
  runtime: PreconditionRuntime,
  root: string,
  sourcePath: string,
): Promise<ProcessResult> =>
  runtime.git.latestCommit
    ? runtime.git.latestCommit(root, sourcePath)
    : gitCommand(
        runtime,
        ["log", "-1", "--format=%H", "HEAD", "--", sourcePath],
        root,
      );

export const gitCommitFiles = async (
  runtime: PreconditionRuntime,
  root: string,
  commit: string,
): Promise<ProcessResult> =>
  runtime.git.commitFiles
    ? runtime.git.commitFiles(root, commit)
    : gitCommand(
        runtime,
        ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", commit],
        root,
      );

export const gitLatestMaterialCommit = async (
  runtime: PreconditionRuntime,
  root: string,
  changePath: string,
  taskPaths: readonly string[],
): Promise<ProcessResult> => {
  if (runtime.git.latestMaterialCommit)
    return runtime.git.latestMaterialCommit(root, changePath, taskPaths);
  const exclusions = [
    `:(exclude)${changePath}/progress.md`,
    `:(exclude)${changePath}/review.md`,
    `:(exclude)${changePath}/finish.md`,
    ...taskPaths.flatMap((path) => [
      `:(exclude)${path}`,
      `:(exclude)${path.replace(/progress\.md$/, "feedback.md")}`,
    ]),
  ];
  return gitCommand(
    runtime,
    ["log", "-1", "--format=%H", "HEAD", "--", ".", ...exclusions],
    root,
  );
};
