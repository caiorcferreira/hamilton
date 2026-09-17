import * as Path from "node:path";
import type {
  ArtifactWorkflowRecord,
  ValidArtifactContract,
} from "./artifact-types.js";
import { createArtifactBodyView } from "./artifact-body.js";
import {
  exactArtifactCommit,
  type TaskInspection,
  readContract,
  type TaskEvidence,
  titleOf,
} from "./precondition-artifacts.js";
import {
  fullCommit,
  gitCurrentHead,
  gitIsAncestor,
  gitLatestMaterialCommit,
  gitResolveCommit,
  relativePath,
  successful,
  text,
} from "./precondition-git.js";
import type { PreconditionRuntime } from "./precondition-runtime.js";

export const blockingFinding = (value: string): boolean => {
  const match = /^- \[(.+)\] (.+)$/.exec(value);
  if (match === null) return false;
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

export interface PassSections {
  readonly blocking: readonly string[];
  readonly suggestions: readonly string[];
}

export const passSections = (
  artifact: ValidArtifactContract,
  source: string,
  pass: ArtifactWorkflowRecord,
): PassSections | null => {
  if (pass.kind !== "pass") return null;
  const allLines = source.split(/\r\n|\n|\r/);
  let delimiters = 0;
  const closeIndex = allLines.findIndex((line) => {
    if (line.trim() !== "---" && line.trim() !== "...") return false;
    delimiters += 1;
    return delimiters === 2;
  });
  if (closeIndex < 0) return null;
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
  if (blockingIndex < 0 || suggestionsIndex < blockingIndex) return null;
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

export const validPassContent = (
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
    if (sections === null) return false;
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

export type RangeStatus = "malformed" | "off-branch" | "stale" | "fresh";

export const validRange = async (
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

export interface ReviewEvidence {
  readonly artifact: ValidArtifactContract;
  readonly source: string;
  readonly verdict: string;
  readonly base: unknown;
  readonly head: unknown;
}

export interface ReviewInspection {
  readonly output: string;
  readonly passed: boolean;
  readonly review?: ReviewEvidence;
  readonly reviewReason?: string;
  readonly reviewDurable: boolean;
  readonly reviewRange: RangeStatus;
}

export const readReview = async (
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

export const inspectReviews = async (
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
  let reviewReason: string | null = null;
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
    ...(reviewReason === null ? {} : { reviewReason }),
    reviewDurable,
    reviewRange,
  };
};

export const inspectFreshness = async (
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
      inspection.tasks.map((task: TaskEvidence) => task.progressPath),
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
