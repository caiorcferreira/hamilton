import * as Path from "node:path";
import { createArtifactReader } from "./artifact-reader.js";
import { validateArtifact, type ArtifactContractResult } from "./artifact-contracts.js";
import type { ValidArtifactContract } from "./artifact-types.js";
import type { ProcessResult } from "./runtime.js";
import {
  fullCommit,
  gitCommitFiles,
  gitHeadBlob,
  gitLatestCommit,
  gitStagedDiff,
  gitWorktreeBlob,
  relativePath,
  successful,
  text,
} from "./precondition-git.js";
import type { PreconditionRuntime } from "./precondition-runtime.js";

export interface EvidenceRead {
  readonly artifact?: ValidArtifactContract;
  readonly source?: string;
  readonly reason?: string;
}

export const readContract = async (
  runtime: PreconditionRuntime,
  path: string,
  expected: ValidArtifactContract["artifact"],
): Promise<EvidenceRead> => {
  if (!(await runtime.fileSystem.pathExists(path))) return { reason: "missing" };
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

export const durableArtifact = async (
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

export const exactArtifactCommit = async (
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

export interface TaskEvidence {
  readonly task: number;
  readonly title: string;
  readonly status: string;
  readonly progressPath: string;
  readonly feedbackPath: string;
  readonly implementation?: string;
}

export interface TaskInspection {
  readonly passed: boolean;
  readonly output: string;
  readonly tasks: readonly TaskEvidence[];
  readonly planTitle?: string;
  readonly planDurable: boolean;
  readonly changePath: string;
}

export const titleOf = (
  artifact: ValidArtifactContract,
  prefix: string,
): string | null => {
  const titles = artifact.body.headings.filter(
    (heading) => heading.level === 1,
  );
  if (titles.length !== 1 || !titles[0]?.text.startsWith(prefix)) return null;
  return titles[0].text.slice(prefix.length);
};

export const taskTitleAbandoned = (title: string): boolean =>
  /\(abandoned — .+\)$/.test(title);

export const inspectTasks = async (
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
    : null;
  if (!planRead.artifact) problems.push(`plan.md ${planRead.reason ?? "malformed"}`);
  if (!progressRead.artifact)
    problems.push(`progress.md ${progressRead.reason ?? "malformed"}`);
  if (planTitle === null) problems.push("plan title is malformed");
  if (problems.length > 0)
    return {
      passed: false,
      output: `[FAIL] Tasks (${problems.join("; ")})\n`,
      tasks: [],
      ...(planTitle === null ? {} : { planTitle }),
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
      ...(planTitle === null ? {} : { planTitle }),
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
      const entry =
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      if (
        entry === null ||
        entry.id !== record?.number ||
        entry.title !== record?.title ||
        entry.status !== record?.fields.Status ||
        entry.progress !== `tasks/task-${String(entry.id)}/progress.md` ||
        `[details](${entry.progress})` !== record?.fields.Progress
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
      problems.push(`Task ${task} progress ${taskRead.reason ?? "malformed"}`);
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
    ...(planTitle === null ? {} : { planTitle }),
    planDurable,
    changePath,
  };
};
