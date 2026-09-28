import { CommandRunner, Option, SubCommand } from "nest-commander";
import {
  PrototypeService,
  type PrototypeArguments,
} from "../../workbench/prototype.js";
import { ResultReporter } from "./result-reporter.js";

@SubCommand({
  name: "prototype",
  arguments: "[map-name] [ticket-name]",
  description: "Create, resume, or verify prototype branches",
})
export class PrototypeCommand extends CommandRunner {
  constructor(
    private readonly prototypeService: PrototypeService,
    private readonly reporter: ResultReporter,
  ) {
    super();
  }

  @Option({
    flags: "--standalone <name>",
    name: "standalone",
    description: "Create or resume a standalone prototype branch",
  })
  parseStandalone(name: string): string {
    return name;
  }

  @Option({
    flags: "--verify <branch>",
    name: "verify",
    description: "Verify the current branch",
  })
  parseVerify(branch: string): string {
    return branch;
  }

  async run(
    passedParams: string[],
    options?: Record<string, unknown>,
  ): Promise<void> {
    const standalone =
      typeof options?.standalone === "string" ? options.standalone : undefined;
    const verify =
      typeof options?.verify === "string" ? options.verify : undefined;
    const mapName = passedParams[0];
    const ticketName = passedParams[1];
    const positionalCount =
      (mapName === undefined ? 0 : 1) + (ticketName === undefined ? 0 : 1);

    if (standalone !== undefined && (verify !== undefined || positionalCount > 0)) {
      this.reportUsageError(
        "--standalone cannot be combined with --verify or mapped arguments",
      );
      return;
    }
    if (verify !== undefined && positionalCount > 0) {
      this.reportUsageError("--verify cannot be combined with mapped arguments");
      return;
    }
    if (standalone !== undefined) {
      await this.execute({ mode: "standalone", slug: standalone });
      return;
    }
    if (verify !== undefined) {
      await this.execute({ mode: "verify", expectedBranch: verify });
      return;
    }
    if (mapName === undefined || ticketName === undefined) {
      this.reportUsageError(
        "prototype mapped mode requires <map-name> <ticket-name>",
      );
      return;
    }
    await this.execute({ mode: "mapped", mapName, ticketName });
  }

  private async execute(args: PrototypeArguments): Promise<void> {
    const result = await this.prototypeService.execute(args);
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
