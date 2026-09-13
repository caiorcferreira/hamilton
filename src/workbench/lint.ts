import * as Fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import * as Path from "node:path";
import {
  createArtifactReader,
  type ArtifactFileSystem,
  type ArtifactReadResult,
} from "./artifact-reader.js";
import {
  validateArtifact,
  type ArtifactContractResult,
} from "./artifact-contracts.js";

export interface LintScope {
  readonly file?: string;
  readonly changeDir?: string;
}

export interface LintFileSystem extends ArtifactFileSystem {
  readonly stat: (sourcePath: string) => Promise<Stats>;
  readonly readdir: (sourcePath: string) => Promise<readonly Dirent[]>;
  readonly realpath: (sourcePath: string) => Promise<string>;
}

export type LintFindingKind = "error" | "warning" | "skipped" | "success";

export interface LintFinding {
  readonly kind: LintFindingKind;
  readonly sourcePath: string;
  readonly message: string;
  readonly code?: string;
  readonly line: number;
  readonly column?: number;
}

export type LintResultStatus = "success" | "findings" | "invalid-scope";

export interface LintResult {
  readonly _tag: "LintResult";
  readonly status: LintResultStatus;
  readonly exitCode: 0 | 1 | 2;
  readonly findings: readonly LintFinding[];
}

export interface LintDependencies {
  readonly fileSystem?: LintFileSystem;
  readonly readArtifact?: (sourcePath: string) => Promise<ArtifactReadResult>;
  readonly validateArtifact?: (
    result: ArtifactReadResult,
  ) => ArtifactContractResult;
}

const defaultFileSystem: LintFileSystem = {
  readFile: (sourcePath) => Fs.readFile(sourcePath, "utf8"),
  stat: (sourcePath) => Fs.stat(sourcePath),
  readdir: async (sourcePath) =>
    Fs.readdir(sourcePath, { withFileTypes: true }),
  realpath: (sourcePath) => Fs.realpath(sourcePath),
};

const normalizedPath = (sourcePath: string): string =>
  sourcePath.replaceAll("\\", "/");

const comparePaths = (left: string, right: string): number => {
  const a = normalizedPath(left);
  const b = normalizedPath(right);
  return a < b ? -1 : a > b ? 1 : 0;
};

const isContained = (root: string, sourcePath: string): boolean =>
  sourcePath === root || sourcePath.startsWith(root + Path.sep);

const finding = (
  kind: LintFindingKind,
  sourcePath: string,
  message: string,
  line = 1,
  code?: string,
  column?: number,
): LintFinding => {
  const base = { kind, sourcePath, message, line: Math.max(line, 1) };
  if (code !== undefined && column !== undefined)
    return { ...base, code, column };
  if (code !== undefined) return { ...base, code };
  if (column !== undefined) return { ...base, column };
  return base;
};

const conventionalArtifactName = (sourcePath: string): boolean => {
  const basename = Path.basename(sourcePath);
  if (
    [
      "proposal.md",
      "design.md",
      "plan.md",
      "progress.md",
      "feedback.md",
      "review.md",
      "finish.md",
      "critique.md",
      "map.md",
      "route.md",
    ].includes(basename)
  )
    return true;
  if (/^[0-9]{2,}-[^/]+\.md$/.test(basename)) {
    const parent = Path.basename(Path.dirname(sourcePath));
    return parent === "tickets";
  }
  return false;
};

const diagnosticFinding = (
  sourcePath: string,
  diagnostic: {
    readonly message: string;
    readonly code: string;
    readonly location?: { readonly line: number; readonly column?: number };
  },
): LintFinding =>
  finding(
    "error",
    sourcePath,
    diagnostic.message,
    diagnostic.location?.line,
    diagnostic.code,
    diagnostic.location?.column,
  );

const validateCandidate = async (
  sourcePath: string,
  readArtifact: (sourcePath: string) => Promise<ArtifactReadResult>,
  validate: (result: ArtifactReadResult) => ArtifactContractResult,
): Promise<LintFinding[]> => {
  const readResult = await readArtifact(sourcePath);
  if (readResult._tag === "invalid")
    return [diagnosticFinding(sourcePath, readResult.diagnostic)];
  if (readResult._tag === "unrelated") {
    const isConventional = conventionalArtifactName(sourcePath);
    return [
      finding(
        isConventional ? "warning" : "skipped",
        sourcePath,
        isConventional
          ? "Conventional Hamilton artifact filename has no frontmatter"
          : "File is unrelated to Hamilton artifacts",
        readResult.locations.body.startLine,
        isConventional ? "missing-frontmatter" : "skipped",
      ),
    ];
  }
  const contractResult = validate(readResult);
  if (contractResult._tag === "skipped")
    return [finding("skipped", sourcePath, "File was skipped")];
  if (contractResult._tag === "invalid")
    return contractResult.diagnostics.map((diagnostic) =>
      diagnosticFinding(sourcePath, diagnostic),
    );
  return [
    finding(
      "success",
      sourcePath,
      `Valid ${contractResult.artifact} artifact`,
      readResult.locations.frontmatter.startLine,
      "valid",
    ),
  ];
};

const invalidScope = (message: string, sourcePath?: string): LintResult => ({
  _tag: "LintResult",
  status: "invalid-scope",
  exitCode: 2,
  findings: [
    finding("error", sourcePath ?? "<scope>", message, 1, "invalid-scope"),
  ],
});

const collectFiles = async (
  root: string,
  fileSystem: LintFileSystem,
): Promise<
  { readonly paths: readonly string[] } | { readonly error: string }
> => {
  let rootRealPath: string;
  try {
    rootRealPath = await fileSystem.realpath(root);
  } catch (error) {
    return {
      error: `Unable to resolve change directory ${root}: ${String(error)}`,
    };
  }
  const files: string[] = [];
  const visitedDirectories = new Set<string>();
  const visit = async (directory: string): Promise<string | undefined> => {
    let realDirectory: string;
    try {
      realDirectory = await fileSystem.realpath(directory);
    } catch {
      return undefined;
    }
    if (!isContained(rootRealPath, realDirectory)) return undefined;
    if (visitedDirectories.has(realDirectory)) return undefined;
    visitedDirectories.add(realDirectory);
    let entries: readonly Dirent[];
    try {
      entries = await fileSystem.readdir(directory);
    } catch (error) {
      return `Unable to inspect ${directory}: ${String(error)}`;
    }
    for (const entry of [...entries].sort((left, right) =>
      comparePaths(left.name, right.name),
    )) {
      const candidate = Path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const error = await visit(candidate);
        if (error) return error;
        continue;
      }
      if (entry.isFile()) {
        files.push(candidate);
        continue;
      }
      if (!entry.isSymbolicLink()) continue;
      let target: Stats;
      let realTarget: string;
      try {
        realTarget = await fileSystem.realpath(candidate);
        if (!isContained(rootRealPath, realTarget)) continue;
        target = await fileSystem.stat(candidate);
      } catch {
        continue;
      }
      if (target.isDirectory()) {
        const error = await visit(candidate);
        if (error) return error;
      } else if (target.isFile()) {
        files.push(candidate);
      }
    }
    return undefined;
  };
  const error = await visit(root);
  return error ? { error } : { paths: files.sort(comparePaths) };
};

export const lintScope = async (
  scope: LintScope,
  dependencies: LintDependencies = {},
): Promise<LintResult> => {
  const hasFile = scope.file !== undefined;
  const hasChangeDirectory = scope.changeDir !== undefined;
  if (hasFile === hasChangeDirectory) {
    const message = hasFile
      ? "Exactly one of file or changeDir may be supplied"
      : "Exactly one of file or changeDir is required";
    return invalidScope(message);
  }

  const fileSystem = dependencies.fileSystem ?? defaultFileSystem;
  let candidates: readonly string[];
  if (hasFile) {
    const sourcePath = scope.file as string;
    let stats: Stats;
    try {
      stats = await fileSystem.stat(sourcePath);
    } catch (error) {
      return invalidScope(
        `Unable to inspect file ${sourcePath}: ${String(error)}`,
        sourcePath,
      );
    }
    if (!stats.isFile())
      return invalidScope(
        `File selector is not a regular file: ${sourcePath}`,
        sourcePath,
      );
    candidates = [sourcePath];
  } else {
    const changeDirectory = scope.changeDir as string;
    let stats: Stats;
    try {
      stats = await fileSystem.stat(changeDirectory);
    } catch (error) {
      return invalidScope(
        `Unable to inspect changeDir ${changeDirectory}: ${String(error)}`,
        changeDirectory,
      );
    }
    if (!stats.isDirectory())
      return invalidScope(
        `changeDir selector is not a directory: ${changeDirectory}`,
        changeDirectory,
      );
    const collected = await collectFiles(changeDirectory, fileSystem);
    if ("error" in collected)
      return invalidScope(collected.error, changeDirectory);
    candidates = collected.paths;
  }

  const readArtifact =
    dependencies.readArtifact ?? createArtifactReader(fileSystem);
  const validate = dependencies.validateArtifact ?? validateArtifact;
  const findings = (
    await Promise.all(
      candidates.map((sourcePath) =>
        validateCandidate(sourcePath, readArtifact, validate),
      ),
    )
  ).flat();
  findings.sort((left, right) => {
    const pathOrder = comparePaths(left.sourcePath, right.sourcePath);
    if (pathOrder !== 0) return pathOrder;
    if (left.line !== right.line) return left.line - right.line;
    if ((left.column ?? 0) !== (right.column ?? 0))
      return (left.column ?? 0) - (right.column ?? 0);
    return left.kind < right.kind ? -1 : left.kind > right.kind ? 1 : 0;
  });
  const hasFindings = findings.some(
    (item) => item.kind === "error" || item.kind === "warning",
  );
  return {
    _tag: "LintResult",
    status: hasFindings ? "findings" : "success",
    exitCode: hasFindings ? 1 : 0,
    findings,
  };
};

export const renderLintResult = (result: LintResult): string => {
  const lines = result.findings.map((item) => {
    const severity = item.kind.toUpperCase();
    const location = `${normalizedPath(item.sourcePath)}:${item.line}${item.column === undefined ? "" : `:${item.column}`}`;
    const code = item.code === undefined ? "" : ` [${item.code}]`;
    return `${severity} ${location}${code} ${item.message}`;
  });
  let summary = "lint: invalid scope";
  if (result.status === "success") summary = "lint: success";
  if (result.status === "findings") summary = "lint: findings";
  return [...lines, summary].join("\n");
};

export const lint = lintScope;
