import { Args, Command, Options } from "@effect/cli";
import { Console, Effect, Option } from "effect";
import {
  context,
  createContextRuntime,
} from "../../workbench/context.js";
import {
  diff,
  createDiffRuntime,
} from "../../workbench/diff.js";
import {
  checkIsolation,
  createIsolation,
  verifyIsolation,
} from "../../workbench/isolate.js";
import { lintScope, renderLintResult } from "../../workbench/lint.js";
import {
  precondition,
  createPreconditionRuntime,
} from "../../workbench/precondition.js";
import {
  createPrototypeBranch,
  createPrototypeRuntime,
  createStandalonePrototypeBranch,
  verifyPrototypeBranch,
} from "../../workbench/prototype.js";

const optionalText = (name: string) =>
  Options.text(name).pipe(Options.optional);
const optionalArgument = Args.text().pipe(Args.optional);
const valueOf = <A>(value: Option.Option<A>): A | undefined =>
  Option.getOrUndefined(value);

type Result = { readonly exitCode: number };

type StreamResult = Result & {
  readonly stdout: string;
  readonly stderr: string;
};

const runStreamResult = <A extends StreamResult>(
  promise: Promise<A>,
): Effect.Effect<void> =>
  Effect.promise(() => promise).pipe(
    Effect.flatMap((result) =>
      Effect.sync(() => {
        process.exitCode = result.exitCode;
        process.stdout.write(result.stdout);
        process.stderr.write(result.stderr);
      }),
    ),
  );

const runRenderedResult = <A extends Result>(
  promise: Promise<A>,
  render: (result: A) => string,
): Effect.Effect<void> =>
  Effect.promise(() => promise).pipe(
    Effect.flatMap((result) =>
      Effect.sync(() => {
        process.exitCode = result.exitCode;
      }).pipe(Effect.zipRight(Console.log(render(result)))),
    ),
  );

const usageFailure = (message: string): Effect.Effect<void> =>
  Effect.sync(() => {
    process.exitCode = 2;
    console.error(`error: ${message}`);
  });

const isolateCheck = Options.boolean("check");
const isolateVerify = optionalText("verify");
const isolateChangeDir = optionalText("change-dir");
const isolateTitle = optionalArgument;

export const isolateCommand = Command.make(
  "isolate",
  {
    check: isolateCheck,
    verify: isolateVerify,
    changeDir: isolateChangeDir,
    title: isolateTitle,
  },
  ({ check, verify, changeDir, title }) => {
    const expectedTitle = valueOf(verify);
    const positionalTitle = valueOf(title);
    if (check && (expectedTitle !== undefined || positionalTitle !== undefined))
      return usageFailure(
        "--check cannot be combined with --verify or a title",
      );
    if (
      expectedTitle !== undefined &&
      (positionalTitle !== undefined || valueOf(changeDir) !== undefined)
    )
      return usageFailure(
        "--verify cannot be combined with --change-dir or a title",
      );
    if (check)
      return runStreamResult(checkIsolation(valueOf(changeDir)));
    if (expectedTitle !== undefined)
      return runStreamResult(verifyIsolation(expectedTitle));
    if (positionalTitle === undefined)
      return usageFailure("isolate create mode requires a title");
    if (valueOf(changeDir) !== undefined)
      return usageFailure("--change-dir requires --check");
    return runStreamResult(createIsolation(positionalTitle));
  },
).pipe(Command.withDescription("Check, create, or verify workspace isolation"));

const diffRecord = Options.boolean("record");
const diffWholeChange = Options.boolean("whole-change");
const diffBase = optionalText("base");
const diffChangeDir = optionalText("change-dir");
const diffTask = optionalText("task");
const diffOut = optionalText("out");

export const diffCommand = Command.make(
  "diff",
  {
    record: diffRecord,
    wholeChange: diffWholeChange,
    base: diffBase,
    changeDir: diffChangeDir,
    task: diffTask,
    out: diffOut,
  },
  ({ record, wholeChange, base, changeDir, task, out }) => {
    const baseValue = valueOf(base);
    const changeDirValue = valueOf(changeDir);
    const taskValue = valueOf(task);
    const outValue = valueOf(out);
    if (record) {
      if (
        wholeChange ||
        baseValue !== undefined ||
        taskValue === undefined ||
        outValue !== undefined
      )
        return usageFailure(
          "--record requires --task and cannot be combined with --base, --whole-change, or --out",
        );
      return runStreamResult(
        diff(
          { mode: "record", task: taskValue, changeDir: changeDirValue },
          createDiffRuntime(),
        ),
      );
    }
    if (wholeChange) {
      if (
        baseValue !== undefined ||
        changeDirValue !== undefined ||
        taskValue !== undefined
      )
        return usageFailure(
          "--whole-change cannot be combined with --base, --change-dir, or --task",
        );
      return runStreamResult(
        diff({ mode: "whole-change", out: outValue }, createDiffRuntime()),
      );
    }
    if (baseValue !== undefined) {
      if (taskValue !== undefined)
        return usageFailure("--task is meaningless with --base");
      return runStreamResult(
        diff(
          {
            mode: "base",
            base: baseValue,
            changeDir: changeDirValue,
            out: outValue,
          },
          createDiffRuntime(),
        ),
      );
    }
    if (taskValue === undefined)
      return usageFailure("--task is required when --base is not given");
    return runStreamResult(
      diff(
        {
          mode: "task",
          task: taskValue,
          changeDir: changeDirValue,
          out: outValue,
        },
        createDiffRuntime(),
      ),
    );
  },
).pipe(Command.withDescription("Record checkpoints and package review diffs"));

const preconditionChangeDir = Options.text("change-dir");
const preconditionTestCommand = Options.text("test-cmd");
const preconditionWaived = Options.boolean("whole-change-waived");

export const preconditionCommand = Command.make(
  "precondition",
  {
    changeDir: preconditionChangeDir,
    testCommand: preconditionTestCommand,
    wholeChangeWaived: preconditionWaived,
  },
  ({ changeDir, testCommand, wholeChangeWaived }) =>
    runStreamResult(
      precondition(
        { changeDir, testCommand, wholeChangeWaived },
        createPreconditionRuntime(),
      ),
    ),
).pipe(Command.withDescription("Evaluate finish-work precondition gates"));

const contextAll = Options.boolean("all");
const contextChangeDir = optionalArgument;

export const contextCommand = Command.make(
  "context",
  { all: contextAll, changeDir: contextChangeDir },
  ({ all, changeDir }) => {
    const target = valueOf(changeDir);
    if (all && target !== undefined)
      return usageFailure("--all takes no change directory");
    return runStreamResult(
      context({ all, changeDir: target }, createContextRuntime()),
    );
  },
).pipe(Command.withDescription("Report Hamilton change context"));

const prototypeStandalone = optionalText("standalone");
const prototypeVerify = optionalText("verify");
const prototypeMapName = Args.text().pipe(Args.optional);
const prototypeTicketName = Args.text().pipe(Args.optional);

export const prototypeCommand = Command.make(
  "prototype",
  {
    standalone: prototypeStandalone,
    verify: prototypeVerify,
    mapName: prototypeMapName,
    ticketName: prototypeTicketName,
  },
  ({ standalone, verify, mapName, ticketName }) => {
    const standaloneValue = valueOf(standalone);
    const verifyValue = valueOf(verify);
    const mapValue = valueOf(mapName);
    const ticketValue = valueOf(ticketName);
    const positionalCount =
      (mapValue === undefined ? 0 : 1) + (ticketValue === undefined ? 0 : 1);
    if (
      standaloneValue !== undefined &&
      (verifyValue !== undefined || positionalCount > 0)
    )
      return usageFailure(
        "--standalone cannot be combined with --verify or mapped arguments",
      );
    if (verifyValue !== undefined && positionalCount > 0)
      return usageFailure("--verify cannot be combined with mapped arguments");
    if (standaloneValue !== undefined)
      return runStreamResult(
        createStandalonePrototypeBranch(
          standaloneValue,
          createPrototypeRuntime(),
        ),
      );
    if (verifyValue !== undefined)
      return runStreamResult(
        verifyPrototypeBranch(verifyValue, createPrototypeRuntime()),
      );
    if (mapValue === undefined || ticketValue === undefined)
      return usageFailure(
        "prototype mapped mode requires <map-name> <ticket-name>",
      );
    return runStreamResult(
      createPrototypeBranch(mapValue, ticketValue, createPrototypeRuntime()),
    );
  },
).pipe(Command.withDescription("Create, resume, or verify prototype branches"));

const lintFile = optionalText("file");
const lintChangeDir = optionalText("change-dir");

export const lintCommand = Command.make(
  "lint",
  { file: lintFile, changeDir: lintChangeDir },
  ({ file, changeDir }) =>
    runRenderedResult(
      lintScope({ file: valueOf(file), changeDir: valueOf(changeDir) }),
      renderLintResult,
    ),
).pipe(
  Command.withDescription("Validate one file or an explicit change directory"),
);

export const workbenchCommand = Command.make("workbench", {}, () =>
  usageFailure("workbench requires a subcommand"),
).pipe(
  Command.withDescription(
    "Hamilton workflow mechanics and artifact validation",
  ),
  Command.withSubcommands([
    isolateCommand,
    diffCommand,
    preconditionCommand,
    contextCommand,
    prototypeCommand,
    lintCommand,
  ]),
);
