import { Inject, Injectable } from "@nestjs/common";

export type CliExitCode = 0 | 1 | 2;

export interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: CliExitCode;
}

export interface ResultOutputSink {
  readonly stdout: (value: string) => void;
  readonly stderr: (value: string) => void;
}

export interface ResultExitSink {
  readonly setExitCode: (value: CliExitCode) => void;
}

export const RESULT_OUTPUT_SINK = Symbol("RESULT_OUTPUT_SINK");
export const RESULT_EXIT_SINK = Symbol("RESULT_EXIT_SINK");

@Injectable()
export class ResultReporter {
  constructor(
    @Inject(RESULT_OUTPUT_SINK) private readonly output: ResultOutputSink,
    @Inject(RESULT_EXIT_SINK) private readonly exit: ResultExitSink,
  ) {}

  report(result: CliResult): void {
    this.exit.setExitCode(result.exitCode);
    this.output.stdout(result.stdout);
    this.output.stderr(result.stderr);
  }
}
