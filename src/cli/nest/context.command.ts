import { CommandRunner, Option, SubCommand } from "nest-commander";
import {
  ContextService,
  type ContextArguments,
} from "../../workbench/context.js";
import { ResultReporter } from "./result-reporter.js";

@SubCommand({
  name: "context",
  arguments: "[change-dir]",
  description: "Report Hamilton change context",
})
export class ContextCommand extends CommandRunner {
  constructor(
    private readonly contextService: ContextService,
    private readonly reporter: ResultReporter,
  ) {
    super();
  }

  @Option({ flags: "--all", description: "List all changes" })
  parseAll(): boolean {
    return true;
  }

  async run(
    passedParams: string[],
    options?: Record<string, unknown>,
  ): Promise<void> {
    const all = options?.all === true;
    const changeDir = passedParams[0];

    if (all && changeDir !== undefined) {
      this.reportUsageError("--all takes no change directory");
      return;
    }

    const args: ContextArguments = { all, changeDir };
    const result = await this.contextService.execute(args);
    this.reporter.report({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    });
  }

  private reportUsageError(message: string): void {
    this.reporter.report({
      stdout: "",
      stderr: `error: ${message}\n`,
      exitCode: 2,
    });
  }
}
