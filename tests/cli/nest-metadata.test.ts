import "reflect-metadata";
import { Inject, Injectable } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { CommandFactory } from "nest-commander";
import { describe, expect, it } from "vitest";

const STORAGE_PORT = Symbol("storage-port");

interface StoragePort {
  read(): string;
}

@Injectable()
class StorageConsumer {
  constructor(@Inject(STORAGE_PORT) readonly storage: StoragePort) {}
}

describe("Nest metadata", () => {
  it("loads Nest commands and resolves a decorated provider through an explicit token", async () => {
    const storage = { read: () => "value" };
    const module = await Test.createTestingModule({
      providers: [
        StorageConsumer,
        { provide: STORAGE_PORT, useValue: storage },
      ],
    }).compile();

    expect(CommandFactory).toBeDefined();
    expect(Reflect.getMetadata("design:paramtypes", StorageConsumer)).toEqual([Object]);
    expect(module.get(StorageConsumer).storage).toBe(storage);

    await module.close();
  });
});
