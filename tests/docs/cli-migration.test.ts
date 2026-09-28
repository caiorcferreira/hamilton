import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const guidance = readFileSync(resolve(root, "AGENTS.md"), "utf8");
const readme = readFileSync(resolve(root, "README.md"), "utf8");

describe("CLI migration guidance", () => {
  it("documents the current Nest, Bun, runtime-port, and Vitest conventions", () => {
    expect(guidance).toMatch(/nest-commander/);
    expect(guidance).toMatch(/CommandRunner/);
    expect(guidance).toMatch(/@Injectable/);
    expect(guidance).toMatch(/runtime ports?/i);
    expect(guidance).toMatch(
      /(?:standalone )?Bun (?:standalone )?(?:executable|binary)s?/i,
    );
    expect(guidance).toMatch(/Vitest/);
    expect(guidance).toMatch(/bun --bun vitest run/);
    expect(guidance).toMatch(/No comments in code/i);
    expect(guidance).toMatch(/\.js`? extensions?/);
    expect(guidance).not.toMatch(
      /\bEffect(?:-TS)?\b|@effect\/|Command\.make|Data\.TaggedError|Options\.(?:choice|optional)|Exit\.is(?:Success|Failure)/,
    );
  });

  it("documents the retired flags and setup failure exit status", () => {
    expect(readme).toMatch(
      /Effect-generated[^.]*--completions[^.]*--log-level[^.]*--wizard[^.]*(?:removed|retired|no longer accepted)/is,
    );
    expect(readme).toMatch(/setup failure[^.\n]*exit(?:s)?[^.\n]*2/i);
    expect(readme).toMatch(/absent from help/i);
    expect(readme).toMatch(/rejected as usage errors with exit code `2`/i);
    expect(readme).toMatch(/NestJS/);
    expect(readme).toMatch(
      /(?:standalone )?Bun (?:standalone )?(?:executable|binary)s?/i,
    );
  });
});
