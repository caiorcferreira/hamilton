import { describe, expect, it } from "vitest";
import {
  validateArtifact,
  validateArtifactBody,
  type ArtifactContractResult,
} from "../../src/workbench/artifact-contracts.js";
import type {
  ArtifactReadResult,
  RecognizedArtifact,
} from "../../src/workbench/artifact-reader.js";

const sha = "0123456789abcdef0123456789abcdef01234567";

const bodyFor = (artifact: string): string => {
  const sections: Record<string, string[]> = {
    proposal: [
      "Why",
      "Goals & Success Criteria",
      "Non-Goals",
      "Proposed Change",
      "Capabilities",
      "Impact",
    ],
    design: [
      "Context",
      "Goals / Non-Goals",
      "Decisions",
      "Architecture & Components",
      "Testing Strategy",
      "Constraints & Boundaries",
      "Risks / Trade-offs",
    ],
    "requirements-change": ["ADDED Requirements"],
    "requirements-spec": [
      "Overview",
      "Contract",
      "Behavior",
      "Invariants",
      "Decisions",
    ],
    plan: ["Overview", "Tasks", "Done when", "### Task 1: Validate"],
    progress: [],
    "task-progress": [],
    feedback: ["Pass 1 — 2026-09-12", "### Blocking", "### Suggestions"],
    review: ["Pass 1 — 2026-09-12", "### Blocking", "### Suggestions"],
    finish: ["Attempt 1 — 2026-09-12"],
    critique: ["Scope", "Findings", "Quality Lens", "Summary"],
    map: [
      "Destination",
      "Notes",
      "Operation rules",
      "Decisions so far",
      "Not yet specified",
      "Out of scope",
    ],
    ticket: ["Question", "Answer", "Outdated decisions"],
    route: ["Shipping rules", "Units", "### 1. Research"],
  };
  const titles: Record<string, string> = {
    proposal: "Proposal: Demo",
    design: "Design: Demo",
    "requirements-change": "Capability: workbench",
    "requirements-spec": "Capability: workbench",
    plan: "Plan: Demo",
    progress: "Progress: Demo",
    "task-progress": "Task Progress: Task 2 — Validate",
    feedback: "Code Feedback: Task 2 — Validate",
    review: "Whole-branch Review: Demo",
    finish: "Finish History: Demo",
    critique: "Critique: Demo",
    map: "Effort",
    ticket: "Ticket",
    route: "Route — Effort",
  };
  const title = titles[artifact];
  return [
    `# ${title}`,
    ...(sections[artifact] ?? []).map(
      (section) => `${section.startsWith("###") ? section : `## ${section}`}`,
    ),
    artifact === "plan" ? "- Depends on: none" : "",
  ].join("\n");
};

const recognized = (
  sourcePath: string,
  metadata: Record<string, unknown>,
  body = bodyFor(String(metadata.artifact)),
): RecognizedArtifact => ({
  _tag: "recognized",
  sourcePath,
  metadata,
  body,
  locations: {
    frontmatter: { startLine: 1, endLine: 2 },
    metadata: { startLine: 2, endLine: 2 },
    body: { startLine: 3, endLine: 3 },
  },
});

const validArtifacts: Array<[string, Record<string, unknown>]> = [
  [
    ".hamilton/changes/demo/proposal.md",
    {
      artifact: "proposal",
      change: "demo",
      status: "approved",
      decision: "accepted",
      author: "caio",
      created: "2026-09-12",
      route_unit: null,
    },
  ],
  [
    ".hamilton/changes/demo/design.md",
    {
      artifact: "design",
      change: "demo",
      status: "draft",
      created: "2026-09-12",
      author: "caio",
      decision: "accepted",
      route_unit: null,
    },
  ],
  [
    ".hamilton/changes/demo/requirements/workbench.md",
    {
      artifact: "requirements-change",
      capability: "workbench",
      change: "demo",
      status: "draft",
      created: "2026-09-12",
      author: "caio",
      decision: "accepted",
    },
  ],
  [
    ".hamilton/specs/workbench.md",
    {
      artifact: "requirements-spec",
      capability: "workbench",
      status: "current",
      updated: "2026-09-12",
      author: "caio",
      decision: "accepted",
    },
  ],
  [
    ".hamilton/changes/demo/plan.md",
    {
      artifact: "plan",
      change: "demo",
      status: "approved",
      created: "2026-09-12",
      author: "caio",
      decision: "accepted",
      route_unit: null,
    },
  ],
  [
    ".hamilton/changes/demo/progress.md",
    {
      artifact: "progress",
      change: "demo",
      status: "in-progress",
      updated: "2026-09-12",
      decision: "accepted",
      tasks: [
        {
          id: 1,
          title: "Lint",
          status: "done",
          progress: "tasks/task-1/progress.md",
        },
      ],
    },
  ],
  [
    ".hamilton/changes/demo/tasks/task-2/progress.md",
    {
      artifact: "task-progress",
      change: "demo",
      task: 2,
      status: "done",
      updated: "2026-09-12",
      decision: "accepted",
    },
  ],
  [
    ".hamilton/changes/demo/tasks/task-2/feedback.md",
    {
      artifact: "feedback",
      change: "demo",
      task: 2,
      created: "2026-09-12",
      status: "resolved",
      verdict: "approved",
      decision: "accepted",
      base: sha,
      head: sha,
    },
  ],
  [
    ".hamilton/changes/demo/review.md",
    {
      artifact: "review",
      change: "demo",
      created: "2026-09-12",
      status: "complete",
      verdict: "approved",
      decision: "accepted",
      base: sha,
      head: sha,
    },
  ],
  [
    ".hamilton/changes/demo/finish.md",
    {
      artifact: "finish",
      change: "demo",
      status: "completed",
      created: "2026-09-12",
      updated: "2026-09-12",
      strategy: "no-op",
      result: "completed",
      decision: "accepted",
    },
  ],
  [
    ".hamilton/changes/demo/critique.md",
    {
      artifact: "critique",
      change: "demo",
      created: "2026-09-12",
      verdict: "approved",
      decision: "accepted",
      scope: "design.md",
    },
  ],
  [
    ".hamilton/maps/effort/map.md",
    {
      artifact: "map",
      effort: "effort",
      status: "open",
      branch: "main",
      created: "2026-09-12",
      updated: "2026-09-12",
      decision: "accepted",
    },
  ],
  [
    ".hamilton/maps/effort/tickets/01-research.md",
    {
      artifact: "ticket",
      effort: "effort",
      ticket: 1,
      type: "research",
      status: "open",
      blocked_by: [],
      created: "2026-09-12",
      updated: "2026-09-12",
      decision: "accepted",
    },
  ],
  [
    ".hamilton/maps/effort/route.md",
    {
      artifact: "route",
      effort: "effort",
      status: "open",
      created: "2026-09-12",
      updated: "2026-09-12",
      decision: "accepted",
      units: [
        {
          id: 1,
          name: "Research",
          status: "pending",
          depends_on: [],
          backed_by: ["tickets/01-research.md"],
        },
      ],
    },
  ],
];

const expectInvalid = (result: ArtifactContractResult, code: string) => {
  expect(result._tag).toBe("invalid");
  if (result._tag === "invalid") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      code,
    );
  }
};

describe("artifact metadata contracts", () => {
  it.each(validArtifacts)("accepts %s", (sourcePath, metadata) => {
    const result = validateArtifact(recognized(sourcePath, metadata));
    expect(result._tag).toBe("valid");
    if (result._tag === "valid") {
      expect(result.artifact).toBe(metadata.artifact);
      expect(result.sourcePath).toBe(sourcePath);
      expect(result.metadata).toEqual(metadata);
      expect(result.body.diagnostics).toEqual([]);
    }
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
    expectInvalid(
      validateArtifact(recognized(sourcePath, metadata)),
      "path-mismatch",
    );
  });

  it("rejects headings supplied only by HTML comments", () => {
    const artifact = recognized(
      ".hamilton/changes/demo/proposal.md",
      validArtifacts[0][1],
      "<!-- # Proposal: Demo -->\n<!-- ## Why -->",
    );
    const body = validateArtifactBody(artifact, "proposal");
    expect(body.diagnostics.map((item) => item.code)).toContain(
      "missing-heading",
    );
    expect(body.diagnostics[0]?.location?.line).toBeGreaterThan(0);
  });

  it("extracts physical-last pass records", () => {
    const artifact = recognized(
      ".hamilton/changes/demo/review.md",
      validArtifacts[8][1],
      "# Whole-branch Review: Demo\n## Pass 1 — 2026-09-12\n### Blocking\n- None.\n### Suggestions\n- None.\n## Pass 2 — 2026-09-13\n### Blocking\n- None.\n### Suggestions\n- None.",
    );
    const body = validateArtifactBody(artifact, "review");
    expect(body.diagnostics).toEqual([]);
    expect(body.workflow.classification).toBe("physical-last-pass");
    expect(body.workflow.physicalLastPass).toBe(2);
    expect(body.workflow.records.map((record) => record.number)).toEqual([
      1, 2,
    ]);
  });

  it("reports malformed and non-monotonic records", () => {
    const malformed = recognized(
      ".hamilton/changes/demo/feedback.md",
      validArtifacts[7][1],
      "# Code Feedback: Task 2\n## Pass 1 - 2026-09-12\n### Blocking\n- None.\n### Suggestions\n- None.",
    );
    expectInvalid(validateArtifact(malformed), "invalid-record");
    const stale = recognized(
      ".hamilton/changes/demo/feedback.md",
      validArtifacts[7][1],
      "# Code Feedback: Task 2\n## Pass 1 — 2026-09-12\n### Blocking\n- None.\n### Suggestions\n- None.\n## Pass 3 — 2026-09-13\n### Blocking\n- None.\n### Suggestions\n- None.",
    );
    expectInvalid(validateArtifact(stale), "non-monotonic-record");
  });

  it("classifies unsupported legacy record layouts", () => {
    const legacy = recognized(
      ".hamilton/changes/demo/tasks/task-2/progress.md",
      validArtifacts[6][1],
      "# Task Progress: Task 2\n## Attempt 1 - 2026-09-12",
    );
    const body = validateArtifactBody(legacy, "task-progress");
    expect(body.workflow.classification).toBe("legacy-unsupported");
    expect(body.diagnostics.map((item) => item.code)).toContain(
      "invalid-record",
    );
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
    expect(validateArtifact(unrelated)).toEqual({
      _tag: "skipped",
      sourcePath: "notes.md",
    });
    expect(validateArtifact(invalid)).toEqual({
      _tag: "invalid",
      sourcePath: "broken.md",
      diagnostics: [invalid.diagnostic],
    });
  });
});
