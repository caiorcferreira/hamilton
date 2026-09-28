import { CommandRunner, Option, SubCommand } from "nest-commander";
import {
  LintService,
  renderLintResult,
  type LintScope,
} from "../../workbench/lint.js";
import { ResultReporter } from "./result-reporter.js";

@SubCommand({
  name: "lint",
  description: "Validate one file or an explicit change directory",
})
export class LintCommand extends CommandRunner {
  constructor(
    private readonly lintService: LintService,
    private readonly reporter: ResultReporter,
  ) {
    super();
  }

  @Option({
    flags: "--file <file>",
    name: "file",
    description: "Validate one file",
  })
  parseFile(file: string): string {
    return file;
  }

  @Option({
    flags: "--change-dir <dir>",
    name: "changeDir",
    description: "Validate an explicit change directory",
  })
  parseChangeDir(changeDir: string): string {
    return changeDir;
  }

  async run(
    _passedParams: string[],
    options?: Record<string, unknown>,
  ): Promise<void> {
    const file = typeof options?.file === "string" ? options.file : undefined;
    const changeDir =
      typeof options?.changeDir === "string" ? options.changeDir : undefined;

    if ((file === undefined) === (changeDir === undefined)) {
      this.reportUsageError(
        "lint requires exactly one of --file or --change-dir",
      );
      return;
    }

    const scope: LintScope =
      file === undefined ? { changeDir: changeDir as string } : { file };
    const result = await this.lintService.execute(scope);
    this.reporter.report({
      stdout: `${renderLintResult(result)}\n`,
      stderr: "",
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
