import { describe, expect, it } from "vitest";
import {
  artifactMetadataSchemas,
  requiredFields,
  supportedArtifacts,
  validateArtifactMetadataSchema,
} from "../../src/workbench/artifact-contracts.js";
import type { RecognizedArtifact } from "../../src/workbench/artifact-reader.js";

const recognized = (metadata: Record<string, unknown>): RecognizedArtifact => ({
  _tag: "recognized",
  sourcePath: ".hamilton/changes/demo/progress.md",
  metadata,
  body: "",
  locations: {
    frontmatter: { startLine: 1, endLine: 6 },
    metadata: { startLine: 2, endLine: 5 },
    body: { startLine: 7, endLine: 7 },
  },
});

describe("artifact metadata schemas", () => {
  it.each(supportedArtifacts)("defines a schema for %s", (artifact) => {
    const schema = artifactMetadataSchemas[artifact];

    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(expect.arrayContaining(requiredFields[artifact]));
  });

  it("maps nested task schema errors to stable diagnostic paths", () => {
    const diagnostics = validateArtifactMetadataSchema(
      recognized({
        artifact: "progress",
        change: "demo",
        status: "in-progress",
        updated: "2026-09-16",
        decision: "accepted",
        tasks: [{ id: "one", status: "unknown" }],
      }),
      "progress",
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-type",
          field: "tasks[0].id",
          location: { line: 2 },
        }),
        expect.objectContaining({
          code: "missing-field",
          field: "tasks[0].title",
        }),
        expect.objectContaining({
          code: "invalid-value",
          field: "tasks[0].status",
        }),
        expect.objectContaining({
          code: "missing-field",
          field: "tasks[0].progress",
        }),
      ]),
    );
  });

  it("preserves scalar diagnostic categories for malformed values", () => {
    const diagnostics = validateArtifactMetadataSchema(
      recognized({
        artifact: "proposal",
        change: "demo",
        status: "draft",
        decision: "accepted",
        author: "test",
        created: "yesterday",
        route_unit: 42,
      }),
      "proposal",
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-value",
          field: "created",
          expected: "YYYY-MM-DD",
        }),
        expect.objectContaining({
          code: "invalid-value",
          field: "route_unit",
          expected: "route reference or null",
        }),
      ]),
    );
  });

  it("does not require review ranges or verdicts in global frontmatter", () => {
    expect(requiredFields.feedback).not.toEqual(
      expect.arrayContaining(["verdict", "base", "head"]),
    );
    expect(requiredFields.review).not.toEqual(
      expect.arrayContaining(["verdict", "base", "head"]),
    );

    const diagnostics = validateArtifactMetadataSchema(
      recognized({
        artifact: "review",
        change: "demo",
        created: "2026-09-12",
        status: "complete",
        decision: "accepted",
      }),
      "review",
    );

    expect(diagnostics).toEqual([]);
  });

  it("validates optional legacy review provenance when present", () => {
    const diagnostics = validateArtifactMetadataSchema(
      recognized({
        artifact: "review",
        base: "short",
        head: "ABC",
        verdict: "maybe",
      }),
      "review",
    );

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "invalid-value", field: "base" }),
        expect.objectContaining({ code: "invalid-value", field: "head" }),
        expect.objectContaining({ code: "invalid-value", field: "verdict" }),
      ]),
    );
  });
});
