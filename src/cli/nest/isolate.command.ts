import { SubCommand, CommandRunner, Option } from "nest-commander";
import {
  IsolateService,
  type IsolationArguments,
} from "../../workbench/isolate.js";
import { ResultReporter } from "./result-reporter.js";

@SubCommand({
  name: "isolate",
  arguments: "[title]",
  description: "Check, create, or verify workspace isolation",
})
export class IsolateCommand extends CommandRunner {
  constructor(
    private readonly isolateService: IsolateService,
    private readonly reporter: ResultReporter,
  ) {
    super();
  }

  @Option({ flags: "--check", description: "Check workspace isolation" })
  parseCheck(): boolean {
    return true;
  }

  @Option({ flags: "--verify <title>", description: "Verify a worktree" })
  parseVerify(title: string): string {
    return title;
  }

  @Option({
    flags: "--change-dir <directory>",
    name: "changeDir",
    description: "Check isolation for a change directory",
  })
  parseChangeDir(directory: string): string {
    return directory;
  }

  async run(
    passedParams: string[],
    options?: Record<string, unknown>,
  ): Promise<void> {
    const check = options?.check === true;
    const verifyTitle =
      typeof options?.verify === "string" ? options.verify : undefined;
    const changeDir =
      typeof options?.changeDir === "string" ? options.changeDir : undefined;
    const title = passedParams[0];

    if (check && (verifyTitle !== undefined || title !== undefined)) {
      this.reportUsageError(
        "--check cannot be combined with --verify or a title",
      );
      return;
    }
    if (
      verifyTitle !== undefined &&
      (title !== undefined || changeDir !== undefined)
    ) {
      this.reportUsageError(
        "--verify cannot be combined with --change-dir or a title",
      );
      return;
    }
    if (check) {
      await this.execute({
        mode: "check",
        ...(changeDir === undefined ? {} : { changeDir }),
      });
      return;
    }
    if (verifyTitle !== undefined) {
      await this.execute({ mode: "verify", title: verifyTitle });
      return;
    }
    if (title === undefined) {
      this.reportUsageError("isolate create mode requires a title");
      return;
    }
    if (changeDir !== undefined) {
      this.reportUsageError("--change-dir requires --check");
      return;
    }
    await this.execute({ mode: "create", title });
  }

  private async execute(args: IsolationArguments): Promise<void> {
    const result = await this.isolateService.execute(args);
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
