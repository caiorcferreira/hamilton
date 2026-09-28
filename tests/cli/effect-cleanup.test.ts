import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { readConfigFile } from "typescript";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const testPath = "tests/cli/effect-cleanup.test.ts";
const activeDirectories = ["src", "tests", "scripts"];
const activeConfigurationFiles = ["vitest.config.ts"];
const activeExtensions = new Set([".cjs", ".js", ".json", ".mjs", ".sh", ".ts", ".tsx"]);
const forbiddenImport = /@effect\/[\w-]+|(?:from\s*|import\s*\(|require\s*\()\s*["']effect(?:\/[^"']*)?["']/i;

const activeFiles = (directory: string): string[] => {
  if (!existsSync(directory)) return [];

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return activeFiles(path);
    if (!entry.isFile() || !activeExtensions.has(extname(entry.name))) return [];

    const projectPath = relative(root, path).split("\\").join("/");
    return projectPath === testPath ? [] : [path];
  });
};

describe("Effect tooling cleanup", () => {
  it("removes Effect imports and test adapters from active source and tests", () => {
    const references = [
      ...activeDirectories.flatMap((directory) => activeFiles(resolve(root, directory))),
      ...activeConfigurationFiles.map((path) => resolve(root, path)).filter(existsSync),
    ].flatMap((path) => {
        const content = readFileSync(path, "utf8");
        return forbiddenImport.test(content) ? [relative(root, path)] : [];
      });

    expect(references).toEqual([]);
  });

  it("removes Effect packages and the prepare hook from the package manifest", () => {
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    };
    const scripts = manifest.scripts as Record<string, string>;

    expect(Object.keys(dependencies).filter((name) => name === "effect" || name.startsWith("@effect/"))).toEqual([]);
    expect(scripts).not.toHaveProperty("prepare");
    expect(Object.entries(scripts).filter(([name, command]) => /effect/i.test(name) || /effect/i.test(command))).toEqual([]);
    expect(manifest.version).toBe("0.9.0");
  });

  it("removes Effect TypeScript schema and plugin while retaining Nest metadata", () => {
    const config = readConfigFile(resolve(root, "tsconfig.json"), (path) => readFileSync(path, "utf8")).config;

    expect(config).not.toHaveProperty("$schema");
    expect(config.compilerOptions).not.toHaveProperty("plugins");
    expect(config.compilerOptions.experimentalDecorators).toBe(true);
    expect(config.compilerOptions.emitDecoratorMetadata).toBe(true);
  });

  it("removes transitive Effect packages from the Bun lockfile", () => {
    const lockfile = readFileSync(resolve(root, "bun.lock"), "utf8");
    const packageNames = Array.from(lockfile.matchAll(/^\s*"([^"]+)":\s*\[/gm), ([, name]) => name);

    expect(packageNames.filter((name) => name === "effect" || name.startsWith("@effect/"))).toEqual([]);
  });

  it("keeps the package and CLI versions synchronized", () => {
    const source = readFileSync(resolve(root, "src/index.ts"), "utf8");
    const version = source.match(/^export const VERSION = "([^"]+)"$/m)?.[1];
    const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

    expect(version).toBe("0.9.0");
    expect(manifest.version).toBe(version);
  });
});
