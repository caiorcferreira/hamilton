import * as Path from "node:path";
import { createArtifactReader } from "./artifact-reader.js";
import {
  createArtifactBodyView,
  validateArtifact,
  type ArtifactContractResult,
  type ValidArtifactContract,
} from "./artifact-contracts.js";
import {
  createRuntime,
  type ProcessPort,
  type ProcessResult,
} from "./runtime.js";

export interface PreconditionArguments {
  readonly changeDir: string;
  readonly testCommand: string;
  readonly wholeChangeWaived?: boolean;
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
  readonly readFile?: (sourcePath: string) => string | Promise<string>;
}

export interface PreconditionGitPort {
  readonly repositoryRoot: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly statusPorcelain: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly currentHead?: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly resolveCommit?: (
    cwd: string,
    reference: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly isAncestor?: (
    cwd: string,
    base: string,
    head: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly headBlob?: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly worktreeBlob?: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly stagedDiff?: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly latestCommit?: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly commitFiles?: (
    cwd: string,
    commit: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly latestMaterialCommit?: (
    cwd: string,
    changePath: string,
    taskPaths: readonly string[],
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

export const createPreconditionRuntime = (
  overrides: PreconditionRuntimeOverrides = {},
): PreconditionRuntime => {
  const runtime = createRuntime({
    cwd: overrides.cwd,
    process: overrides.process,
  });
  return {
    cwd: runtime.cwd,
    process: runtime.process,
    fileSystem: overrides.fileSystem ?? runtime.fileSystem,
    git: overrides.git ?? {
      repositoryRoot: runtime.git.repositoryRoot,
      statusPorcelain: runtime.git.statusPorcelain,
    },
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
): Promise<
  { readonly output: string; readonly clean: boolean } | PreconditionResult
> => {
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
    return failure(
      `cannot resolve change dir ${args.changeDir}: ${String(error)}`,
    );
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
  if (reportedRoot === "")
    return failure("cannot resolve target repository root");
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

const successful = (command: ProcessResult): boolean => command.status === 0;
const fullCommit = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
const relativePath = (root: string, sourcePath: string): string =>
  Path.relative(root, sourcePath).split(Path.sep).join("/");

const gitCommand = async (
  runtime: PreconditionRuntime,
  args: readonly string[],
  root: string,
): Promise<ProcessResult> => runtime.process.run("git", args, root);

const gitCurrentHead = async (
  runtime: PreconditionRuntime,
  root: string,
): Promise<ProcessResult> =>
  runtime.git.currentHead
    ? runtime.git.currentHead(root)
    : gitCommand(runtime, ["rev-parse", "HEAD"], root);

const gitResolveCommit = async (
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

const gitIsAncestor = async (
  runtime: PreconditionRuntime,
  root: string,
  base: string,
  head: string,
): Promise<ProcessResult> =>
  runtime.git.isAncestor
    ? runtime.git.isAncestor(root, base, head)
    : gitCommand(runtime, ["merge-base", "--is-ancestor", base, head], root);

const gitHeadBlob = async (
  runtime: PreconditionRuntime,
  root: string,
  sourcePath: string,
): Promise<ProcessResult> =>
  runtime.git.headBlob
    ? runtime.git.headBlob(root, sourcePath)
    : gitCommand(runtime, ["rev-parse", `HEAD:${sourcePath}`], root);

const gitWorktreeBlob = async (
  runtime: PreconditionRuntime,
  root: string,
  sourcePath: string,
): Promise<ProcessResult> =>
  runtime.git.worktreeBlob
    ? runtime.git.worktreeBlob(root, sourcePath)
    : gitCommand(runtime, ["hash-object", "--", sourcePath], root);

const gitStagedDiff = async (
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

const gitLatestCommit = async (
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

const gitCommitFiles = async (
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

const gitLatestMaterialCommit = async (
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

interface EvidenceRead {
  readonly artifact?: ValidArtifactContract;
  readonly source?: string;
  readonly reason?: string;
}

const readContract = async (
  runtime: PreconditionRuntime,
  path: string,
  expected: ValidArtifactContract["artifact"],
): Promise<EvidenceRead> => {
  if (!(await runtime.fileSystem.pathExists(path)))
    return { reason: "missing" };
  if (!runtime.fileSystem.readFile) return { reason: "cannot read" };
  let source: string;
  try {
    source = await runtime.fileSystem.readFile(path);
  } catch {
    return { reason: "cannot read" };
  }
  const artifact = await createArtifactReader({ readFile: () => source })(path);
  const contract: ArtifactContractResult = validateArtifact(artifact);
  if (contract._tag !== "valid" || contract.artifact !== expected)
    return { reason: "malformed" };
  return { artifact: contract, source };
};

const durableArtifact = async (
  runtime: PreconditionRuntime,
  root: string,
  path: string,
): Promise<boolean> => {
  const relative = relativePath(root, path);
  if (relative.startsWith("..") || Path.isAbsolute(relative)) return false;
  const head = await gitHeadBlob(runtime, root, relative);
  const worktree = await gitWorktreeBlob(runtime, root, relative);
  if (
    !successful(head) ||
    !successful(worktree) ||
    text(head) !== text(worktree)
  )
    return false;
  return (await gitStagedDiff(runtime, root, relative)).status === 0;
};

const exactArtifactCommit = async (
  runtime: PreconditionRuntime,
  root: string,
  path: string,
): Promise<boolean> => {
  if (!(await durableArtifact(runtime, root, path))) return false;
  const commit = text(
    await gitLatestCommit(runtime, root, relativePath(root, path)),
  );
  if (!fullCommit(commit)) return false;
  const files = (await gitCommitFiles(runtime, root, commit)).stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  return files.length === 1 && files[0] === relativePath(root, path);
};

interface TaskEvidence {
  readonly task: number;
  readonly title: string;
  readonly status: string;
  readonly progressPath: string;
  readonly feedbackPath: string;
  readonly implementation?: string;
}

interface TaskInspection {
  readonly passed: boolean;
  readonly output: string;
  readonly tasks: readonly TaskEvidence[];
  readonly planTitle?: string;
  readonly planDurable: boolean;
  readonly changePath: string;
}

const titleOf = (
  artifact: ValidArtifactContract,
  prefix: string,
): string | undefined => {
  const titles = artifact.body.headings.filter(
    (heading) => heading.level === 1,
  );
  if (titles.length !== 1 || !titles[0]?.text.startsWith(prefix))
    return undefined;
  return titles[0].text.slice(prefix.length);
};

const taskTitleAbandoned = (title: string): boolean =>
  /\(abandoned — .+\)$/.test(title);

const inspectTasks = async (
  runtime: PreconditionRuntime,
  root: string,
  changeDir: string,
): Promise<TaskInspection> => {
  const changePath = relativePath(root, changeDir);
  const planPath = Path.join(changeDir, "plan.md");
  const progressPath = Path.join(changeDir, "progress.md");
  const problems: string[] = [];
  const planDurable = await durableArtifact(runtime, root, planPath);
  const progressDurable = await durableArtifact(runtime, root, progressPath);
  if (!planDurable)
    problems.push("plan.md is not tracked and committed exactly at HEAD");
  if (!progressDurable)
    problems.push("progress.md is not tracked and committed exactly at HEAD");
  const planRead = await readContract(runtime, planPath, "plan");
  const progressRead = await readContract(runtime, progressPath, "progress");
  const planTitle = planRead.artifact
    ? titleOf(planRead.artifact, "Plan: ")
    : undefined;
  if (!planRead.artifact) problems.push(`plan.md ${planRead.reason}`);
  if (!progressRead.artifact)
    problems.push(`progress.md ${progressRead.reason}`);
  if (!planTitle) problems.push("plan title is malformed");
  if (problems.length > 0)
    return {
      passed: false,
      output: `[FAIL] Tasks (${problems.join("; ")})\n`,
      tasks: [],
      planTitle,
      planDurable,
      changePath,
    };
  const planArtifact = planRead.artifact;
  const progressArtifact = progressRead.artifact;
  if (!planArtifact || !progressArtifact)
    return {
      passed: false,
      output: `[FAIL] Tasks (${problems.join("; ")})\n`,
      tasks: [],
      planTitle,
      planDurable,
      changePath,
    };
  const planRecords = planArtifact.body.workflow.records.filter(
    (record) => record.kind === "task",
  );
  const activePlans = planRecords.filter(
    (record) => !taskTitleAbandoned(record.title ?? ""),
  );
  const progressRecords = progressArtifact.body.workflow.records.filter(
    (record) => record.kind === "task",
  );
  if (
    activePlans.length !== progressRecords.length ||
    activePlans.some(
      (record, index) =>
        record.number !== progressRecords[index]?.number ||
        record.title !== progressRecords[index]?.title,
    )
  )
    problems.push("plan and progress ledgers do not match");
  const metadataTasks = progressArtifact.metadata.tasks;
  if (
    !Array.isArray(metadataTasks) ||
    metadataTasks.length !== progressRecords.length
  ) {
    problems.push("progress metadata ledger does not match");
  } else {
    for (const [index, value] of metadataTasks.entries()) {
      const record = progressRecords[index];
      if (
        typeof value !== "object" ||
        value === null ||
        Array.isArray(value) ||
        value.id !== record?.number ||
        value.title !== record?.title ||
        value.status !== record?.fields.Status ||
        value.progress !== `tasks/task-${String(value.id)}/progress.md` ||
        `[details](${value.progress})` !== record?.fields.Progress
      )
        problems.push("progress metadata ledger does not match");
    }
  }
  const tasks: TaskEvidence[] = [];
  for (const record of activePlans) {
    const task = record.number ?? 0;
    const progressRecord = progressRecords.find(
      (candidate) => candidate.number === task,
    );
    const status = progressRecord?.fields.Status ?? "";
    if (status !== "done")
      problems.push(`Task ${task} status: ${status || "missing"}`);
    const taskPath = Path.join(
      changeDir,
      "tasks",
      `task-${task}`,
      "progress.md",
    );
    const taskRead = await readContract(runtime, taskPath, "task-progress");
    if (!taskRead.artifact) {
      problems.push(`Task ${task} progress ${taskRead.reason}`);
      continue;
    }
    if (
      taskRead.artifact.metadata.task !== task ||
      taskRead.artifact.metadata.change !== Path.basename(changeDir)
    ) {
      problems.push(`Task ${task} progress identity is malformed`);
      continue;
    }
    const taskProgressStatus = taskRead.artifact.metadata.status;
    if (taskProgressStatus !== "done")
      problems.push(
        `Task ${task} progress status: ${String(taskProgressStatus ?? "missing")}`,
      );
    const attempts = taskRead.artifact.body.workflow.records.filter(
      (candidate) => candidate.kind === "attempt",
    );
    const latest = attempts.at(-1);
    if (latest?.fields.Outcome !== "done")
      problems.push(`Task ${task} latest attempt is not done`);
    const implementation = text(
      await gitLatestCommit(runtime, root, relativePath(root, taskPath)),
    );
    tasks.push({
      task,
      title: record.title ?? "",
      status,
      progressPath: relativePath(root, taskPath),
      feedbackPath: relativePath(
        root,
        Path.join(changeDir, "tasks", `task-${task}`, "feedback.md"),
      ),
      ...(fullCommit(implementation) ? { implementation } : {}),
    });
  }
  return {
    passed: problems.length === 0,
    output:
      problems.length === 0
        ? `[PASS] Tasks (${tasks.length} implemented)\n`
        : `[FAIL] Tasks (${problems.join("; ")})\n`,
    tasks,
    planTitle,
    planDurable,
    changePath,
  };
};

const blockingFinding = (value: string): boolean => {
  const match = /^- \[(.+)\] (.+)$/.exec(value);
  if (!match) return false;
  const locations = match[1] ?? "";
  const action = match[2] ?? "";
  if (
    locations.includes("<") ||
    locations.includes(">") ||
    action.includes("<") ||
    action.includes(">")
  )
    return false;
  if (action.replace(/[\s\p{P}]/gu, "").toLowerCase() === "tbd") return false;
  return locations.split(";").every((location) => {
    const separator = location.indexOf(":");
    return separator > 0 && location.slice(separator + 1).trim() !== "";
  });
};

const passSections = (
  artifact: ValidArtifactContract,
  source: string,
  pass: ValidArtifactContract["body"]["workflow"]["records"][number],
):
  | {
      readonly blocking: readonly string[];
      readonly suggestions: readonly string[];
    }
  | undefined => {
  if (pass.kind !== "pass") return undefined;
  const allLines = source.split(/\r\n|\n|\r/);
  let delimiters = 0;
  const closeIndex = allLines.findIndex((line) => {
    if (line.trim() !== "---" && line.trim() !== "...") return false;
    delimiters += 1;
    return delimiters === 2;
  });
  if (closeIndex < 0) return undefined;
  const lines = createArtifactBodyView(
    allLines.slice(closeIndex + 1).join("\n"),
  ).lines;
  const passIndex = pass.line - (closeIndex + 2);
  const end = lines.findIndex(
    (line, index) => index > passIndex && /^##[ \t]+/.test(line),
  );
  const sectionLines = lines.slice(passIndex + 1, end < 0 ? lines.length : end);
  const blockingIndex = sectionLines.findIndex((line) =>
    /^###[ \t]+Blocking$/.test(line),
  );
  const suggestionsIndex = sectionLines.findIndex((line) =>
    /^###[ \t]+Suggestions$/.test(line),
  );
  if (blockingIndex < 0 || suggestionsIndex < blockingIndex) return undefined;
  return {
    blocking: sectionLines
      .slice(blockingIndex + 1, suggestionsIndex)
      .map((line) => line.trim())
      .filter(Boolean),
    suggestions: sectionLines
      .slice(suggestionsIndex + 1)
      .map((line) => line.trim())
      .filter(Boolean),
  };
};

const validPassContent = (
  artifact: ValidArtifactContract,
  source: string,
  verdict: string,
): boolean => {
  const passes = artifact.body.workflow.records.filter(
    (record) => record.kind === "pass",
  );
  if (passes.length === 0) return false;
  for (const pass of passes) {
    const sections = passSections(artifact, source, pass);
    if (!sections) return false;
    const blocking = sections.blocking;
    const suggestions = sections.suggestions;
    const blockingValues = blocking.map((entry) =>
      entry.startsWith("- ") ? entry.slice(2) : entry,
    );
    const suggestionValues = suggestions.map((entry) =>
      entry.startsWith("- ") ? entry.slice(2) : entry,
    );
    if (blocking.length === 0 || suggestions.length === 0) return false;
    if (
      blockingValues.includes("None.")
        ? blocking.length !== 1
        : !blocking.every((entry) => blockingFinding(entry))
    )
      return false;
    if (
      suggestionValues.includes("None.")
        ? suggestions.length !== 1
        : !suggestions.every((entry) => entry.startsWith("- "))
    )
      return false;
    if (
      pass === passes.at(-1) &&
      verdict === "approved" &&
      (blocking.length !== 1 || blockingValues[0] !== "None.")
    )
      return false;
    if (
      pass === passes.at(-1) &&
      verdict === "changes-requested" &&
      blockingValues.includes("None.")
    )
      return false;
  }
  return true;
};

const validRange = async (
  runtime: PreconditionRuntime,
  root: string,
  base: unknown,
  head: unknown,
  required?: string,
): Promise<RangeStatus> => {
  if (!fullCommit(base) || !fullCommit(head)) return "malformed";
  const resolvedBase = await gitResolveCommit(runtime, root, base);
  const resolvedHead = await gitResolveCommit(runtime, root, head);
  if (
    !successful(resolvedBase) ||
    !successful(resolvedHead) ||
    text(resolvedBase) !== base ||
    text(resolvedHead) !== head
  )
    return "malformed";
  if (!successful(await gitIsAncestor(runtime, root, base, head)))
    return "malformed";
  const current = text(await gitCurrentHead(runtime, root));
  if (
    !fullCommit(current) ||
    !successful(await gitIsAncestor(runtime, root, head, current))
  )
    return "off-branch";
  if (
    required &&
    !successful(await gitIsAncestor(runtime, root, required, head))
  )
    return "stale";
  return "fresh";
};

interface ReviewEvidence {
  readonly artifact: ValidArtifactContract;
  readonly source: string;
  readonly verdict: string;
  readonly base: unknown;
  readonly head: unknown;
}

type RangeStatus = "malformed" | "off-branch" | "stale" | "fresh";

interface ReviewInspection {
  readonly output: string;
  readonly passed: boolean;
  readonly review?: ReviewEvidence;
  readonly reviewReason?: string;
  readonly reviewDurable: boolean;
  readonly reviewRange: RangeStatus;
}

const readReview = async (
  runtime: PreconditionRuntime,
  path: string,
  expectedTitle: string,
  expected: "feedback" | "review",
): Promise<ReviewEvidence | string> => {
  const read = await readContract(runtime, path, expected);
  if (!read.artifact || !read.source) return read.reason ?? "malformed";
  const title = titleOf(
    read.artifact,
    expected === "feedback" ? "Code Feedback: " : "Whole-branch Review: ",
  );
  const verdict = String(read.artifact.metadata.verdict ?? "");
  if (
    title !== expectedTitle ||
    !validPassContent(read.artifact, read.source, verdict)
  )
    return "malformed";
  return {
    artifact: read.artifact,
    source: read.source,
    verdict,
    base: read.artifact.metadata.base,
    head: read.artifact.metadata.head,
  };
};

const inspectReviews = async (
  runtime: PreconditionRuntime,
  root: string,
  changeDir: string,
  inspection: TaskInspection,
): Promise<ReviewInspection> => {
  const problems: string[] = [];
  for (const task of inspection.tasks) {
    const path = Path.join(
      changeDir,
      "tasks",
      `task-${task.task}`,
      "feedback.md",
    );
    const feedback = await readReview(
      runtime,
      path,
      `Task ${task.task} — ${task.title}`,
      "feedback",
    );
    if (typeof feedback === "string") {
      problems.push(`Task ${task.task} feedback ${feedback}`);
      continue;
    }
    if (feedback.verdict !== "approved")
      problems.push(`Task ${task.task} latest verdict: ${feedback.verdict}`);
    if (!(await exactArtifactCommit(runtime, root, path)))
      problems.push(
        `Task ${task.task} feedback is not tracked and committed exactly at HEAD`,
      );
    const standing = await validRange(
      runtime,
      root,
      feedback.base,
      feedback.head,
      task.implementation,
    );
    if (standing !== "fresh")
      problems.push(`Task ${task.task} feedback is ${standing}`);
  }
  const reviewPath = Path.join(changeDir, "review.md");
  const review = await readReview(
    runtime,
    reviewPath,
    inspection.planTitle ?? "",
    "review",
  );
  let reviewDurable = false;
  let reviewRange: RangeStatus = "malformed";
  let reviewReason: string | undefined;
  if (typeof review === "string") {
    reviewReason = review;
    problems.push(`whole-branch review ${review}`);
  } else {
    reviewDurable = await exactArtifactCommit(runtime, root, reviewPath);
    reviewRange = await validRange(runtime, root, review.base, review.head);
    if (review.verdict !== "approved")
      problems.push(`whole-branch latest verdict: ${review.verdict}`);
    if (!reviewDurable)
      problems.push(
        "whole-branch review is not tracked and committed exactly at HEAD",
      );
    if (reviewRange !== "fresh")
      problems.push(`whole-branch review range is ${reviewRange}`);
  }
  return {
    passed: problems.length === 0,
    output:
      problems.length === 0
        ? "[PASS] Reviews (all task feedback and whole-branch verdicts approved and current)\n"
        : `[FAIL] Reviews (${problems.join("; ")})\n`,
    ...(typeof review === "string" ? {} : { review }),
    ...(reviewReason ? { reviewReason } : {}),
    reviewDurable,
    reviewRange,
  };
};

const inspectFreshness = async (
  runtime: PreconditionRuntime,
  root: string,
  inspection: TaskInspection,
  reviews: ReviewInspection,
  waived: boolean,
): Promise<{ readonly output: string; readonly passed: boolean }> => {
  const problems: string[] = [];
  if (reviews.reviewReason) problems.push(`review ${reviews.reviewReason}`);
  else if (reviews.review) {
    if (!reviews.reviewDurable)
      problems.push("review is not tracked and committed exactly at HEAD");
    if (reviews.reviewRange !== "fresh")
      problems.push(`review range is ${reviews.reviewRange}`);
    if (reviews.review.verdict !== "approved")
      problems.push(`latest verdict: ${reviews.review.verdict}`);
  }
  if (!inspection.planDurable)
    problems.push("plan.md is not tracked and committed exactly at HEAD");
  const material = text(
    await gitLatestMaterialCommit(
      runtime,
      root,
      inspection.changePath,
      inspection.tasks.map((task) => task.progressPath),
    ),
  );
  if (!fullCommit(material))
    problems.push("no material commit exists on the current branch");
  if (
    problems.length === 0 &&
    !waived &&
    reviews.review &&
    fullCommit(material)
  ) {
    if (
      !fullCommit(reviews.review.head) ||
      !successful(
        await gitIsAncestor(runtime, root, material, reviews.review.head),
      )
    )
      problems.push(`review head does not contain material ${material}`);
  }
  if (problems.length > 0)
    return {
      passed: false,
      output: `[FAIL] Whole-branch review freshness (${problems.join("; ")})\n`,
    };
  if (waived)
    return {
      passed: true,
      output:
        "[WAIVED] Whole-branch review freshness (material ancestry waived by the user; record this in the finish entry)\n",
    };
  return {
    passed: true,
    output: `[PASS] Whole-branch review freshness (review contains material ${material})\n`,
  };
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

  const after = await cleanTree(
    runtime,
    target,
    "Clean tree after verification",
  );
  if ("exitCode" in after) return result("error", 2, output, after.stderr);
  output += after.output;
  if (!after.clean) failures += 1;

  const tasks = await inspectTasks(
    runtime,
    target,
    Path.resolve(args.changeDir),
  );
  output += tasks.output;
  if (!tasks.passed) failures += 1;
  const reviews = await inspectReviews(
    runtime,
    target,
    Path.resolve(args.changeDir),
    tasks,
  );
  output += reviews.output;
  if (!reviews.passed) failures += 1;
  const freshness = await inspectFreshness(
    runtime,
    target,
    tasks,
    reviews,
    args.wholeChangeWaived === true,
  );
  output += freshness.output;
  if (!freshness.passed) failures += 1;

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
