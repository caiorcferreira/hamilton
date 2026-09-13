import { describe, expect, it } from "vitest";
import {
  validateArtifact,
  type ArtifactContractResult,
} from "../../src/workbench/artifact-contracts.js";
import type {
  ArtifactReadResult,
  RecognizedArtifact,
} from "../../src/workbench/artifact-reader.js";

const sha = "0123456789abcdef0123456789abcdef01234567";

const recognized = (
  sourcePath: string,
  metadata: Record<string, unknown>,
): RecognizedArtifact => ({
  _tag: "recognized",
  sourcePath,
  metadata,
  body: "",
  locations: {
    frontmatter: { startLine: 1, endLine: 2 },
    metadata: { startLine: 2, endLine: 2 },
    body: { startLine: 3, endLine: 3 },
  },
});

const validArtifacts: Array<[string, Record<string, unknown>]> = [
  [".hamilton/changes/demo/proposal.md", {
    artifact: "proposal",
    change: "demo",
    status: "approved",
    decision: "accepted",
    author: "caio",
    created: "2026-09-12",
    route_unit: null,
  }],
  [".hamilton/changes/demo/design.md", {
    artifact: "design",
    change: "demo",
    status: "draft",
    created: "2026-09-12",
    author: "caio",
    decision: "accepted",
    route_unit: null,
  }],
  [".hamilton/changes/demo/requirements/workbench.md", {
    artifact: "requirements-change",
    capability: "workbench",
    change: "demo",
    status: "draft",
    created: "2026-09-12",
    author: "caio",
    decision: "accepted",
  }],
  [".hamilton/specs/workbench.md", {
    artifact: "requirements-spec",
    capability: "workbench",
    status: "current",
    updated: "2026-09-12",
    author: "caio",
    decision: "accepted",
  }],
  [".hamilton/changes/demo/plan.md", {
    artifact: "plan",
    change: "demo",
    status: "approved",
    created: "2026-09-12",
    author: "caio",
    decision: "accepted",
    route_unit: null,
  }],
  [".hamilton/changes/demo/progress.md", {
    artifact: "progress",
    change: "demo",
    status: "in-progress",
    updated: "2026-09-12",
    decision: "accepted",
    tasks: [{ id: 1, title: "Lint", status: "done", progress: "tasks/task-1/progress.md" }],
  }],
  [".hamilton/changes/demo/tasks/task-2/progress.md", {
    artifact: "task-progress",
    change: "demo",
    task: 2,
    status: "done",
    updated: "2026-09-12",
    decision: "accepted",
  }],
  [".hamilton/changes/demo/tasks/task-2/feedback.md", {
    artifact: "feedback",
    change: "demo",
    task: 2,
    created: "2026-09-12",
    status: "resolved",
    verdict: "approved",
    decision: "accepted",
    base: sha,
    head: sha,
  }],
  [".hamilton/changes/demo/review.md", {
    artifact: "review",
    change: "demo",
    created: "2026-09-12",
    status: "complete",
    verdict: "approved",
    decision: "accepted",
    base: sha,
    head: sha,
  }],
  [".hamilton/changes/demo/finish.md", {
    artifact: "finish",
    change: "demo",
    status: "completed",
    created: "2026-09-12",
    updated: "2026-09-12",
    strategy: "no-op",
    result: "completed",
    decision: "accepted",
  }],
  [".hamilton/changes/demo/critique.md", {
    artifact: "critique",
    change: "demo",
    created: "2026-09-12",
    verdict: "approved",
    decision: "accepted",
    scope: "design.md",
  }],
  [".hamilton/maps/effort/map.md", {
    artifact: "map",
    effort: "effort",
    status: "open",
    branch: "main",
    created: "2026-09-12",
    updated: "2026-09-12",
    decision: "accepted",
  }],
  [".hamilton/maps/effort/tickets/01-research.md", {
    artifact: "ticket",
    effort: "effort",
    ticket: 1,
    type: "research",
    status: "open",
    blocked_by: [],
    created: "2026-09-12",
    updated: "2026-09-12",
    decision: "accepted",
  }],
  [".hamilton/maps/effort/route.md", {
    artifact: "route",
    effort: "effort",
    status: "open",
    created: "2026-09-12",
    updated: "2026-09-12",
    decision: "accepted",
    units: [{ id: 1, name: "Research", status: "pending", depends_on: [], backed_by: ["tickets/01-research.md"] }],
  }],
];

const expectInvalid = (result: ArtifactContractResult, code: string) => {
  expect(result._tag).toBe("invalid");
  if (result._tag === "invalid") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(code);
  }
};

describe("artifact metadata contracts", () => {
  it.each(validArtifacts)("accepts %s", (sourcePath, metadata) => {
    expect(validateArtifact(recognized(sourcePath, metadata))).toEqual({
      _tag: "valid",
      artifact: metadata.artifact,
      sourcePath,
      metadata,
      diagnostics: [],
    });
  });

  it("requires every declared metadata field", () => {
    const metadata = { ...validArtifacts[0][1] };
    delete metadata.author;
    expectInvalid(
      validateArtifact(recognized(validArtifacts[0][0], metadata)),
      "missing-field",
    );
  });

  it("rejects invalid enumerated metadata", () => {
    const metadata = { ...validArtifacts[0][1], status: "unknown" };
    expectInvalid(
      validateArtifact(recognized(validArtifacts[0][0], metadata)),
      "invalid-value",
    );
  });

  it("rejects unsupported artifact values", () => {
    expectInvalid(
      validateArtifact(
        recognized(".hamilton/changes/demo/unknown.md", {
          artifact: "unknown",
        }),
      ),
      "unsupported-artifact",
    );
  });

  it.each([
    [".hamilton/changes/other/proposal.md", validArtifacts[0][1]],
    [".hamilton/changes/demo/requirements/other.md", validArtifacts[2][1]],
    [".hamilton/changes/demo/tasks/task-3/progress.md", validArtifacts[6][1]],
    [".hamilton/maps/other/map.md", validArtifacts[11][1]],
    [".hamilton/maps/effort/tickets/02-research.md", validArtifacts[12][1]],
  ])("rejects path identity conflicts for %s", (sourcePath, metadata) => {
    expectInvalid(validateArtifact(recognized(sourcePath, metadata)), "path-mismatch");
  });

  it("preserves unrelated files as skipped and reader failures as invalid", () => {
    const unrelated: ArtifactReadResult = {
      _tag: "unrelated",
      sourcePath: "notes.md",
      reason: "no-frontmatter",
      body: "notes",
      locations: { body: { startLine: 1, endLine: 1 } },
    };
    const invalid: ArtifactReadResult = {
      _tag: "invalid",
      sourcePath: "broken.md",
      diagnostic: {
        _tag: "ArtifactDiagnostic",
        code: "invalid-yaml",
        message: "broken",
        sourcePath: "broken.md",
      },
    };
    expect(validateArtifact(unrelated)).toEqual({ _tag: "skipped", sourcePath: "notes.md" });
    expect(validateArtifact(invalid)).toEqual({
      _tag: "invalid",
      sourcePath: "broken.md",
      diagnostics: [invalid.diagnostic],
    });
  });
});
