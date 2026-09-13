import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";
import {
  lintScope,
  renderLintResult,
  type LintResult,
} from "../../src/workbench/lint.js";

const temporaryDirectories: string[] = [];

const temporaryDirectory = async () => {
  const directory = await Fs.mkdtemp(Path.join(Os.tmpdir(), "hamilton-lint-"));
  temporaryDirectories.push(directory);
  return directory;
};

const proposal = (body = "# Proposal: Demo\n## Why\n## Goals & Success Criteria\n## Non-Goals\n## Proposed Change\n## Capabilities\n## Impact\n") =>
  `---\nartifact: proposal\nchange: demo\nstatus: approved\ndecision: accepted\nauthor: caio\ncreated: 2026-09-12\nroute_unit: null\n---\n${body}`;

const expectExit = (result: LintResult, exitCode: 0 | 1 | 2) => {
  expect(result.exitCode).toBe(exitCode);
  expect(renderLintResult(result)).toContain(`lint: ${exitCode === 0 ? "success" : exitCode === 1 ? "findings" : "invalid scope"}`);
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => Fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("scoped artifact lint", () => {
  it("requires exactly one selector without inspecting a scope", async () => {
    const directory = await temporaryDirectory();
    const file = Path.join(directory, "plan.md");
    await Fs.writeFile(file, "# Plan: Demo\n");
    let reads = 0;
    const fileSystem = {
      stat: async (sourcePath: string) => {
        reads += 1;
        return Fs.stat(sourcePath);
      },
      lstat: async (sourcePath: string) => {
        reads += 1;
        return Fs.lstat(sourcePath);
      },
      readdir: async (sourcePath: string) => {
        reads += 1;
        return Fs.readdir(sourcePath, { withFileTypes: true });
      },
      realpath: Fs.realpath,
      readFile: Fs.readFile,
    };
    expectExit(await lintScope({}, { fileSystem }), 2);
    expectExit(await lintScope({ file, changeDir: directory }, { fileSystem }), 2);
    expect(reads).toBe(0);
  });

  it("rejects missing and non-regular file or directory scopes", async () => {
    const directory = await temporaryDirectory();
    const file = Path.join(directory, "artifact.md");
    await Fs.writeFile(file, "text");
    expectExit(await lintScope({ file: Path.join(directory, "missing.md") }), 2);
    expectExit(await lintScope({ file: directory }), 2);
    expectExit(await lintScope({ changeDir: Path.join(directory, "missing") }), 2);
    expectExit(await lintScope({ changeDir: file }), 2);
  });

  it("validates only the selected regular file", async () => {
    const directory = await temporaryDirectory();
    const file = Path.join(directory, ".hamilton", "changes", "demo", "proposal.md");
    const outside = Path.join(directory, "outside.md");
    await Fs.mkdir(Path.dirname(file), { recursive: true });
    await Fs.writeFile(file, proposal());
    await Fs.writeFile(outside, "# unrelated");
    const result = await lintScope({ file });
    expectExit(result, 0);
    expect(result.findings.map((finding) => finding.sourcePath)).toEqual([file]);
    expect(result.findings[0]?.kind).toBe("success");
  });

  it("recursively considers nested regular files and ignores outside symlinks", async () => {
    const directory = await temporaryDirectory();
    const changeDirectory = Path.join(directory, ".hamilton", "changes", "demo");
    const nested = Path.join(changeDirectory, "nested");
    const outside = Path.join(directory, "outside.md");
    await Fs.mkdir(nested, { recursive: true });
    await Fs.writeFile(Path.join(changeDirectory, "proposal.md"), proposal());
    await Fs.writeFile(Path.join(nested, "notes.md"), "# Notes\n");
    await Fs.writeFile(outside, "---\nartifact: proposal\n---\n# invalid\n");
    await Fs.symlink(outside, Path.join(changeDirectory, "outside.md"));
    const result = await lintScope({ changeDir: changeDirectory });
    expectExit(result, 0);
    expect(result.findings.map((finding) => finding.sourcePath)).toEqual([
      Path.join(changeDirectory, "nested", "notes.md"),
      Path.join(changeDirectory, "proposal.md"),
    ]);
  });

  it("warns for conventional artifact filenames without frontmatter and skips unrelated files", async () => {
    const directory = await temporaryDirectory();
    const plan = Path.join(directory, "plan.md");
    const notes = Path.join(directory, "notes.md");
    await Fs.writeFile(plan, "# Plan: Demo\n");
    await Fs.writeFile(notes, "# Notes\n");
    const result = await lintScope({ changeDir: directory });
    expectExit(result, 1);
    expect(result.findings).toEqual([
      expect.objectContaining({ kind: "skipped", sourcePath: notes, line: 1 }),
      expect.objectContaining({ kind: "warning", sourcePath: plan, line: 1 }),
    ]);
  });

  it("reports malformed recognized artifacts and all contract findings", async () => {
    const directory = await temporaryDirectory();
    const file = Path.join(directory, "proposal.md");
    await Fs.writeFile(file, proposal("# Proposal: Demo\n## Why\n"));
    const result = await lintScope({ file });
    expectExit(result, 1);
    expect(result.findings.filter((finding) => finding.kind === "error").length).toBeGreaterThan(1);
    expect(result.findings.every((finding) => finding.sourcePath === file && finding.line > 0)).toBe(true);
    expect(renderLintResult(result)).toContain(`${file}:`);
    expect(renderLintResult(result)).toContain("missing-section");
  });

  it("reports malformed frontmatter with its source location", async () => {
    const directory = await temporaryDirectory();
    const file = Path.join(directory, "proposal.md");
    await Fs.writeFile(file, "---\nartifact: [broken\n---\n# Proposal: Demo\n");
    const result = await lintScope({ file });
    expectExit(result, 1);
    expect(result.findings).toEqual([
      expect.objectContaining({
        kind: "error",
        code: "invalid-yaml",
        sourcePath: file,
        line: 3,
      }),
    ]);
  });

  it("renders deterministic path and location ordering", async () => {
    const directory = await temporaryDirectory();
    const first = Path.join(directory, "a", "proposal.md");
    const second = Path.join(directory, "b", "proposal.md");
    await Fs.mkdir(Path.dirname(first), { recursive: true });
    await Fs.mkdir(Path.dirname(second), { recursive: true });
    await Fs.writeFile(first, proposal("# Proposal: Demo\n"));
    await Fs.writeFile(second, proposal("# Proposal: Demo\n"));
    const result = await lintScope({ changeDir: directory });
    expectExit(result, 1);
    const paths = result.findings.filter((finding) => finding.kind === "error").map((finding) => finding.sourcePath);
    expect(paths).toEqual([...paths].sort());
    expect(renderLintResult(result).indexOf(first)).toBeLessThan(renderLintResult(result).indexOf(second));
  });

  it("maps success, findings, and invalid scope to 0, 1, and 2", async () => {
    const directory = await temporaryDirectory();
    const file = Path.join(directory, "notes.md");
    await Fs.writeFile(file, "notes\n");
    expect((await lintScope({ file })).exitCode).toBe(0);
    await Fs.writeFile(file, proposal("# Proposal: Demo\n"));
    expect((await lintScope({ file })).exitCode).toBe(1);
    expect((await lintScope({ file: directory })).exitCode).toBe(2);
  });
});
