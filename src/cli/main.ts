#!/usr/bin/env bun
import "reflect-metadata";
import { VERSION } from "../index.js";

await import("@nestjs/common");
const { CommandFactory } = await import("nest-commander");
const { AppModule } = await import("./app.module.js");

const isCommanderError = (
  error: Error,
): error is Error & { code: string; exitCode: number } =>
  "code" in error &&
  typeof error.code === "string" &&
  error.code.startsWith("commander.") &&
  "exitCode" in error &&
  typeof error.exitCode === "number";

await CommandFactory.run(AppModule, {
  cliName: "hamilton",
  version: VERSION,
  errorHandler: (error) => {
    throw error;
  },
  serviceErrorHandler: (error) => {
    if (isCommanderError(error)) {
      process.exitCode = error.exitCode === 0 ? 0 : 2;
      return;
    }

    process.stderr.write(
      `error: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 2;
  },
});
