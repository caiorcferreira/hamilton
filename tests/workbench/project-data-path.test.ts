import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import { resolveProjectDataPath } from "../../packages/cli/src/workbench/project-data-path.js";

const projects: string[] = [];

const makeProject = (): string => {
  const project = Fs.mkdtempSync(
    Path.join(Os.tmpdir(), "kepler-project-data-path-"),
  );
  projects.push(project);
  return project;
};

const write = (file: string, content: string): void => {
  Fs.mkdirSync(Path.dirname(file), { recursive: true });
  Fs.writeFileSync(file, content);
};

afterEach(() => {
  for (const project of projects.splice(0))
    Fs.rmSync(project, { recursive: true, force: true });
});

describe("project data path resolution", () => {
  it("copies old-only project data to .kepler and leaves .hamilton intact", () => {
    const project = makeProject();
    const legacyFile = Path.join(
      project,
      ".hamilton",
      "changes",
      "demo",
      "plan.md",
    );
    write(legacyFile, "legacy plan\n");

    const canonicalFile = resolveProjectDataPath(legacyFile, project);

    expect(canonicalFile).toBe(
      Path.join(project, ".kepler", "changes", "demo", "plan.md"),
    );
    expect(Fs.readFileSync(canonicalFile, "utf8")).toBe("legacy plan\n");
    expect(Fs.readFileSync(legacyFile, "utf8")).toBe("legacy plan\n");
  });

  it("uses canonical project data when only .kepler exists", () => {
    const project = makeProject();
    const canonicalFile = Path.join(
      project,
      ".kepler",
      "changes",
      "demo",
      "plan.md",
    );
    write(canonicalFile, "canonical plan\n");

    expect(resolveProjectDataPath(canonicalFile, project)).toBe(canonicalFile);
    expect(Fs.readFileSync(canonicalFile, "utf8")).toBe("canonical plan\n");
    expect(Fs.existsSync(Path.join(project, ".hamilton"))).toBe(false);
  });

  it("prefers existing .kepler data without overwriting or merging .hamilton", () => {
    const project = makeProject();
    const legacyFile = Path.join(
      project,
      ".hamilton",
      "changes",
      "demo",
      "plan.md",
    );
    const legacyOnlyFile = Path.join(
      project,
      ".hamilton",
      "changes",
      "demo",
      "legacy-only.md",
    );
    const canonicalFile = Path.join(
      project,
      ".kepler",
      "changes",
      "demo",
      "plan.md",
    );
    write(legacyFile, "legacy plan\n");
    write(legacyOnlyFile, "legacy-only data\n");
    write(canonicalFile, "canonical plan\n");

    expect(resolveProjectDataPath(legacyFile, project)).toBe(canonicalFile);
    expect(Fs.readFileSync(canonicalFile, "utf8")).toBe("canonical plan\n");
    expect(Fs.readFileSync(legacyFile, "utf8")).toBe("legacy plan\n");
    expect(Fs.readFileSync(legacyOnlyFile, "utf8")).toBe("legacy-only data\n");
    expect(
      Fs.existsSync(
        Path.join(project, ".kepler", "changes", "demo", "legacy-only.md"),
      ),
    ).toBe(false);
  });
});
