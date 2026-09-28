import { Command, CommandRunner, Option } from "nest-commander";
import { SetupService, type SetupResult } from "../setup.service.js";
import { ResultReporter } from "./result-reporter.js";

@Command({
  name: "setup",
  description: "Bootstrap Hamilton directories and install templates",
})
export class SetupCommand extends CommandRunner {
  constructor(
    private readonly setupService: SetupService,
    private readonly reporter: ResultReporter,
  ) {
    super();
  }

  @Option({ flags: "--force", description: "Force setup" })
  parseForce(): boolean {
    return true;
  }

  async run(
    _passedParams: string[],
    _options?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const result = this.setupService.setup();
      this.reporter.report({
        stdout: this.formatSuccess(result),
        stderr: "",
        exitCode: 0,
      });
    } catch (error) {
      this.reporter.report({
        stdout: "",
        stderr: `Setup failed: ${this.errorMessage(error)}\n`,
        exitCode: 2,
      });
    }
  }

  private formatSuccess(result: SetupResult): string {
    const lines = [
      "Hamilton set up successfully.",
      `Installed ${result.templates.length} templates.`,
      ...result.templates.map((name) => `  ${name}`),
      "Installed guidelines.",
    ];
    return `${lines.join("\n")}\n`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
