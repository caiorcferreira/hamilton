import "reflect-metadata";
import { Inject, Module, type INestApplicationContext } from "@nestjs/common";
import { Command, CommandFactory, CommandRunner } from "nest-commander";
import { describe, expect, it } from "vitest";

const STORAGE_PORT = Symbol("storage-port");
const executions: Array<{ arguments: string[]; value: string }> = [];

interface StoragePort {
  read(): string;
}

@Command({ name: "metadata-probe" })
class MetadataProbeCommand extends CommandRunner {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {
    super();
  }

  async run(arguments_: string[]): Promise<void> {
    executions.push({ arguments: arguments_, value: this.storage.read() });
  }
}

@Module({
  providers: [
    MetadataProbeCommand,
    { provide: STORAGE_PORT, useValue: { read: () => "resolved" } },
  ],
})
class MetadataProbeModule {}

describe("Nest metadata", () => {
  it(
    "discovers and executes a command with an explicit token in a Nest application context",
    async () => {
      const originalArgv = process.argv;
      let application: INestApplicationContext | undefined;
      executions.length = 0;

      try {
        process.argv = [...originalArgv.slice(0, 2), "metadata-probe", "argument"];
        application = await CommandFactory.runWithoutClosing(MetadataProbeModule, {
          serviceErrorHandler: (error) => {
            throw error;
          },
        });

        expect(
          Reflect.getMetadata("design:paramtypes", MetadataProbeCommand),
        ).toEqual([Object]);
        expect(executions).toEqual([{ arguments: ["argument"], value: "resolved" }]);
      } finally {
        process.argv = originalArgv;
        await application?.close();
      }
    },
  );
});
