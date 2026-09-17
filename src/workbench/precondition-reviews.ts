import * as Path from "node:path";
import type { ValidArtifactContract } from "./artifact-types.js";
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
  readonly blocking: readonly string[];
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
  const latest = read.artifact.body.workflow.passes?.at(-1);
  if (title !== expectedTitle || latest === undefined)
    return "malformed";
  return {
    artifact: read.artifact,
    source: read.source,
    verdict: latest.verdict,
    base: latest.base,
    head: latest.head,
    blocking: latest.blocking,
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
