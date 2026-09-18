import * as Path from "node:path";
import {
  cleanTree,
  resolveTarget,
  resultIsFailure,
  runTestCommand,
  testGate,
  type CleanTreeGate,
} from "./precondition-gates.js";
import {
  inspectTasks,
  type TaskInspection,
} from "./precondition-artifacts.js";
import {
  inspectFreshness,
  inspectReviews,
  type ReviewInspection,
} from "./precondition-reviews.js";
import {
  createPreconditionRuntime,
  type PreconditionArguments,
  type PreconditionResult,
  type PreconditionRuntime,
} from "./precondition-runtime.js";
import type { ProcessResult } from "./runtime.js";

export {
  createPreconditionRuntime,
  type PreconditionArguments,
  type PreconditionFileSystemPort,
  type PreconditionGitPort,
  type PreconditionResult,
  type PreconditionResultStatus,
  type PreconditionRuntime,
  type PreconditionRuntimeOverrides,
} from "./precondition-runtime.js";
export { runTestCommand } from "./precondition-gates.js";

const result = (
  status: "success" | "negative" | "error",
  exitCode: 0 | 1 | 2,
  stdout = "",
  stderr = "",
): PreconditionResult => {
  const lines = stdout.split("\n").filter((line) => line !== "");
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

const isResult = (
  value: CleanTreeGate | ProcessResult | PreconditionResult,
): value is PreconditionResult => resultIsFailure(value);

export const precondition = async (
  args: PreconditionArguments,
  runtime: PreconditionRuntime = createPreconditionRuntime(),
): Promise<PreconditionResult> => {
  const target = await resolveTarget(args, runtime);
  if (typeof target !== "string") return target;
  let output = "";
  let failures = 0;

  const initial = await cleanTree(runtime, target, "Clean tree");
  if (isResult(initial)) return initial;
  output += initial.output;
  if (!initial.clean) failures += 1;

  const execution = await runTestCommand(runtime, args.testCommand, target);
  if (isResult(execution)) return execution;
  const tests = testGate(args.testCommand, execution);
  output += tests.output;
  if (!tests.passed) failures += 1;

  const after = await cleanTree(
    runtime,
    target,
    "Clean tree after verification",
  );
  if (isResult(after)) return result("error", 2, output, after.stderr);
  output += after.output;
  if (!after.clean) failures += 1;

  const tasks: TaskInspection = await inspectTasks(
    runtime,
    target,
    Path.resolve(args.changeDir),
  );
  output += tasks.output;
  if (!tasks.passed) failures += 1;
  const reviews: ReviewInspection = await inspectReviews(
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
    if (isResult(final)) return result("error", 2, output, final.stderr);
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
