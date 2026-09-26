import { Command, CommandRunner } from "nest-commander";
import { ResultReporter } from "./result-reporter.js";
import { DiffCommand } from "./diff.command.js";
import { IsolateCommand } from "./isolate.command.js";
import { PreconditionCommand } from "./precondition.command.js";

@Command({
  name: "workbench",
  description: "Hamilton workflow mechanics and artifact validation",
  subCommands: [IsolateCommand, DiffCommand, PreconditionCommand],
})
export class WorkbenchCommand extends CommandRunner {
  constructor(private readonly reporter: ResultReporter) {
    super();
  }

  async run(): Promise<void> {
    this.reporter.report({
      stdout: "",
      stderr: "error: workbench requires a subcommand\n",
      exitCode: 2,
    });
  }
}
