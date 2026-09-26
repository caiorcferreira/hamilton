import { CommandRunner, Option, SubCommand } from "nest-commander";
import {
  PreconditionService,
  type PreconditionArguments,
} from "../../workbench/precondition.js";
import { ResultReporter } from "./result-reporter.js";

@SubCommand({
  name: "precondition",
  description: "Evaluate finish-work precondition gates",
})
export class PreconditionCommand extends CommandRunner {
  constructor(
    private readonly preconditionService: PreconditionService,
    private readonly reporter: ResultReporter,
  ) {
    super();
  }

  @Option({
    flags: "--change-dir <directory>",
    name: "changeDir",
    description: "Select the change directory",
  })
  parseChangeDir(directory: string): string {
    return directory;
  }

  @Option({
    flags: "--test-cmd <command>",
    name: "testCommand",
    description: "Run the required test command",
  })
  parseTestCommand(command: string): string {
    return command;
  }

  @Option({
    flags: "--whole-change-waived",
    name: "wholeChangeWaived",
    description: "Waive whole-change freshness requirements",
  })
  parseWholeChangeWaived(): boolean {
    return true;
  }

  async run(
    _passedParams: string[],
    options?: Record<string, unknown>,
  ): Promise<void> {
    const changeDir =
      typeof options?.changeDir === "string" ? options.changeDir : undefined;
    const testCommand =
      typeof options?.testCommand === "string"
        ? options.testCommand
        : undefined;
    if (changeDir === undefined || testCommand === undefined) {
      const missingOptions = [
        ...(changeDir === undefined
          ? ["Expected to find option: '--change-dir'"]
          : []),
        ...(testCommand === undefined
          ? ["Expected to find option: '--test-cmd'"]
          : []),
      ];
      this.reporter.report({
        stdout: "",
        stderr: `${missingOptions.join("\n\n")}\n`,
        exitCode: 2,
      });
      return;
    }

    const args: PreconditionArguments = {
      changeDir,
      testCommand,
      wholeChangeWaived: options?.wholeChangeWaived === true,
    };
    const result = await this.preconditionService.execute(args);
    this.reporter.report({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }
}
