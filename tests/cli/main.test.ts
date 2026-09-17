import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as Path from "node:path";
import { VERSION } from "../../src/index.js";

const entrypoint = Path.resolve("src/cli/main.ts");

describe("main CLI", () => {
  it("prints the canonical project version", () => {
    const result = spawnSync(
      process.execPath,
      ["run", entrypoint, "--version"],
      { encoding: "utf8" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
  });
});
