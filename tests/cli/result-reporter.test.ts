import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { ResultModule } from "../../packages/cli/src/cli/nest/result.module.js";
import {
  RESULT_EXIT_SINK,
  RESULT_OUTPUT_SINK,
  ResultReporter,
  type CliResult,
} from "../../packages/cli/src/cli/nest/result-reporter.js";

type Event =
  | { readonly type: "stdout" | "stderr"; readonly value: string }
  | { readonly type: "exitCode"; readonly value: 0 | 1 | 2 };

const resolveReporter = async () => {
  const events: Event[] = [];
  const module = await Test.createTestingModule({ imports: [ResultModule] })
    .overrideProvider(RESULT_OUTPUT_SINK)
    .useValue({
      stdout: (value: string) => events.push({ type: "stdout", value }),
      stderr: (value: string) => events.push({ type: "stderr", value }),
    })
    .overrideProvider(RESULT_EXIT_SINK)
    .useValue({
      setExitCode: (value: 0 | 1 | 2) => events.push({ type: "exitCode", value }),
    })
    .compile();

  return { reporter: module.get(ResultReporter), events, module };
};

describe("ResultReporter", () => {
  it("is exported by ResultModule", async () => {
    const { reporter, module } = await resolveReporter();

    try {
      expect(reporter).toBeInstanceOf(ResultReporter);
    } finally {
      await module.close();
    }
  });

  it.each([
    {
      name: "success",
      result: {
        stdout: "success output\n",
        stderr: "success warning\n",
        exitCode: 0,
      },
    },
    {
      name: "negative result",
      result: {
        stdout: "negative output\n",
        stderr: "negative diagnostic\n",
        exitCode: 1,
      },
    },
    {
      name: "error result",
      result: {
        stdout: "error output\n",
        stderr: "error diagnostic\n",
        exitCode: 2,
      },
    },
  ] satisfies ReadonlyArray<{ readonly name: string; readonly result: CliResult }>)(
    "reports a $name without changing either stream or its status",
    async ({ result }) => {
      const { reporter, events, module } = await resolveReporter();

      try {
        reporter.report(result);

        expect(events).toEqual([
          { type: "exitCode", value: result.exitCode },
          { type: "stdout", value: result.stdout },
          { type: "stderr", value: result.stderr },
        ]);
      } finally {
        await module.close();
      }
    },
  );

  it("reports an already-rendered lint string without transforming it", async () => {
    const { reporter, events, module } = await resolveReporter();
    const lintOutput = "lint: findings\nfile.md: invalid metadata\n";

    try {
      reporter.report({ stdout: lintOutput, stderr: "", exitCode: 1 });

      expect(events).toEqual([
        { type: "exitCode", value: 1 },
        { type: "stdout", value: lintOutput },
        { type: "stderr", value: "" },
      ]);
    } finally {
      await module.close();
    }
  });
});
