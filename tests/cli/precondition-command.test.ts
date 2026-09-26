import "reflect-metadata";
import type { DynamicModule, INestApplicationContext } from "@nestjs/common";
import { CommandFactory } from "nest-commander";
import { describe, expect, it } from "vitest";
import { DiffCommand } from "../../src/cli/nest/diff.command.js";
import { IsolateCommand } from "../../src/cli/nest/isolate.command.js";
import { ResultModule } from "../../src/cli/nest/result.module.js";
import { WorkbenchCommand } from "../../src/cli/nest/workbench.command.js";
import {
  PreconditionService,
  type PreconditionArguments,
  type PreconditionResult,
} from "../../src/workbench/precondition.js";
import { DiffService } from "../../src/workbench/diff.js";
import { IsolateService } from "../../src/workbench/isolate.js";

const result = (
  overrides: Partial<PreconditionResult> = {},
): PreconditionResult => ({
  _tag: "PreconditionResult",
  status: "success",
  exitCode: 0,
  stdout: "gate: open\n",
  stderr: "",
  lines: ["gate: open"],
  lastLine: "gate: open",
  ...overrides,
});

async function runCli(
  arguments_: string[],
  preconditionResult: PreconditionResult = result(),
) {
  const { PreconditionCommand } = await import(
    "../../src/cli/nest/precondition.command.js"
  );
  const calls: PreconditionArguments[] = [];
  let stdout = "";
  let stderr = "";
  const originalExitCode = process.exitCode;
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;
  let exitCode: number | string | undefined;
  class PreconditionCliHarnessModule {}
  const rootModule: DynamicModule = {
    module: PreconditionCliHarnessModule,
    imports: [ResultModule],
    providers: [
      WorkbenchCommand,
      IsolateCommand,
      DiffCommand,
      PreconditionCommand,
      {
        provide: IsolateService,
        useValue: { execute: async () => { throw new Error("unexpected isolate invocation"); } },
      },
      {
        provide: DiffService,
        useValue: { execute: async () => { throw new Error("unexpected diff invocation"); } },
      },
      {
        provide: PreconditionService,
        useValue: {
          execute: async (args: PreconditionArguments) => {
            calls.push(args);
            return preconditionResult;
          },
        },
      },
    ],
  };
  const originalArgv = process.argv;
  let application: INestApplicationContext | undefined;

  try {
    process.exitCode = 0;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stderr.write;
    application = await CommandFactory.createWithoutRunning(rootModule, {
      cliName: "hamilton",
      errorHandler: (error) => {
        throw error;
      },
      serviceErrorHandler: (error) => {
        throw error;
      },
    });
    process.argv = [originalArgv[0], "hamilton", ...arguments_];
    await CommandFactory.runApplication(application);
  } finally {
    exitCode = process.exitCode;
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
    await application?.close();
  }

  return { calls, exitCode, stderr, stdout };
}

describe("PreconditionCommand", () => {
  it("forwards required options and the waiver flag to PreconditionService", async () => {
    const harness = await runCli([
      "workbench",
      "precondition",
      "--change-dir",
      ".hamilton/change",
      "--test-cmd",
      "bun --bun vitest run",
      "--whole-change-waived",
    ]);

    expect(harness.calls).toEqual([
      {
        changeDir: ".hamilton/change",
        testCommand: "bun --bun vitest run",
        wholeChangeWaived: true,
      },
    ]);
    expect(harness.exitCode).toBe(0);
    expect(harness.stdout).toBe("gate: open\n");
    expect(harness.stderr).toBe("");
  });

  it("preserves a closed gate result and its final line", async () => {
    const harness = await runCli(
      [
        "workbench",
        "precondition",
        "--change-dir",
        ".hamilton/change",
        "--test-cmd",
        "bun --bun vitest run",
      ],
      result({
        status: "negative",
        exitCode: 1,
        stdout: "tests: passed\ngate: closed (1 failing)\n",
        stderr: "review feedback missing\n",
        lines: ["tests: passed", "gate: closed (1 failing)"],
        lastLine: "gate: closed (1 failing)",
      }),
    );

    expect(harness.calls).toEqual([
      {
        changeDir: ".hamilton/change",
        testCommand: "bun --bun vitest run",
        wholeChangeWaived: false,
      },
    ]);
    expect(harness.exitCode).toBe(1);
    expect(harness.stdout).toBe("tests: passed\ngate: closed (1 failing)\n");
    expect(harness.stderr).toBe("review feedback missing\n");
  });

  it("rejects missing required options before calling PreconditionService", async () => {
    const cases = [
      {
        arguments: [
          "workbench",
          "precondition",
          "--test-cmd",
          "bun --bun vitest run",
        ],
        message: "Expected to find option: '--change-dir'\n",
      },
      {
        arguments: [
          "workbench",
          "precondition",
          "--change-dir",
          ".hamilton/change",
        ],
        message: "Expected to find option: '--test-cmd'\n",
      },
      {
        arguments: ["workbench", "precondition"],
        message:
          "Expected to find option: '--change-dir'\n\nExpected to find option: '--test-cmd'\n",
      },
    ];

    for (const testCase of cases) {
      const harness = await runCli(testCase.arguments);

      expect(harness.calls).toEqual([]);
      expect(harness.exitCode).toBe(2);
      expect(harness.stdout).toBe("");
      expect(harness.stderr).toBe(testCase.message);
    }
  });
});
