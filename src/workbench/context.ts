import * as Fs from "node:fs/promises";
import * as Path from "node:path";
import { spawnSync } from "node:child_process";
import {
  createArtifactReader,
  type ArtifactFileSystem,
  type ArtifactReadResult,
  type RecognizedArtifact,
} from "./artifact-reader.js";
import {
  validateArtifact,
  type ArtifactContractResult,
} from "./artifact-contracts.js";
import type { ProcessPort, ProcessResult } from "./runtime.js";

export interface ContextArguments {
  readonly changeDir?: string;
  readonly all?: boolean;
}

export type ContextFormat =
  | "split"
  | "pre-plan"
  | "legacy-unsupported"
  | "invalid";
export type ContextStanding =
  | "fresh"
  | "stale"
  | "malformed"
  | "absent"
  | "uncommitted"
  | "not reviewed";

export interface ContextFileSystemPort extends ArtifactFileSystem {
  readonly pathExists: (sourcePath: string) => boolean | Promise<boolean>;
  readonly directoryExists: (sourcePath: string) => boolean | Promise<boolean>;
  readonly realpath: (sourcePath: string) => string | Promise<string>;
  readonly readDirectory: (
    sourcePath: string,
  ) => readonly string[] | Promise<readonly string[]>;
  readonly modificationTime: (sourcePath: string) => number | Promise<number>;
}

export interface ContextGitPort {
  readonly repositoryRoot: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly currentHead: (cwd: string) => ProcessResult | Promise<ProcessResult>;
  readonly resolveCommit: (
    cwd: string,
    reference: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly isAncestor: (
    cwd: string,
    base: string,
    head: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly headBlob: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly worktreeBlob: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly stagedDiff: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly latestCommit: (
    cwd: string,
    sourcePath: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly commitFiles: (
    cwd: string,
    commit: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly latestMaterialCommit: (
    cwd: string,
    changePath: string,
    taskPaths: readonly string[],
  ) => ProcessResult | Promise<ProcessResult>;
}

export interface ContextRuntime {
  readonly cwd: () => string;
  readonly fileSystem: ContextFileSystemPort;
  readonly git: ContextGitPort;
}

export interface ContextRuntimeOverrides {
  readonly cwd?: () => string;
  readonly process?: ProcessPort;
  readonly fileSystem?: ContextFileSystemPort;
  readonly git?: ContextGitPort;
}

export interface ContextChange {
  readonly name: string;
  readonly path: string;
  readonly format: ContextFormat;
  readonly artifacts: readonly string[];
  readonly artifactDetails?: Readonly<
    Record<string, { readonly lines: number; readonly header: string }>
  >;
  readonly requirements: readonly string[];
  readonly routeUnit?: string;
  readonly tasks?: { readonly done: number; readonly total: number };
  readonly taskStates?: readonly {
    readonly task: string;
    readonly status: string;
    readonly feedback: string;
  }[];
  readonly wholeReview?: ContextStanding | string;
  readonly lastModified: number;
}

export type ContextResultStatus = "success" | "negative" | "error";

export interface ContextResult {
  readonly _tag: "ContextResult";
  readonly operation: "one" | "all";
  readonly status: ContextResultStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly string[];
  readonly lastLine: string;
  readonly changes: readonly ContextChange[];
}

const ARTIFACTS = [
  "proposal.md",
  "design.md",
  "plan.md",
  "progress.md",
  "review.md",
  "finish.md",
  "critique.md",
] as const;
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

const productionFileSystem: ContextFileSystemPort = {
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
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  },
  realpath: (sourcePath) => Fs.realpath(sourcePath),
  readDirectory: async (sourcePath) => Fs.readdir(sourcePath),
  modificationTime: async (sourcePath) => (await Fs.stat(sourcePath)).mtimeMs,
};

const createGitPort = (processPort: ProcessPort): ContextGitPort => ({
  repositoryRoot: (cwd) =>
    processPort.run("git", ["rev-parse", "--show-toplevel"], cwd),
  currentHead: (cwd) => processPort.run("git", ["rev-parse", "HEAD"], cwd),
  resolveCommit: (cwd, reference) =>
    processPort.run(
      "git",
      ["rev-parse", "--verify", `${reference}^{commit}`],
      cwd,
    ),
  isAncestor: (cwd, base, head) =>
    processPort.run("git", ["merge-base", "--is-ancestor", base, head], cwd),
  headBlob: (cwd, sourcePath) =>
    processPort.run("git", ["rev-parse", `HEAD:${sourcePath}`], cwd),
  worktreeBlob: (cwd, sourcePath) =>
    processPort.run("git", ["hash-object", "--", sourcePath], cwd),
  stagedDiff: (cwd, sourcePath) =>
    processPort.run(
      "git",
      ["diff", "--cached", "--quiet", "HEAD", "--", sourcePath],
      cwd,
    ),
  latestCommit: (cwd, sourcePath) =>
    processPort.run(
      "git",
      ["log", "-1", "--format=%H", "HEAD", "--", sourcePath],
      cwd,
    ),
  commitFiles: (cwd, commit) =>
    processPort.run(
      "git",
      ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", commit],
      cwd,
    ),
  latestMaterialCommit: (cwd, changePath, taskPaths) =>
    processPort.run(
      "git",
      [
        "log",
        "-1",
        "--format=%H",
        "HEAD",
        "--",
        ".",
        `:(exclude)${changePath}/progress.md`,
        `:(exclude)${changePath}/review.md`,
        `:(exclude)${changePath}/finish.md`,
        ...taskPaths.flatMap((path) => [
          `:(exclude)${path}`,
          `:(exclude)${path.replace(/progress\.md$/, "feedback.md")}`,
        ]),
      ],
      cwd,
    ),
});

export const createContextRuntime = (
  overrides: ContextRuntimeOverrides = {},
): ContextRuntime => {
  const processPort = overrides.process ?? productionProcess;
  return {
    cwd: overrides.cwd ?? (() => process.cwd()),
    fileSystem: overrides.fileSystem ?? productionFileSystem,
    git: overrides.git ?? createGitPort(processPort),
  };
};

const linesOf = (stdout: string): readonly string[] =>
  stdout.split("\n").filter((line) => line !== "");
const text = (result: ProcessResult): string => result.stdout.trim();
const successful = (result: ProcessResult): boolean => result.status === 0;
const result = (
  operation: "one" | "all",
  status: ContextResultStatus,
  exitCode: 0 | 1 | 2,
  stdout = "",
  stderr = "",
  changes: readonly ContextChange[] = [],
): ContextResult => {
  const lines = linesOf(stdout);
  return {
    _tag: "ContextResult",
    operation,
    status,
    exitCode,
    stdout,
    stderr,
    lines,
    lastLine: lines.at(-1) ?? "",
    changes,
  };
};
const failure = (operation: "one" | "all", message: string): ContextResult =>
  result(operation, "error", 2, "", `error: ${message}\n`);

const stripComments = (source: string): string =>
  source
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\r\n]/g, " "))
    .replace(/<!--?[\s\S]*$/g, (comment) => comment.replace(/[^\r\n]/g, " "));
const bodyOf = (source: string, artifact?: ArtifactReadResult): string =>
  artifact?._tag === "recognized" ? artifact.body : stripComments(source);
const firstHeader = (source: string): string => {
  const match = stripComments(source).match(
    /^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/m,
  );
  return match?.[1]?.trim() ?? "";
};
const lineCount = (source: string): number =>
  source === ""
    ? 0
    : source.split(/\r\n|\n|\r/).length - (/[\r\n]$/.test(source) ? 1 : 0);
const fullCommit = (value: string): boolean => /^[0-9a-f]{40}$/.test(value);

const read = async (
  runtime: ContextRuntime,
  path: string,
): Promise<string | ContextResult> => {
  try {
    return await runtime.fileSystem.readFile(path);
  } catch (error) {
    return failure("one", `cannot read ${path}: ${String(error)}`);
  }
};

const readArtifact = async (
  runtime: ContextRuntime,
  path: string,
): Promise<
  | { readonly source: string; readonly artifact: ArtifactReadResult }
  | ContextResult
> => {
  const source = await read(runtime, path);
  if (typeof source !== "string") return source;
  const reader = createArtifactReader({ readFile: () => source });
  return { source, artifact: await reader(path) };
};

const planTasks = (
  source: string,
):
  | {
      readonly task: string;
      readonly title: string;
      readonly abandoned: boolean;
    }[]
  | undefined => {
  const body = stripComments(source);
  const headings = [...body.matchAll(/^### Task ([1-9][0-9]*):[ \t]+(.+)$/gm)];
  const allHeadings = [...body.matchAll(/^### Task ([1-9][0-9]*):/gm)];
  if (allHeadings.length !== headings.length) return undefined;
  const seen = new Set<string>();
  const tasks: { task: string; title: string; abandoned: boolean }[] = [];
  for (const match of headings) {
    const task = match[1] ?? "";
    if (seen.has(task)) return undefined;
    seen.add(task);
    const title = match[2] ?? "";
    tasks.push({ task, title, abandoned: /\(abandoned — .+\)$/.test(title) });
  }
  return tasks;
};

const splitRow = (line: string): readonly string[] | undefined => {
  if (!/^\s*\|/.test(line)) return undefined;
  const value = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      cell += `\\${character}`;
      escaped = false;
    } else if (character === "\\") escaped = true;
    else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else cell += character;
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells.map((entry) => entry.replaceAll("\\|", "|"));
};

interface LedgerRow {
  readonly task: string;
  readonly title: string;
  readonly status: string;
  readonly link: string;
}
const progressRows = (source: string): readonly LedgerRow[] | undefined => {
  const lines = stripComments(source).split(/\r\n|\n|\r/);
  const header = lines.findIndex(
    (line) => line.trim() === "| Task | Status | Progress |",
  );
  if (header < 0 || lines[header + 1] === undefined) return undefined;
  const separator = splitRow(lines[header + 1] ?? "");
  if (
    !separator ||
    separator.length !== 3 ||
    !separator.every((cell) => /^:?-{3,}:?$/.test(cell))
  )
    return undefined;
  const rows: LedgerRow[] = [];
  for (let index = header + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") {
      if (lines.slice(index).every((entry) => entry.trim() === "")) break;
      return undefined;
    }
    if (!line.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    if (!cells || cells.length !== 3) return undefined;
    const task = /^Task ([1-9][0-9]*):[ \t]+(.+)$/.exec(cells[0] ?? "");
    const link =
      /^\[details\]\(tasks\/task-([1-9][0-9]*)\/progress\.md\)$/.exec(
        cells[2] ?? "",
      );
    if (
      !task ||
      !link ||
      link[1] !== task[1] ||
      !["pending", "in-progress", "blocked", "done"].includes(cells[1] ?? "")
    )
      return undefined;
    rows.push({
      task: task[1] ?? "",
      title: task[2] ?? "",
      status: cells[1] ?? "",
      link: cells[2] ?? "",
    });
  }
  return rows;
};

const taskAttempts = (
  source: string,
  title: string,
  task: string,
): { readonly valid: boolean; readonly outcome?: string } => {
  const visible = stripComments(source);
  const headings = [...visible.matchAll(/^##(?:[ \t]+)(.+)$/gm)];
  let expected = 1;
  let latest: string | undefined;
  if (
    !new RegExp(
      `^# Task Progress: Task ${task.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "m",
    ).test(visible)
  )
    return { valid: false };
  for (const heading of headings) {
    const value = heading[1] ?? "";
    const pass = /^Attempt ([1-9][0-9]*) — ([0-9]{4}-[0-9]{2}-[0-9]{2})$/.exec(
      value,
    );
    if (!pass || Number(pass[1]) !== expected) return { valid: false };
    expected += 1;
    const start = (heading.index ?? 0) + heading[0].length;
    const next = headings.find(
      (candidate) => (candidate.index ?? 0) > (heading.index ?? 0),
    );
    const section = visible.slice(start, next?.index ?? visible.length);
    const outcomes = [...section.matchAll(/^- Outcome:[ \t]*(.+)$/gm)].map(
      (match) => match[1],
    );
    if (
      outcomes.length !== 1 ||
      !["done", "blocked"].includes(outcomes[0] ?? "")
    )
      return { valid: false };
    latest = outcomes[0];
  }
  return headings.length === 0
    ? { valid: false }
    : { valid: true, outcome: latest };
};

const legacyPasses = (
  source: string,
): {
  readonly valid: boolean;
  readonly base?: string;
  readonly head?: string;
  readonly verdict?: string;
} => {
  const visible = stripComments(source);
  const headings = [...visible.matchAll(/^##[ \t]+(.+)$/gm)];
  let expected = 1;
  let latest:
    | { readonly base: string; readonly head: string; readonly verdict: string }
    | undefined;
  for (const heading of headings) {
    const pass = /^Pass ([1-9][0-9]*) — ([0-9]{4}-[0-9]{2}-[0-9]{2})$/.exec(
      heading[1] ?? "",
    );
    if (!pass || Number(pass[1]) !== expected) return { valid: false };
    expected += 1;
    const start = (heading.index ?? 0) + heading[0].length;
    const next = headings.find(
      (candidate) => (candidate.index ?? 0) > (heading.index ?? 0),
    );
    const section = visible.slice(start, next?.index ?? visible.length);
    const base = section.match(/^[ \t]*Base: ([^\n]+)$/m)?.[1]?.trim();
    const head = section.match(/^[ \t]*Head: ([^\n]+)$/m)?.[1]?.trim();
    const verdict = section.match(
      /^[ \t]*Verdict: (approved|changes-requested|skipped)$/m,
    )?.[1];
    if (
      !base ||
      !head ||
      !verdict ||
      !/^### Blocking[ \t]*$/m.test(section) ||
      !/^### Suggestions[ \t]*$/m.test(section)
    )
      return { valid: false };
    const blockingStart = section.search(/^### Blocking[ \t]*$/m);
    const suggestionsStart = section.search(/^### Suggestions[ \t]*$/m);
    if (blockingStart < 0 || suggestionsStart < blockingStart)
      return { valid: false };
    const metadataLines = section
      .slice(0, blockingStart)
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (
      metadataLines.length !== 3 ||
      metadataLines[0] !== `Base: ${base}` ||
      metadataLines[1] !== `Head: ${head}` ||
      metadataLines[2] !== `Verdict: ${verdict}`
    )
      return { valid: false };
    const blocking = section.slice(
      blockingStart + section.slice(blockingStart).indexOf("\n") + 1,
      suggestionsStart,
    );
    for (const line of blocking
      .split(/\r\n|\n|\r/)
      .map((entry) => entry.trim())
      .filter(Boolean)) {
      if (line === "- None.") continue;
      if (
        !/^- \[[^\]]+\] .+/.test(line) ||
        /<(?:file|loc|what is wrong|what to change|optional improvement|criterion \/ standard)>/.test(
          line,
        )
      )
        return { valid: false };
    }
    latest = { base, head, verdict };
  }
  return latest ? { valid: true, ...latest } : { valid: false };
};

const metadataContract = (
  artifact: ArtifactReadResult,
): ArtifactContractResult | undefined =>
  artifact._tag === "recognized" ? validateArtifact(artifact) : undefined;
const currentValid = (
  artifact: ArtifactReadResult,
): artifact is RecognizedArtifact =>
  artifact._tag === "recognized" &&
  metadataContract(artifact)?._tag === "valid";
const currentInvalid = (artifact: ArtifactReadResult): boolean =>
  artifact._tag === "invalid" ||
  (artifact._tag === "recognized" &&
    metadataContract(artifact)?._tag === "invalid");

const routeUnit = async (
  runtime: ContextRuntime,
  dir: string,
  sources: ReadonlyMap<string, string>,
): Promise<string | undefined> => {
  for (const name of ["proposal.md", "plan.md"]) {
    const source = sources.get(name);
    if (!source) continue;
    const artifact = await createArtifactReader({ readFile: () => source })(
      Path.join(dir, name),
    );
    if (
      artifact._tag === "recognized" &&
      typeof artifact.metadata.route_unit === "string" &&
      artifact.metadata.route_unit !== ""
    )
      return artifact.metadata.route_unit;
    if (artifact._tag !== "unrelated") continue;
    const match =
      stripComments(source).match(/^\| *Route unit *\| *(.+?) *\|$/m) ??
      stripComments(source).match(/^- *Route unit: *(.+)$/m);
    const value = match?.[1]?.trim();
    if (value && !value.startsWith("<") && value !== "null") return value;
  }
  return undefined;
};

const formatChange = async (
  runtime: ContextRuntime,
  dir: string,
): Promise<{
  readonly change: ContextChange;
  readonly sources: ReadonlyMap<string, string>;
  readonly error?: ContextResult;
}> => {
  const name = Path.basename(dir);
  const sources = new Map<string, string>();
  let newest = 0;
  for (const artifact of ARTIFACTS) {
    const path = Path.join(dir, artifact);
    if (!(await runtime.fileSystem.pathExists(path))) continue;
    let source: string;
    try {
      source = await runtime.fileSystem.readFile(path);
    } catch (error) {
      return {
        change: {
          name,
          path: dir,
          format: "invalid",
          artifacts: [],
          requirements: [],
          lastModified: 0,
        },
        sources,
        error: failure("one", `cannot read ${path}: ${String(error)}`),
      };
    }
    sources.set(artifact, source);
    newest = Math.max(newest, await runtime.fileSystem.modificationTime(path));
  }
  const requirementsDir = Path.join(dir, "requirements");
  let requirements: string[] = [];
  try {
    if (await runtime.fileSystem.directoryExists(requirementsDir)) {
      requirements = [
        ...(await runtime.fileSystem.readDirectory(requirementsDir)),
      ]
        .filter((entry) => entry.endsWith(".md"))
        .map((entry) => entry.slice(0, -3))
        .sort();
      newest = Math.max(
        newest,
        await runtime.fileSystem.modificationTime(requirementsDir),
      );
    }
  } catch (error) {
    return {
      change: {
        name,
        path: dir,
        format: "invalid",
        artifacts: [],
        requirements: [],
        lastModified: 0,
      },
      sources,
      error: failure("one", `cannot read ${requirementsDir}: ${String(error)}`),
    };
  }
  if (newest === 0) newest = await runtime.fileSystem.modificationTime(dir);
  const artifacts = ARTIFACTS.filter((artifact) => sources.has(artifact));
  const artifactDetails = Object.fromEntries(
    [...sources.entries()].map(([artifact, source]) => [
      artifact,
      { lines: lineCount(source), header: firstHeader(source) },
    ]),
  );
  const plan = sources.get("plan.md");
  const route = await routeUnit(runtime, dir, sources);
  if (!plan)
    return {
      change: {
        name,
        path: dir,
        format: "pre-plan",
        artifacts,
        artifactDetails,
        requirements,
        ...(route ? { routeUnit: route } : {}),
        lastModified: newest,
      },
      sources,
    };
  const planRead = await readArtifact(runtime, Path.join(dir, "plan.md"));
  if ("exitCode" in planRead)
    return {
      change: {
        name,
        path: dir,
        format: "invalid",
        artifacts,
        requirements,
        lastModified: newest,
      },
      sources,
      error: planRead,
    };
  if (currentInvalid(planRead.artifact))
    return {
      change: {
        name,
        path: dir,
        format: "invalid",
        artifacts,
        requirements,
        lastModified: newest,
      },
      sources,
    };
  const tasks = planTasks(bodyOf(planRead.source, planRead.artifact));
  if (!tasks)
    return {
      change: {
        name,
        path: dir,
        format: "invalid",
        artifacts,
        requirements,
        lastModified: newest,
      },
      sources,
    };
  const progress = sources.get("progress.md");
  if (!progress)
    return {
      change: {
        name,
        path: dir,
        format: "legacy-unsupported",
        artifacts,
        requirements,
        lastModified: newest,
      },
      sources,
    };
  const progressRead = await readArtifact(
    runtime,
    Path.join(dir, "progress.md"),
  );
  if ("exitCode" in progressRead)
    return {
      change: {
        name,
        path: dir,
        format: "invalid",
        artifacts,
        requirements,
        lastModified: newest,
      },
      sources,
      error: progressRead,
    };
  const current = currentValid(progressRead.artifact);
  if (currentInvalid(progressRead.artifact))
    return {
      change: {
        name,
        path: dir,
        format: "invalid",
        artifacts,
        requirements,
        lastModified: newest,
      },
      sources,
    };
  const rows = progressRows(bodyOf(progressRead.source, progressRead.artifact));
  if (
    !rows ||
    rows.length !== tasks.filter((task) => !task.abandoned).length ||
    rows.some(
      (row, index) =>
        row.task !== tasks.filter((task) => !task.abandoned)[index]?.task ||
        row.title !== tasks.filter((task) => !task.abandoned)[index]?.title,
    )
  )
    return {
      change: {
        name,
        path: dir,
        format: "legacy-unsupported",
        artifacts,
        requirements,
        lastModified: newest,
      },
      sources,
    };
  for (const task of tasks.filter((entry) => !entry.abandoned)) {
    const taskPath = Path.join(
      dir,
      "tasks",
      `task-${task.task}`,
      "progress.md",
    );
    if (!(await runtime.fileSystem.pathExists(taskPath)))
      return {
        change: {
          name,
          path: dir,
          format: "legacy-unsupported",
          artifacts,
          requirements,
          lastModified: newest,
        },
        sources,
      };
    const taskSource = await read(runtime, taskPath);
    if (typeof taskSource !== "string")
      return {
        change: {
          name,
          path: dir,
          format: "invalid",
          artifacts,
          requirements,
          lastModified: newest,
        },
        sources,
        error: taskSource,
      };
    const taskRead = await readArtifact(runtime, taskPath);
    if ("exitCode" in taskRead)
      return {
        change: {
          name,
          path: dir,
          format: "invalid",
          artifacts,
          requirements,
          lastModified: newest,
        },
        sources,
        error: taskRead,
      };
    if (current) {
      if (
        !currentValid(taskRead.artifact) ||
        taskRead.artifact.metadata.task !== Number(task.task) ||
        taskRead.artifact.metadata.change !== name
      )
        return {
          change: {
            name,
            path: dir,
            format: "invalid",
            artifacts,
            requirements,
            lastModified: newest,
          },
          sources,
        };
    } else if (!taskAttempts(taskSource, task.title, task.task).valid)
      return {
        change: {
          name,
          path: dir,
          format: "invalid",
          artifacts,
          requirements,
          lastModified: newest,
        },
        sources,
      };
  }
  const review = sources.get("review.md");
  if (review) {
    const reviewRead = await readArtifact(runtime, Path.join(dir, "review.md"));
    if ("exitCode" in reviewRead)
      return {
        change: {
          name,
          path: dir,
          format: "invalid",
          artifacts,
          requirements,
          lastModified: newest,
        },
        sources,
        error: reviewRead,
      };
    if (currentValid(reviewRead.artifact)) {
      if (reviewRead.artifact.body.match(/^##[ \t]+Task\b/m))
        return {
          change: {
            name,
            path: dir,
            format: "legacy-unsupported",
            artifacts,
            requirements,
            lastModified: newest,
          },
          sources,
        };
    } else if (
      reviewRead.artifact._tag === "unrelated" &&
      /^ {0,3}##[ \t]+Task\b/m.test(stripComments(review))
    )
      return {
        change: {
          name,
          path: dir,
          format: "legacy-unsupported",
          artifacts,
          requirements,
          lastModified: newest,
        },
        sources,
      };
    else if (currentInvalid(reviewRead.artifact))
      return {
        change: {
          name,
          path: dir,
          format: "invalid",
          artifacts,
          requirements,
          lastModified: newest,
        },
        sources,
      };
  }
  const done = rows.filter((row) => row.status === "done").length;
  return {
    change: {
      name,
      path: dir,
      format: "split",
      artifacts,
      artifactDetails,
      requirements,
      tasks: { done, total: rows.length },
      ...(route ? { routeUnit: route } : {}),
      lastModified: newest,
    },
    sources,
  };
};

const relative = (root: string, path: string): string =>
  Path.relative(root, path).split(Path.sep).join("/");
const validRange = async (
  runtime: ContextRuntime,
  root: string,
  base: unknown,
  head: unknown,
  required: string | undefined,
): Promise<ContextStanding> => {
  if (
    typeof base !== "string" ||
    typeof head !== "string" ||
    !fullCommit(base) ||
    !fullCommit(head)
  )
    return "malformed";
  const resolvedBase = await runtime.git.resolveCommit(root, base);
  const resolvedHead = await runtime.git.resolveCommit(root, head);
  if (
    !successful(resolvedBase) ||
    !successful(resolvedHead) ||
    text(resolvedBase) !== base ||
    text(resolvedHead) !== head
  )
    return "malformed";
  if (!successful(await runtime.git.isAncestor(root, base, head)))
    return "malformed";
  const current = text(await runtime.git.currentHead(root));
  if (
    !fullCommit(current) ||
    !successful(await runtime.git.isAncestor(root, head, current))
  )
    return "stale";
  if (
    !required ||
    !successful(await runtime.git.isAncestor(root, required, head))
  )
    return "stale";
  return "fresh";
};

const durableArtifact = async (
  runtime: ContextRuntime,
  root: string,
  path: string,
): Promise<boolean> => {
  const relativePath = relative(root, path);
  const head = await runtime.git.headBlob(root, relativePath);
  const worktree = await runtime.git.worktreeBlob(root, relativePath);
  if (
    !successful(head) ||
    !successful(worktree) ||
    text(head) !== text(worktree)
  )
    return false;
  return (await runtime.git.stagedDiff(root, relativePath)).status === 0;
};

const latestFeedback = async (
  runtime: ContextRuntime,
  root: string,
  dir: string,
  task: string,
  title: string,
  implementation: string | undefined,
): Promise<ContextStanding | string> => {
  const path = Path.join(dir, "tasks", `task-${task}`, "feedback.md");
  if (!(await runtime.fileSystem.pathExists(path))) return "absent";
  const readResult = await readArtifact(runtime, path);
  if ("exitCode" in readResult) return "malformed";
  let verdict: unknown;
  let base: unknown;
  let head: unknown;
  if (currentValid(readResult.artifact)) {
    if (
      readResult.artifact.metadata.task !== Number(task) ||
      readResult.artifact.metadata.change !== Path.basename(dir)
    )
      return "malformed";
    verdict = readResult.artifact.metadata.verdict;
    base = readResult.artifact.metadata.base;
    head = readResult.artifact.metadata.head;
    if (readResult.artifact.body.match(/^##[ \t]+Pass /m) === null)
      return "malformed";
  } else if (readResult.artifact._tag === "unrelated") {
    const visible = stripComments(readResult.source);
    const owner = visible.match(
      /^# Code Feedback: Task ([1-9][0-9]*) — (.+)$/m,
    );
    const parsed = legacyPasses(readResult.source);
    if (!owner || owner[1] !== task || owner[2] !== title || !parsed.valid)
      return "malformed";
    verdict = parsed.verdict;
    base = parsed.base;
    head = parsed.head;
  } else return "malformed";
  if (!(await durableArtifact(runtime, root, path)))
    return `${String(verdict)} (uncommitted)`;
  const commit = text(
    await runtime.git.latestCommit(root, relative(root, path)),
  );
  if (
    !fullCommit(commit) ||
    (await runtime.git.commitFiles(root, commit)).stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .join("\n") !== relative(root, path)
  )
    return `${String(verdict)} (uncommitted)`;
  const standing = await validRange(runtime, root, base, head, implementation);
  return `${String(verdict)} (${standing})`;
};

const latestReview = async (
  runtime: ContextRuntime,
  root: string,
  dir: string,
  taskPaths: readonly string[],
  expectedTitle: string,
  material?: string,
): Promise<ContextStanding | string> => {
  const path = Path.join(dir, "review.md");
  if (!(await runtime.fileSystem.pathExists(path))) return "not reviewed";
  const readResult = await readArtifact(runtime, path);
  if ("exitCode" in readResult) return "malformed";
  let verdict: unknown;
  let base: unknown;
  let head: unknown;
  if (currentValid(readResult.artifact)) {
    if (
      readResult.artifact.metadata.change !== Path.basename(dir) ||
      !readResult.artifact.body.match(
        new RegExp(
          `^# Whole-branch Review: ${expectedTitle.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}$`,
          "m",
        ),
      )
    )
      return "malformed";
    verdict = readResult.artifact.metadata.verdict;
    base = readResult.artifact.metadata.base;
    head = readResult.artifact.metadata.head;
  } else if (readResult.artifact._tag === "unrelated") {
    const visible = stripComments(readResult.source);
    const owner = visible.match(/^# Whole-branch Review: (.+)$/m);
    const parsed = legacyPasses(readResult.source);
    if (
      !owner ||
      owner[1] !== expectedTitle ||
      !parsed.valid ||
      /^##[ \t]+Task\b/m.test(visible)
    )
      return "malformed";
    verdict = parsed.verdict;
    base = parsed.base;
    head = parsed.head;
  } else return "malformed";
  const required =
    material ??
    text(
      await runtime.git.latestMaterialCommit(
        root,
        relative(root, dir),
        taskPaths,
      ),
    );
  const standing = await validRange(runtime, root, base, head, required);
  return `${String(verdict)} (${standing})`;
};

const enrichSplit = async (
  runtime: ContextRuntime,
  change: ContextChange,
): Promise<ContextChange> => {
  if (change.format !== "split" || !change.tasks) return change;
  const rootResult = await runtime.git.repositoryRoot(change.path);
  if (!successful(rootResult)) return change;
  const root = text(rootResult);
  const progress = await readArtifact(
    runtime,
    Path.join(change.path, "progress.md"),
  );
  if ("exitCode" in progress) return change;
  const rows = progressRows(bodyOf(progress.source, progress.artifact)) ?? [];
  const taskPaths = rows.map((row) =>
    Path.join(
      relative(root, change.path),
      "tasks",
      `task-${row.task}`,
      "progress.md",
    ),
  );
  const states = [];
  for (const row of rows)
    states.push({
      task: row.task,
      status: row.status,
      feedback: await latestFeedback(
        runtime,
        root,
        change.path,
        row.task,
        row.title,
        text(
          await runtime.git.latestCommit(
            root,
            Path.join(
              relative(root, change.path),
              "tasks",
              `task-${row.task}`,
              "progress.md",
            ),
          ),
        ),
      ),
    });
  const plan = await readArtifact(runtime, Path.join(change.path, "plan.md"));
  const expectedTitle =
    "exitCode" in plan
      ? ""
      : firstHeader(bodyOf(plan.source, plan.artifact)).replace(/^Plan: /, "");
  const wholeReview = await latestReview(
    runtime,
    root,
    change.path,
    taskPaths,
    expectedTitle,
  );
  return { ...change, taskStates: states, wholeReview };
};

const renderOne = (change: ContextChange): string => {
  const lines = [
    `change: ${change.name}`,
    `path: ${change.path}`,
    `format: ${change.format}`,
  ];
  if (change.routeUnit) lines.push(`route-unit: ${change.routeUnit}`);
  lines.push("", "artifacts:");
  for (const artifact of ARTIFACTS) {
    if (change.artifacts.includes(artifact)) {
      const detail = change.artifactDetails?.[artifact];
      lines.push(
        `  ${artifact.padEnd(14)} present${detail ? `  ${String(detail.lines).padStart(5)} lines  ${detail.header}` : ""}`,
      );
    } else lines.push(`  ${artifact.padEnd(14)} absent`);
  }
  lines.push(
    `  ${"requirements/".padEnd(14)} ${change.requirements.length > 0 ? `present  ${change.requirements.join(" ")}` : "absent"}`,
  );
  if (change.format === "pre-plan")
    lines.push(
      "",
      "tasks: none declared",
      `summary: ${change.name} — pre-plan`,
    );
  else if (
    change.format === "legacy-unsupported" ||
    change.format === "invalid"
  )
    lines.push("", `summary: ${change.name} — ${change.format}`);
  else {
    const tasks = change.tasks ?? { done: 0, total: 0 };
    lines.push("", `tasks: ${tasks.done}/${tasks.total} done`, "task state:");
    for (const task of change.taskStates ?? [])
      lines.push(
        `  Task ${task.task}: ${task.status}, feedback: ${task.feedback}`,
      );
    const whole = change.wholeReview ?? "not reviewed";
    lines.push(
      "reviews:",
      `  whole change: ${whole}`,
      `summary: ${change.name} — ${tasks.done}/${tasks.total} tasks done, whole change: ${whole}`,
    );
  }
  return lines.join("\n");
};

const normalizeChange = async (
  runtime: ContextRuntime,
  dir: string,
): Promise<ContextChange | ContextResult> => {
  try {
    const formatted = await formatChange(runtime, dir);
    if (formatted.error) return formatted.error;
    return await enrichSplit(runtime, formatted.change);
  } catch (error) {
    return failure("one", `cannot inspect change ${dir}: ${String(error)}`);
  }
};

const discover = async (
  runtime: ContextRuntime,
  supplied: string | undefined,
): Promise<string | ContextResult> => {
  const candidate = supplied;
  if (candidate !== undefined) {
    let exists: boolean;
    try {
      exists = await runtime.fileSystem.directoryExists(candidate);
    } catch (error) {
      return failure(
        "one",
        `cannot inspect change dir ${candidate}: ${String(error)}`,
      );
    }
    if (!exists)
      return failure("one", `change dir does not exist: ${candidate}`);
    try {
      return await runtime.fileSystem.realpath(candidate);
    } catch (error) {
      return failure(
        "one",
        `cannot resolve change dir ${candidate}: ${String(error)}`,
      );
    }
  }
  let current: string;
  try {
    current = await runtime.fileSystem.realpath(runtime.cwd());
  } catch (error) {
    return failure("one", `cannot resolve current directory: ${String(error)}`);
  }
  const parts = current.split(Path.sep);
  const marker = parts.lastIndexOf(".hamilton");
  if (marker < 0 || parts[marker + 1] !== "changes" || !parts[marker + 2])
    return failure(
      "one",
      "not inside a change directory — pass one as an argument, or use --all",
    );
  const dir = parts.slice(0, marker + 3).join(Path.sep) || Path.sep;
  try {
    return (await runtime.fileSystem.directoryExists(dir))
      ? dir
      : failure("one", `change dir does not exist: ${dir}`);
  } catch (error) {
    return failure("one", `cannot inspect change dir ${dir}: ${String(error)}`);
  }
};

const contextOne = async (
  runtime: ContextRuntime,
  supplied: string | undefined,
): Promise<ContextResult> => {
  const dir = await discover(runtime, supplied);
  if (typeof dir !== "string") return dir;
  const change = await normalizeChange(runtime, dir);
  if ("exitCode" in change) return change;
  return result("one", "success", 0, `${renderOne(change)}\n`, "", [change]);
};

const contextAll = async (runtime: ContextRuntime): Promise<ContextResult> => {
  const rootResult = await runtime.git.repositoryRoot(runtime.cwd());
  if (!successful(rootResult))
    return failure("all", "not inside a git repository");
  const changesDir = Path.join(text(rootResult), ".hamilton", "changes");
  let changesDirectoryExists: boolean;
  try {
    changesDirectoryExists =
      await runtime.fileSystem.directoryExists(changesDir);
  } catch (error) {
    return failure(
      "all",
      `cannot discover changes under ${changesDir}: ${String(error)}`,
    );
  }
  if (!changesDirectoryExists)
    return result(
      "all",
      "negative",
      1,
      "",
      `no .hamilton/changes/ under ${text(rootResult)}\n`,
    );
  const changeNames: string[] = [];
  try {
    for (const name of await runtime.fileSystem.readDirectory(changesDir))
      if (await runtime.fileSystem.directoryExists(Path.join(changesDir, name)))
        changeNames.push(name);
  } catch (error) {
    return failure(
      "all",
      `cannot discover changes under ${changesDir}: ${String(error)}`,
    );
  }
  if (changeNames.length === 0)
    return result("all", "negative", 1, "", `no changes under ${changesDir}\n`);
  const changes: ContextChange[] = [];
  for (const name of changeNames.sort()) {
    const change = await normalizeChange(runtime, Path.join(changesDir, name));
    if ("exitCode" in change)
      return result("all", "error", 2, "", change.stderr);
    changes.push(change);
  }
  changes.sort(
    (left, right) =>
      right.lastModified - left.lastModified ||
      left.name.localeCompare(right.name),
  );
  const rows = changes.map((change) => {
    const artifacts =
      change.artifacts.length > 0
        ? change.artifacts
            .map((artifact) => artifact.replace(/\.md$/, ""))
            .concat(change.requirements.length > 0 ? ["requirements"] : [])
            .join(",")
        : change.requirements.length > 0
          ? "requirements"
          : "(none)";
    const tasks = change.tasks
      ? `${change.tasks.done}/${change.tasks.total}`
      : "-";
    const review =
      change.wholeReview && change.format === "split"
        ? change.wholeReview
        : "-";
    const date =
      change.lastModified > 0
        ? new Date(change.lastModified).toISOString().slice(0, 10)
        : "unknown";
    return `${change.name.padEnd(28)} ${change.format.padEnd(20)} ${artifacts.padEnd(46)} ${tasks.padEnd(8)} ${String(review).padEnd(18)} ${date}`;
  });
  return result(
    "all",
    "success",
    0,
    [
      `${"change".padEnd(28)} ${"format".padEnd(20)} ${"artifacts".padEnd(46)} ${"tasks".padEnd(8)} ${"whole change".padEnd(18)} last modified`,
      ...rows,
    ].join("\n") + "\n",
    "",
    changes,
  );
};

export const context = async (
  args: ContextArguments = {},
  runtime: ContextRuntime = createContextRuntime(),
): Promise<ContextResult> =>
  args.all ? contextAll(runtime) : contextOne(runtime, args.changeDir);
export const renderContextResult = (contextResult: ContextResult): string =>
  contextResult.stdout.trimEnd() === ""
    ? contextResult.stderr.trimEnd()
    : contextResult.stdout.trimEnd();
