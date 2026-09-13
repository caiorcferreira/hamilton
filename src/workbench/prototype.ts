import {
  createRuntime,
  type ProcessPort,
  type ProcessResult,
} from "./runtime.js";

export interface MappedPrototypeArguments {
  readonly mode: "mapped";
  readonly mapName: string;
  readonly ticketName: string;
}

export interface StandalonePrototypeArguments {
  readonly mode: "standalone";
  readonly slug: string;
}

export interface VerifyPrototypeArguments {
  readonly mode: "verify";
  readonly expectedBranch: string;
}

export type PrototypeArguments =
  | MappedPrototypeArguments
  | StandalonePrototypeArguments
  | VerifyPrototypeArguments;

export type PrototypeOperation = PrototypeArguments["mode"];
export type PrototypeResultStatus = "success" | "negative" | "error";

export interface PrototypeResult {
  readonly _tag: "PrototypeResult";
  readonly operation: PrototypeOperation;
  readonly status: PrototypeResultStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly stdout: string;
  readonly stderr: string;
  readonly lines: readonly string[];
  readonly lastLine: string;
}

export interface PrototypeGitPort {
  readonly repositoryRoot: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly currentBranch: (
    cwd: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly branchExists: (
    cwd: string,
    branch: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly switchBranch: (
    cwd: string,
    branch: string,
  ) => ProcessResult | Promise<ProcessResult>;
  readonly createBranch: (
    cwd: string,
    branch: string,
  ) => ProcessResult | Promise<ProcessResult>;
}

export interface PrototypeRuntime {
  readonly cwd: () => string;
  readonly git: PrototypeGitPort;
}

export interface PrototypeRuntimeOverrides {
  readonly cwd?: () => string;
  readonly process?: ProcessPort;
  readonly git?: PrototypeGitPort;
}

const prototypeGitPort = (processPort: ProcessPort): PrototypeGitPort => ({
  repositoryRoot: (cwd) =>
    processPort.run("git", ["rev-parse", "--show-toplevel"], cwd),
  currentBranch: (cwd) =>
    processPort.run("git", ["branch", "--show-current"], cwd),
  branchExists: (cwd, branch) =>
    processPort.run(
      "git",
      ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
      cwd,
    ),
  switchBranch: (cwd, branch) =>
    processPort.run("git", ["switch", branch], cwd),
  createBranch: (cwd, branch) =>
    processPort.run("git", ["switch", "-c", branch], cwd),
});

export const createPrototypeRuntime = (
  overrides: PrototypeRuntimeOverrides = {},
): PrototypeRuntime => {
  const runtime = createRuntime({
    cwd: overrides.cwd,
    process: overrides.process,
  });
  return {
    cwd: runtime.cwd,
    git: overrides.git ?? prototypeGitPort(runtime.process),
  };
};

const linesOf = (stdout: string): readonly string[] =>
  stdout.split("\n").filter((line) => line !== "");

const result = (
  operation: PrototypeOperation,
  status: PrototypeResultStatus,
  exitCode: 0 | 1 | 2,
  stdout = "",
  stderr = "",
): PrototypeResult => {
  const lines = linesOf(stdout);
  return {
    _tag: "PrototypeResult",
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
  operation: PrototypeOperation,
  message: string,
  exitCode: 1 | 2 = 2,
): PrototypeResult =>
  result(operation, "error", exitCode, "", `error: ${message}\n`);

const commandError = (
  operation: PrototypeOperation,
  action: string,
  command: ProcessResult,
): PrototypeResult => {
  const detail = command.stderr.trim();
  return failure(
    operation,
    `${action}${detail === "" ? "" : `: ${detail}`}`,
    2,
  );
};

const successful = (command: ProcessResult): boolean => command.status === 0;
const text = (command: ProcessResult): string => command.stdout.trim();

const validate = (args: PrototypeArguments): string | undefined => {
  if (args.mode === "mapped") {
    if (args.mapName === "") return "map name is required";
    if (args.ticketName === "") return "ticket name is required";
    if (args.mapName.startsWith("-") || args.ticketName.startsWith("-"))
      return "mapped names cannot start with -";
    return undefined;
  }
  if (args.mode === "standalone") {
    if (args.slug === "") return "slug is required";
    if (args.slug.startsWith("-")) return "slug cannot start with -";
    return undefined;
  }
  if (args.expectedBranch === "") return "expected branch is required";
  return undefined;
};

const repository = async (
  operation: PrototypeOperation,
  runtime: PrototypeRuntime,
): Promise<string | PrototypeResult> => {
  const command = await runtime.git.repositoryRoot(runtime.cwd());
  if (!successful(command))
    return commandError(operation, "not inside a git repository", command);
  const root = text(command);
  return root === ""
    ? failure(operation, "cannot resolve repository root")
    : root;
};

const switchBranch = async (
  operation: "mapped" | "standalone",
  branch: string,
  runtime: PrototypeRuntime,
): Promise<PrototypeResult> => {
  const root = await repository(operation, runtime);
  if (typeof root !== "string") return root;

  const exists = await runtime.git.branchExists(root, branch);
  let mode: "created" | "resumed";
  let mutation: ProcessResult;
  if (exists.status === 0) {
    mode = "resumed";
    mutation = await runtime.git.switchBranch(root, branch);
  } else if (exists.status === 1) {
    mode = "created";
    mutation = await runtime.git.createBranch(root, branch);
  } else {
    return commandError(operation, `cannot inspect branch ${branch}`, exists);
  }

  if (!successful(mutation))
    return commandError(operation, `git branch mutation for ${branch} failed`, mutation);
  return result(operation, "success", 0, `mode: ${mode}\n${branch}\n`);
};

const verify = async (
  args: VerifyPrototypeArguments,
  runtime: PrototypeRuntime,
): Promise<PrototypeResult> => {
  const root = await repository(args.mode, runtime);
  if (typeof root !== "string") return root;
  const current = await runtime.git.currentBranch(root);
  if (!successful(current))
    return commandError(args.mode, "cannot determine current branch", current);
  const branch = text(current);
  if (branch === args.expectedBranch)
    return result(args.mode, "success", 0, `verified: ${branch}\n`);
  return result(
    args.mode,
    "negative",
    1,
    "",
    `not on ${args.expectedBranch} — current branch is ${branch}\n`,
  );
};

export const prototype = async (
  args: PrototypeArguments,
  runtime: PrototypeRuntime = createPrototypeRuntime(),
): Promise<PrototypeResult> => {
  const invalid = validate(args);
  if (invalid !== undefined) return failure(args.mode, invalid);
  if (args.mode === "verify") return verify(args, runtime);
  const branch =
    args.mode === "mapped"
      ? `prototype/${args.mapName}/${args.ticketName}`
      : `prototype/${args.slug}`;
  return switchBranch(args.mode, branch, runtime);
};

export const createPrototypeBranch = (
  mapName: string,
  ticketName: string,
  runtime?: PrototypeRuntime,
): Promise<PrototypeResult> =>
  prototype({ mode: "mapped", mapName, ticketName }, runtime);

export const createStandalonePrototypeBranch = (
  slug: string,
  runtime?: PrototypeRuntime,
): Promise<PrototypeResult> => prototype({ mode: "standalone", slug }, runtime);

export const verifyPrototypeBranch = (
  expectedBranch: string,
  runtime?: PrototypeRuntime,
): Promise<PrototypeResult> => prototype({ mode: "verify", expectedBranch }, runtime);

export const renderPrototypeResult = (
  prototypeResult: PrototypeResult,
): string =>
  prototypeResult.stdout.trimEnd() === ""
    ? prototypeResult.stderr.trimEnd()
    : prototypeResult.stdout.trimEnd();
