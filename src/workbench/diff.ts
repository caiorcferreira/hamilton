import * as Fs from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import {
  createArtifactReader,
  type ArtifactFileSystem,
  type ArtifactReadResult,
} from "./artifact-reader.js";
import { validateArtifact } from "./artifact-contracts.js";
import { spawnSync } from "node:child_process";
import type { ProcessPort, ProcessResult } from "./runtime.js";

export interface RecordDiffArguments {
  readonly mode: "record";
  readonly task: string | number;
  readonly changeDir?: string;
}

export interface TaskDiffArguments {
  readonly mode: "task";
  readonly task: string | number;
  readonly changeDir?: string;
  readonly out?: string;
}

export interface BaseDiffArguments {
  readonly mode: "base";
  readonly base: string;
  readonly changeDir?: string;
  readonly out?: string;
}

export interface WholeChangeDiffArguments {
  readonly mode: "whole-change";
  readonly out?: string;
  readonly changeDir?: string;
}

export type DiffArguments =
  | RecordDiffArguments
  | TaskDiffArguments
  | BaseDiffArguments
  | WholeChangeDiffArguments;

export type DiffOperation = DiffArguments["mode"];
export type DiffResultStatus = "success" | "negative" | "error";

export interface DiffResult {
  readonly _tag: "DiffResult";
  readonly operation: DiffOperation;
  readonly status: DiffResultStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly string[];
  readonly lastLine: string;
}

export interface DiffFileSystemPort extends ArtifactFileSystem {
  readonly pathExists: (sourcePath: string) => boolean | Promise<boolean>;
  readonly directoryExists: (sourcePath: string) => boolean | Promise<boolean>;
  readonly realpath: (sourcePath: string) => string | Promise<string>;
  readonly writeFile: (
    sourcePath: string,
    content: string,
  ) => void | Promise<void>;
  readonly mkdir: (sourcePath: string) => void | Promise<void>;
  readonly appendFile: (
    sourcePath: string,
    content: string,
  ) => void | Promise<void>;
  readonly makeTempFile: (label: string) => string | Promise<string>;
}

export interface DiffGitPort {
  readonly repositoryRoot: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly commonDirectory: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly currentHead: (cwd: string) => ProcessResult | Promise<ProcessResult>;
  readonly resolveCommit: (
    cwd: string,
    ref: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly isAncestor: (
    cwd: string,
    base: string,
    head: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly remoteDefaultBranch: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly mergeBase: (
    cwd: string,
    ref: string,
    head: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly ignored: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly diffStat: (
    cwd: string,
    base: string,
    head: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly diff: (
    cwd: string,
    base: string,
    head: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly changedFiles: (
    cwd: string,
    base: string,
    head: string,
  ) => ProcessResult | Promise<ProcessResult>;
}

export interface DiffRuntime {
  readonly cwd: () => string;
  readonly fileSystem: DiffFileSystemPort;
  readonly git: DiffGitPort;
}

export interface DiffRuntimeOverrides {
  readonly cwd?: () => string;
  readonly process?: ProcessPort;
  readonly fileSystem?: DiffFileSystemPort;
  readonly git?: DiffGitPort;
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

const productionFileSystem: DiffFileSystemPort = {
  readFile: (sourcePath) => Fs.readFile(sourcePath, "utf8"),
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
  writeFile: (sourcePath, content) => Fs.writeFile(sourcePath, content),
  mkdir: async (sourcePath) => {
    await Fs.mkdir(sourcePath, { recursive: true });
  },
  appendFile: (sourcePath, content) => Fs.appendFile(sourcePath, content),
  makeTempFile: async (label) => {
    const directory = await Fs.mkdtemp(
      Path.join(Os.tmpdir(), `hamilton-diff-${label}-`),
    );
    return Path.join(directory, "package.diff");
  },
};

const createGitPort = (processPort: ProcessPort): DiffGitPort => ({
  repositoryRoot: (cwd) =>
    processPort.run("git", ["rev-parse", "--show-toplevel"], cwd),
  commonDirectory: (cwd) =>
    processPort.run("git", ["rev-parse", "--git-common-dir"], cwd),
  currentHead: (cwd) => processPort.run("git", ["rev-parse", "HEAD"], cwd),
  resolveCommit: (cwd, ref) =>
    processPort.run("git", ["rev-parse", "--verify", `${ref}^{commit}`], cwd),
  isAncestor: (cwd, base, head) =>
    processPort.run("git", ["merge-base", "--is-ancestor", base, head], cwd),
  remoteDefaultBranch: (cwd) =>
    processPort.run(
      "git",
      ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"],
      cwd,
    ),
  mergeBase: (cwd, ref, head) =>
    processPort.run("git", ["merge-base", ref, head], cwd),
  ignored: (cwd, sourcePath) =>
    processPort.run("git", ["check-ignore", "-q", "--", sourcePath], cwd),
  diffStat: (cwd, base, head) =>
    processPort.run("git", ["diff", "--stat", `${base}..${head}`], cwd),
  diff: (cwd, base, head) =>
    processPort.run("git", ["diff", "-U10", `${base}..${head}`], cwd),
  changedFiles: (cwd, base, head) =>
    processPort.run("git", ["diff", "--name-only", `${base}..${head}`], cwd),
});

export const createDiffRuntime = (
  overrides: DiffRuntimeOverrides = {},
): DiffRuntime => {
  const processPort = overrides.process ?? productionProcess;
  return {
    cwd: overrides.cwd ?? (() => process.cwd()),
    fileSystem: overrides.fileSystem ?? productionFileSystem,
    git: overrides.git ?? createGitPort(processPort),
  };
};

const linesOf = (stdout: string): readonly string[] =>
  stdout.split("\n").filter((line) => line !== "");

const result = (
  operation: DiffOperation,
  status: DiffResultStatus,
  exitCode: 0 | 1 | 2,
  stdout = "",
  stderr = "",
): DiffResult => {
  const lines = linesOf(stdout);
  return {
    _tag: "DiffResult",
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
  operation: DiffOperation,
  message: string,
  exitCode: 1 | 2 = 2,
): DiffResult =>
  result(operation, "error", exitCode, "", `error: ${message}\n`);

const negative = (operation: DiffOperation, message: string): DiffResult =>
  result(operation, "negative", 1, "", `error: ${message}\n`);

const successful = (command: ProcessResult): boolean => command.status === 0;
const text = (command: ProcessResult): string => command.stdout.trim();

const commandError = (
  operation: DiffOperation,
  action: string,
  command: ProcessResult,
): DiffResult => {
  const detail = command.stderr.trim();
  return failure(operation, `${action}${detail === "" ? "" : `: ${detail}`}`);
};

const stripComments = (source: string): string => {
  let output = "";
  let remaining = source;
  while (remaining !== "") {
    const opening = remaining.indexOf("<!--");
    if (opening < 0) return output + remaining;
    output += remaining.slice(0, opening);
    const closing = remaining.indexOf("-->", opening + 4);
    if (closing < 0) return output;
    remaining = remaining.slice(closing + 3);
  }
  return output;
};

const taskNumber = (task: string | number): string => String(task);

const validTaskNumber = (task: string): boolean => /^[1-9][0-9]*$/.test(task);

const readText = async (
  runtime: DiffRuntime,
  sourcePath: string,
): Promise<string | DiffResult> => {
  try {
    return await runtime.fileSystem.readFile(sourcePath);
  } catch (error) {
    return failure("record", `cannot read ${sourcePath}: ${String(error)}`);
  }
};

const validatePlanArtifact = async (
  plan: string,
  source: string,
): Promise<ArtifactReadResult | undefined> => {
  const reader = createArtifactReader({ readFile: () => source });
  const artifact = await reader(plan);
  if (artifact._tag === "recognized") {
    const contract = validateArtifact(artifact);
    if (contract._tag === "invalid") return artifact;
  }
  return artifact;
};

const resolveTask = async (
  runtime: DiffRuntime,
  operation: DiffOperation,
  changeDir: string,
  task: string,
): Promise<string | DiffResult> => {
  if (!validTaskNumber(task))
    return failure(operation, "task must be an exact positive task number");
  const planPath = Path.join(changeDir, "plan.md");
  const source = await readText(runtime, planPath);
  if (typeof source !== "string") return { ...source, operation };
  const artifact = await validatePlanArtifact(planPath, source);
  if (artifact?._tag === "invalid")
    return failure(operation, artifact.diagnostic.message);
  if (artifact?._tag === "recognized") {
    const contract = validateArtifact(artifact);
    if (contract._tag === "invalid")
      return failure(
        operation,
        contract.diagnostics[0]?.message ?? "invalid plan",
      );
  }
  const visible = stripComments(source);
  const matches = [
    ...visible.matchAll(/^### Task ([1-9][0-9]*):[ \t]+(.+)$/gm),
  ].filter((match) => match[1] === task);
  const all = [...visible.matchAll(/^### Task ([1-9][0-9]*):[ \t]+(.+)$/gm)];
  if (all.filter((match) => match[1] === task).length > 1)
    return failure(operation, `duplicate Task ${task} in ${planPath}`);
  const match = matches[0];
  if (!match)
    return failure(operation, `task ${task} is not active in ${planPath}`);
  if (/\(abandoned — .+\)$/.test(match[2] ?? ""))
    return failure(operation, `task ${task} is abandoned in ${planPath}`);
  return match[2] ?? "";
};

const taskBaseFile = (changeDir: string, task: string): string =>
  Path.join(changeDir, "tasks", `task-${task}`, ".base");

const taskRowStatus = async (
  runtime: DiffRuntime,
  changeDir: string,
  task: string,
): Promise<string | DiffResult> => {
  const progressPath = Path.join(changeDir, "progress.md");
  const source = await readText(runtime, progressPath);
  if (typeof source !== "string") return { ...source, operation: "record" };
  const visible = stripComments(source);
  const pattern = new RegExp(
    `^\\|[ \\t]*Task ${task}:[^|]+\\|[ \\t]*(pending|in-progress|blocked|done)[ \\t]*\\|[ \\t]*\\[details\\]\\(tasks/task-${task}/progress\\.md\\)[ \\t]*\\|[ \\t]*$`,
    "gm",
  );
  const matches = [...visible.matchAll(pattern)];
  if (matches.length !== 1)
    return failure(
      "record",
      `cannot create a checkpoint without one exact split row for Task ${task}`,
    );
  return matches[0]?.[1] ?? "";
};

const hasAttempt = (source: string): boolean =>
  /^##(?:[ \t]|$)/m.test(stripComments(source));

const canRecordFirst = async (
  runtime: DiffRuntime,
  changeDir: string,
  task: string,
): Promise<DiffResult | undefined> => {
  const rootProgress = Path.join(changeDir, "progress.md");
  const taskProgress = Path.join(
    changeDir,
    "tasks",
    `task-${task}`,
    "progress.md",
  );
  const feedback = Path.join(changeDir, "tasks", `task-${task}`, "feedback.md");
  if (!(await runtime.fileSystem.pathExists(rootProgress)))
    return failure(
      "record",
      `cannot create a checkpoint without the split root task ledger: ${rootProgress}`,
    );
  if (!(await runtime.fileSystem.pathExists(taskProgress)))
    return failure(
      "record",
      `cannot create a checkpoint without the task progress file: ${taskProgress}`,
    );
  const status = await taskRowStatus(runtime, changeDir, task);
  if (typeof status !== "string") return status;
  let progressSource: string;
  try {
    progressSource = await runtime.fileSystem.readFile(taskProgress);
  } catch (error) {
    return failure("record", `cannot read ${taskProgress}: ${String(error)}`);
  }
  if (
    status !== "pending" ||
    hasAttempt(progressSource) ||
    (await runtime.fileSystem.pathExists(feedback))
  )
    return failure(
      "record",
      `cannot create missing checkpoint for Task ${task} after durable task evidence; historical recovery requires unambiguous durable git and task evidence or intervention`,
    );
  return undefined;
};

const resolveChangeDir = async (
  runtime: DiffRuntime,
  supplied: string | undefined,
  operation: DiffOperation,
): Promise<string | DiffResult | undefined> => {
  if (supplied !== undefined) {
    if (!(await runtime.fileSystem.directoryExists(supplied)))
      return failure(operation, `change dir does not exist: ${supplied}`);
    try {
      return await runtime.fileSystem.realpath(supplied);
    } catch (error) {
      return failure(
        operation,
        `cannot resolve change dir ${supplied}: ${String(error)}`,
      );
    }
  }
  let current: string;
  try {
    current = await runtime.fileSystem.realpath(runtime.cwd());
  } catch (error) {
    return failure(
      operation,
      `cannot resolve current directory: ${String(error)}`,
    );
  }
  const parts = current.split(Path.sep);
  const index = parts.lastIndexOf(".hamilton");
  if (index >= 0 && parts[index + 1] === "changes" && parts[index + 2]) {
    const changeDir = parts.slice(0, index + 3).join(Path.sep) || Path.sep;
    if (await runtime.fileSystem.directoryExists(changeDir)) return changeDir;
  }
  return undefined;
};

const repositoryRoot = async (
  runtime: DiffRuntime,
  operation: DiffOperation,
  cwd: string,
): Promise<string | DiffResult> => {
  const command = await runtime.git.repositoryRoot(cwd);
  if (!successful(command))
    return commandError(operation, "not inside a git repository", command);
  const root = text(command);
  return root === ""
    ? failure(operation, "cannot resolve repository root")
    : root;
};

const fullCommit = async (
  runtime: DiffRuntime,
  operation: DiffOperation,
  root: string,
  reference: string,
  label: string,
): Promise<string | DiffResult> => {
  const command = await runtime.git.resolveCommit(root, reference);
  const resolved = text(command);
  if (!successful(command) || !/^[0-9a-f]{40}$/.test(resolved))
    return failure(
      operation,
      `${label} is not a commit in this repository: ${reference}`,
    );
  return resolved;
};

const readCheckpoint = async (
  runtime: DiffRuntime,
  operation: DiffOperation,
  checkpoint: string,
  root: string,
): Promise<string | DiffResult> => {
  let value: string;
  try {
    value = await runtime.fileSystem.readFile(checkpoint);
  } catch (error) {
    return failure(operation, `cannot read ${checkpoint}: ${String(error)}`);
  }
  const candidate = value.endsWith("\n") ? value.slice(0, -1) : value;
  if (!/^[0-9a-f]{40}$/.test(candidate))
    return failure(
      operation,
      `task checkpoint ${checkpoint} must contain exactly one full commit ID`,
    );
  const resolved = await fullCommit(
    runtime,
    operation,
    root,
    candidate,
    `task checkpoint ${checkpoint}`,
  );
  if (typeof resolved !== "string")
    return failure(
      operation,
      `task checkpoint ${checkpoint} must contain exactly one full commit ID`,
    );
  if (resolved !== candidate)
    return failure(
      operation,
      `task checkpoint ${checkpoint} must contain exactly one full commit ID`,
    );
  return candidate;
};

const ensureIgnored = async (
  runtime: DiffRuntime,
  operation: DiffOperation,
  root: string,
  checkpoint: string,
): Promise<string | DiffResult> => {
  const ignored = await runtime.git.ignored(root, checkpoint);
  if (ignored.status === 0) return "";
  if (ignored.status !== 1)
    return commandError(
      operation,
      "cannot inspect checkpoint ignore rule",
      ignored,
    );
  const common = await runtime.git.commonDirectory(root);
  if (!successful(common))
    return commandError(
      operation,
      "cannot resolve Git common directory",
      common,
    );
  const commonPath = text(common);
  const exclude = Path.isAbsolute(commonPath)
    ? Path.join(commonPath, "info", "exclude")
    : Path.join(root, commonPath, "info", "exclude");
  const relative = Path.relative(root, checkpoint);
  let existing = "";
  if (await runtime.fileSystem.pathExists(exclude)) {
    try {
      existing = await runtime.fileSystem.readFile(exclude);
    } catch (error) {
      return failure(operation, `cannot read ${exclude}: ${String(error)}`);
    }
  }
  if (existing.split(/\r?\n/).some((line) => line === relative)) return "";
  try {
    await runtime.fileSystem.mkdir(Path.dirname(exclude));
    await runtime.fileSystem.appendFile(
      exclude,
      `${existing !== "" && !existing.endsWith("\n") ? "\n" : ""}${relative}\n`,
    );
  } catch (error) {
    return failure(operation, `cannot write ${exclude}: ${String(error)}`);
  }
  return `ignored: added ${relative} to ${exclude}`;
};

const recordCheckpoint = async (
  args: RecordDiffArguments,
  runtime: DiffRuntime,
): Promise<DiffResult> => {
  const operation = args.mode;
  const task = taskNumber(args.task);
  const change = await resolveChangeDir(runtime, args.changeDir, operation);
  if (typeof change !== "string")
    return (
      change ??
      failure(
        operation,
        "not inside a change directory — pass --change-dir <dir>",
      )
    );
  const root = await repositoryRoot(runtime, operation, change);
  if (typeof root !== "string") return root;
  const taskValidation = await resolveTask(runtime, operation, change, task);
  if (typeof taskValidation !== "string") return taskValidation;
  const checkpoint = taskBaseFile(change, task);
  let base: string;
  const outputs: string[] = [];
  if (await runtime.fileSystem.pathExists(checkpoint)) {
    const checked = await readCheckpoint(runtime, operation, checkpoint, root);
    if (typeof checked !== "string") return checked;
    base = checked;
    const head = await fullCommit(
      runtime,
      operation,
      root,
      "HEAD",
      "cannot resolve HEAD",
    );
    if (typeof head !== "string") return head;
    const ancestor = await runtime.git.isAncestor(root, base, head);
    if (ancestor.status !== 0)
      return commandError(
        operation,
        `task checkpoint is not an ancestor of HEAD: ${base}`,
        ancestor,
      );
  } else {
    const first = await canRecordFirst(runtime, change, task);
    if (first) return first;
    base = (await fullCommit(
      runtime,
      operation,
      root,
      "HEAD",
      "cannot resolve HEAD",
    )) as string;
    if (typeof base !== "string") return base;
    try {
      await runtime.fileSystem.mkdir(Path.dirname(checkpoint));
      await runtime.fileSystem.writeFile(checkpoint, `${base}\n`);
    } catch (error) {
      return failure(operation, `cannot write ${checkpoint}: ${String(error)}`);
    }
  }
  const ignored = await ensureIgnored(runtime, operation, root, checkpoint);
  if (typeof ignored !== "string") return ignored;
  if (ignored !== "") outputs.push(ignored);
  outputs.push(`base: ${base}`, checkpoint);
  return result(operation, "success", 0, `${outputs.join("\n")}\n`);
};

const packageRange = async (
  runtime: DiffRuntime,
  operation: DiffOperation,
  root: string,
  base: string,
  head: string,
  label: string,
  out: string | undefined,
): Promise<DiffResult> => {
  const stat = await runtime.git.diffStat(root, base, head);
  if (!successful(stat))
    return commandError(operation, "git diff --stat failed", stat);
  const patch = await runtime.git.diff(root, base, head);
  if (!successful(patch))
    return commandError(operation, "git diff failed", patch);
  const files = await runtime.git.changedFiles(root, base, head);
  if (!successful(files))
    return commandError(operation, "git diff --name-only failed", files);
  let output: string;
  try {
    output =
      out === undefined
        ? await runtime.fileSystem.makeTempFile(label)
        : Path.isAbsolute(out)
          ? out
          : Path.join(root, out);
    const content = `# Hamilton diff package\n# range: ${base}..${head}\n\n## git diff --stat ${base}..${head}\n\n${stat.stdout}\n## git diff -U10 ${base}..${head}\n\n${patch.stdout}`;
    await runtime.fileSystem.writeFile(output, content);
  } catch (error) {
    return failure(
      operation,
      `cannot write ${out ?? "scratch package"}: ${String(error)}`,
    );
  }
  const fileCount =
    files.stdout === "" ? 0 : files.stdout.trimEnd().split("\n").length;
  const stdout = `Base: ${base}\nHead: ${head}\nrange: ${base}..${head}\nfiles-changed: ${fileCount}\nPackage: ${output}\n${output}\n`;
  return result(operation, "success", 0, stdout);
};

const packageTask = async (
  args: TaskDiffArguments,
  runtime: DiffRuntime,
): Promise<DiffResult> => {
  const operation = args.mode;
  const task = taskNumber(args.task);
  const change = await resolveChangeDir(runtime, args.changeDir, operation);
  if (typeof change !== "string")
    return (
      change ??
      failure(
        operation,
        "not inside a change directory — pass --change-dir <dir>",
      )
    );
  const root = await repositoryRoot(runtime, operation, change);
  if (typeof root !== "string") return root;
  const validation = await resolveTask(runtime, operation, change, task);
  if (typeof validation !== "string") return validation;
  const checkpoint = taskBaseFile(change, task);
  if (!(await runtime.fileSystem.pathExists(checkpoint)))
    return negative(
      operation,
      `no BASE recorded for Task ${task} — run --record before dispatching an implementer`,
    );
  let content: string;
  try {
    content = await runtime.fileSystem.readFile(checkpoint);
  } catch (error) {
    return negative(
      operation,
      `${checkpoint} is unreadable — re-run --record: ${String(error)}`,
    );
  }
  if (content.trim() === "")
    return negative(operation, `${checkpoint} is empty — re-run --record`);
  const base = await readCheckpoint(runtime, operation, checkpoint, root);
  if (typeof base !== "string") return base;
  const head = await fullCommit(
    runtime,
    operation,
    root,
    "HEAD",
    "cannot resolve HEAD",
  );
  if (typeof head !== "string") return head;
  const ancestor = await runtime.git.isAncestor(root, base, head);
  if (ancestor.status !== 0)
    return commandError(
      operation,
      `BASE is not an ancestor of HEAD: ${base}`,
      ancestor,
    );
  if (base === head)
    return negative(
      operation,
      `BASE equals HEAD (${base}) — nothing has been committed since --record`,
    );
  return packageRange(
    runtime,
    operation,
    root,
    base,
    head,
    `task-${task}`,
    args.out,
  );
};

const baseForArguments = async (
  args: BaseDiffArguments,
  runtime: DiffRuntime,
): Promise<{ readonly root: string; readonly base: string } | DiffResult> => {
  const operation = args.mode;
  const change = await resolveChangeDir(runtime, args.changeDir, operation);
  let root: string | DiffResult;
  if (typeof change === "string")
    root = await repositoryRoot(runtime, operation, change);
  else if (change === undefined)
    root = await repositoryRoot(runtime, operation, runtime.cwd());
  else return change;
  if (typeof root !== "string") return root;
  const base = await fullCommit(runtime, operation, root, args.base, "BASE");
  return typeof base === "string" ? { root, base } : base;
};

const packageBase = async (
  args: BaseDiffArguments,
  runtime: DiffRuntime,
): Promise<DiffResult> => {
  const resolved = await baseForArguments(args, runtime);
  if ("exitCode" in resolved) return resolved;
  const head = await fullCommit(
    runtime,
    args.mode,
    resolved.root,
    "HEAD",
    "cannot resolve HEAD",
  );
  if (typeof head !== "string") return head;
  if (resolved.base === head)
    return negative(
      args.mode,
      `BASE equals HEAD (${resolved.base}) — nothing has been committed since --record`,
    );
  return packageRange(
    runtime,
    args.mode,
    resolved.root,
    resolved.base,
    head,
    "explicit-base",
    args.out,
  );
};

const defaultBranch = async (
  runtime: DiffRuntime,
  root: string,
): Promise<string | DiffResult> => {
  const remoteHead = await runtime.git.remoteDefaultBranch(root);
  if (successful(remoteHead)) {
    const ref = text(remoteHead).replace(/^refs\/remotes\//, "");
    if (
      ref !== "" &&
      typeof (await fullCommit(
        runtime,
        "whole-change",
        root,
        ref,
        "default branch",
      )) === "string"
    )
      return ref;
  }
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    const commit = await runtime.git.resolveCommit(root, candidate);
    if (successful(commit) && /^[0-9a-f]{40}$/.test(text(commit)))
      return candidate;
  }
  return failure(
    "whole-change",
    "cannot determine the default branch (no origin/HEAD, main, or master)",
  );
};

const packageWholeChange = async (
  args: WholeChangeDiffArguments,
  runtime: DiffRuntime,
): Promise<DiffResult> => {
  const root = await repositoryRoot(runtime, args.mode, runtime.cwd());
  if (typeof root !== "string") return root;
  const ref = await defaultBranch(runtime, root);
  if (typeof ref !== "string") return ref;
  const head = await fullCommit(
    runtime,
    args.mode,
    root,
    "HEAD",
    "cannot resolve HEAD",
  );
  if (typeof head !== "string") return head;
  const merge = await runtime.git.mergeBase(root, ref, head);
  if (!successful(merge))
    return commandError(
      args.mode,
      `cannot compute merge-base against ${ref}`,
      merge,
    );
  const base = text(merge);
  if (!/^[0-9a-f]{40}$/.test(base))
    return failure(args.mode, `cannot compute merge-base against ${ref}`);
  if (base === head)
    return negative(
      args.mode,
      `HEAD is at the merge-base with ${ref} — this branch has no commits to review`,
    );
  const packaged = await packageRange(
    runtime,
    args.mode,
    root,
    base,
    head,
    "whole-change",
    args.out,
  );
  if (packaged.exitCode !== 0) return packaged;
  return result(
    args.mode,
    "success",
    0,
    `default-branch: ${ref}\n${packaged.stdout}`,
  );
};

export const diff = async (
  args: DiffArguments,
  runtime: DiffRuntime = createDiffRuntime(),
): Promise<DiffResult> => {
  if (args.mode === "record") return recordCheckpoint(args, runtime);
  if (args.mode === "task") return packageTask(args, runtime);
  if (args.mode === "base") return packageBase(args, runtime);
  if (args.changeDir !== undefined)
    return failure(
      args.mode,
      "--change-dir is meaningless with --whole-change",
    );
  return packageWholeChange(args, runtime);
};

export const renderDiffResult = (diffResult: DiffResult): string =>
  diffResult.stdout.trimEnd() === ""
    ? diffResult.stderr.trimEnd()
    : diffResult.stdout.trimEnd();
