import type {
  ArtifactDiagnostic,
  ArtifactReadResult,
  RecognizedArtifact,
} from "./artifact-reader.js";

export type SupportedArtifact =
  | "proposal"
  | "design"
  | "requirements-change"
  | "requirements-spec"
  | "plan"
  | "progress"
  | "task-progress"
  | "feedback"
  | "review"
  | "finish"
  | "critique"
  | "map"
  | "ticket"
  | "route";

export type ArtifactContractDiagnosticCode =
  | "unsupported-artifact"
  | "missing-field"
  | "invalid-type"
  | "invalid-value"
  | "path-mismatch"
  | "missing-heading"
  | "missing-section"
  | "invalid-record"
  | "non-monotonic-record"
  | "legacy-unsupported";

export interface ArtifactContractDiagnostic {
  readonly _tag: "ArtifactContractDiagnostic";
  readonly code: ArtifactContractDiagnosticCode;
  readonly message: string;
  readonly sourcePath: string;
  readonly field?: string;
  readonly expected?: string;
  readonly actual?: unknown;
  readonly location?: { readonly line: number; readonly column?: number };
}

export interface ArtifactHeading {
  readonly level: number;
  readonly text: string;
  readonly line: number;
}

export type ArtifactWorkflowRecordKind =
  | "task"
  | "attempt"
  | "pass"
  | "outcome"
  | "unit";

export interface ArtifactWorkflowRecord {
  readonly kind: ArtifactWorkflowRecordKind;
  readonly number?: number;
  readonly date?: string;
  readonly title?: string;
  readonly line: number;
  readonly fields: Readonly<Record<string, string>>;
}

export type ArtifactBodyClassification =
  | "supported"
  | "physical-last-pass"
  | "legacy-unsupported";

export interface ArtifactWorkflowState {
  readonly classification: ArtifactBodyClassification;
  readonly records: readonly ArtifactWorkflowRecord[];
  readonly physicalLastPass?: number;
  readonly lastPass?: number;
}

export interface ArtifactBodyValidation {
  readonly headings: readonly ArtifactHeading[];
  readonly sections: readonly string[];
  readonly workflow: ArtifactWorkflowState;
  readonly diagnostics: readonly ArtifactContractDiagnostic[];
}

export interface ValidArtifactContract {
  readonly _tag: "valid";
  readonly artifact: SupportedArtifact;
  readonly sourcePath: string;
  readonly metadata: Record<string, unknown>;
  readonly body: ArtifactBodyValidation;
  readonly diagnostics: readonly [];
}

export interface InvalidArtifactContract {
  readonly _tag: "invalid";
  readonly sourcePath: string;
  readonly diagnostics: readonly (
    | ArtifactContractDiagnostic
    | ArtifactDiagnostic
  )[];
}

export interface SkippedArtifactContract {
  readonly _tag: "skipped";
  readonly sourcePath: string;
}

export type ArtifactContractResult =
  | ValidArtifactContract
  | InvalidArtifactContract
  | SkippedArtifactContract;

export interface ArtifactContract {
  readonly artifact: SupportedArtifact;
  readonly requiredFields: readonly string[];
  readonly validate: (
    artifact: RecognizedArtifact,
  ) => readonly ArtifactContractDiagnostic[];
  readonly validateBody: (
    artifact: RecognizedArtifact,
  ) => ArtifactBodyValidation;
}

type MetadataValidator = (
  value: unknown,
  field: string,
  artifact: RecognizedArtifact,
) => ArtifactContractDiagnostic | undefined;

const supportedArtifacts: readonly SupportedArtifact[] = [
  "proposal",
  "design",
  "requirements-change",
  "requirements-spec",
  "plan",
  "progress",
  "task-progress",
  "feedback",
  "review",
  "finish",
  "critique",
  "map",
  "ticket",
  "route",
];

const requiredFields: Record<SupportedArtifact, readonly string[]> = {
  proposal: [
    "artifact",
    "change",
    "status",
    "decision",
    "author",
    "created",
    "route_unit",
  ],
  design: [
    "artifact",
    "change",
    "status",
    "created",
    "author",
    "decision",
    "route_unit",
  ],
  "requirements-change": [
    "artifact",
    "capability",
    "change",
    "status",
    "created",
    "author",
    "decision",
  ],
  "requirements-spec": [
    "artifact",
    "capability",
    "status",
    "updated",
    "author",
    "decision",
  ],
  plan: [
    "artifact",
    "change",
    "status",
    "created",
    "author",
    "decision",
    "route_unit",
  ],
  progress: ["artifact", "change", "status", "updated", "decision", "tasks"],
  "task-progress": [
    "artifact",
    "change",
    "task",
    "status",
    "updated",
    "decision",
  ],
  feedback: [
    "artifact",
    "change",
    "task",
    "created",
    "status",
    "verdict",
    "decision",
    "base",
    "head",
  ],
  review: [
    "artifact",
    "change",
    "created",
    "status",
    "verdict",
    "decision",
    "base",
    "head",
  ],
  finish: [
    "artifact",
    "change",
    "status",
    "created",
    "updated",
    "strategy",
    "result",
    "decision",
  ],
  critique: ["artifact", "change", "created", "verdict", "decision", "scope"],
  map: [
    "artifact",
    "effort",
    "status",
    "branch",
    "created",
    "updated",
    "decision",
  ],
  ticket: [
    "artifact",
    "effort",
    "ticket",
    "type",
    "status",
    "blocked_by",
    "created",
    "updated",
    "decision",
  ],
  route: [
    "artifact",
    "effort",
    "status",
    "created",
    "updated",
    "decision",
    "units",
  ],
};

const enumValues: Partial<
  Record<SupportedArtifact, Partial<Record<string, readonly string[]>>>
> = {
  proposal: { status: ["draft", "approved", "implemented"] },
  design: { status: ["draft"] },
  "requirements-change": { status: ["draft"] },
  "requirements-spec": { status: ["current"] },
  plan: { status: ["draft", "approved", "in-progress", "complete", "blocked"] },
  progress: { status: ["pending", "in-progress", "blocked", "complete"] },
  "task-progress": { status: ["pending", "in-progress", "blocked", "done"] },
  feedback: {
    status: ["open", "resolved"],
    verdict: ["approved", "changes-requested", "skipped"],
  },
  review: {
    status: ["open", "complete"],
    verdict: ["approved", "changes-requested", "skipped"],
  },
  finish: {
    status: ["pending", "completed", "blocked"],
    strategy: ["local-merge", "pull-request", "no-op"],
    result: ["completed", "blocked", "pending"],
  },
  critique: { verdict: ["approved", "changes-requested", "skipped"] },
  map: { status: ["open", "cleared", "shipping", "shipped"] },
  ticket: {
    type: ["research", "prototype", "grilling", "task"],
    status: ["open", "claimed", "resolved"],
  },
  route: { status: ["open", "shipping", "shipped"] },
};

const decisions = ["accepted", "rejected", "skipped"];
const routeUnitPattern =
  /^\.hamilton\/maps\/[^/]+\/route\.md — unit [1-9][0-9]*$/;
const datePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const shaPattern = /^[0-9a-f]{40}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const diagnostic = (
  artifact: RecognizedArtifact,
  code: ArtifactContractDiagnosticCode,
  message: string,
  field?: string,
  expected?: string,
  actual?: unknown,
): ArtifactContractDiagnostic => ({
  _tag: "ArtifactContractDiagnostic",
  code,
  message,
  sourcePath: artifact.sourcePath,
  field,
  expected,
  actual,
  location: { line: artifact.locations.metadata.startLine },
});

const stringField: MetadataValidator = (value, field, artifact) =>
  isNonEmptyString(value)
    ? undefined
    : diagnostic(
        artifact,
        "invalid-type",
        `${field} must be a non-empty string`,
        field,
        "non-empty string",
        value,
      );

const dateField: MetadataValidator = (value, field, artifact) =>
  typeof value === "string" && datePattern.test(value)
    ? undefined
    : diagnostic(
        artifact,
        "invalid-value",
        `${field} must be an ISO calendar date`,
        field,
        "YYYY-MM-DD",
        value,
      );

const positiveIntegerField: MetadataValidator = (value, field, artifact) =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? undefined
    : diagnostic(
        artifact,
        "invalid-type",
        `${field} must be a positive integer`,
        field,
        "positive integer",
        value,
      );

const decisionField: MetadataValidator = (value, field, artifact) =>
  typeof value === "string" && decisions.includes(value)
    ? undefined
    : diagnostic(
        artifact,
        "invalid-value",
        `${field} is not an allowed decision`,
        field,
        decisions.join(" | "),
        value,
      );

const routeUnitField: MetadataValidator = (value, field, artifact) =>
  value === null || (typeof value === "string" && routeUnitPattern.test(value))
    ? undefined
    : diagnostic(
        artifact,
        "invalid-value",
        `${field} must be null or a route unit reference`,
        field,
        "route reference or null",
        value,
      );

const shaField: MetadataValidator = (value, field, artifact) =>
  typeof value === "string" && shaPattern.test(value)
    ? undefined
    : diagnostic(
        artifact,
        "invalid-value",
        `${field} must be a full lowercase commit identifier`,
        field,
        "40 hexadecimal characters",
        value,
      );

const listField: MetadataValidator = (value, field, artifact) =>
  Array.isArray(value)
    ? undefined
    : diagnostic(
        artifact,
        "invalid-type",
        `${field} must be a list`,
        field,
        "list",
        value,
      );

const fieldValidators: Partial<
  Record<SupportedArtifact, Partial<Record<string, MetadataValidator>>>
> = {
  proposal: {
    change: stringField,
    author: stringField,
    created: dateField,
    decision: decisionField,
    route_unit: routeUnitField,
  },
  design: {
    change: stringField,
    author: stringField,
    created: dateField,
    decision: decisionField,
    route_unit: routeUnitField,
  },
  "requirements-change": {
    capability: stringField,
    change: stringField,
    created: dateField,
    author: stringField,
    decision: decisionField,
  },
  "requirements-spec": {
    capability: stringField,
    updated: dateField,
    author: stringField,
    decision: decisionField,
  },
  plan: {
    change: stringField,
    created: dateField,
    author: stringField,
    decision: decisionField,
    route_unit: routeUnitField,
  },
  progress: {
    change: stringField,
    updated: dateField,
    decision: decisionField,
    tasks: listField,
  },
  "task-progress": {
    change: stringField,
    task: positiveIntegerField,
    updated: dateField,
    decision: decisionField,
  },
  feedback: {
    change: stringField,
    task: positiveIntegerField,
    created: dateField,
    decision: decisionField,
    base: shaField,
    head: shaField,
  },
  review: {
    change: stringField,
    created: dateField,
    decision: decisionField,
    base: shaField,
    head: shaField,
  },
  finish: {
    change: stringField,
    created: dateField,
    updated: dateField,
    decision: decisionField,
  },
  critique: {
    change: stringField,
    created: dateField,
    decision: decisionField,
    scope: stringField,
  },
  map: {
    effort: stringField,
    branch: stringField,
    created: dateField,
    updated: dateField,
    decision: decisionField,
  },
  ticket: {
    effort: stringField,
    ticket: positiveIntegerField,
    created: dateField,
    updated: dateField,
    decision: decisionField,
    blocked_by: listField,
  },
  route: {
    effort: stringField,
    created: dateField,
    updated: dateField,
    decision: decisionField,
    units: listField,
  },
};

const pathSegments = (sourcePath: string): readonly string[] => {
  const normalized = sourcePath.replaceAll("\\", "/");
  const segments = normalized.split("/").filter(Boolean);
  const marker = segments.lastIndexOf(".hamilton");
  return marker < 0 ? [] : segments.slice(marker);
};

const pathDiagnostic = (
  artifact: RecognizedArtifact,
  expected: string,
): ArtifactContractDiagnostic =>
  diagnostic(
    artifact,
    "path-mismatch",
    `Artifact path must match ${expected}`,
    "sourcePath",
    expected,
    artifact.sourcePath,
  );

const expectedPath = (
  artifact: RecognizedArtifact,
  metadata: Record<string, unknown>,
): ArtifactContractDiagnostic | undefined => {
  const kind = metadata.artifact;
  const segments = pathSegments(artifact.sourcePath);
  const expectedChange =
    typeof metadata.change === "string" ? metadata.change : "<change>";
  const expectedCapability =
    typeof metadata.capability === "string"
      ? metadata.capability
      : "<capability>";
  const expectedEffort =
    typeof metadata.effort === "string" ? metadata.effort : "<effort>";
  const expectedTask =
    typeof metadata.task === "number" ? String(metadata.task) : "<task>";
  const expectedTicket =
    typeof metadata.ticket === "number"
      ? String(metadata.ticket).padStart(2, "0")
      : "<NN>";
  let expected: readonly string[];
  switch (kind) {
    case "proposal":
      expected = [".hamilton", "changes", expectedChange, "proposal.md"];
      break;
    case "design":
      expected = [".hamilton", "changes", expectedChange, "design.md"];
      break;
    case "requirements-change":
      expected = [
        ".hamilton",
        "changes",
        expectedChange,
        "requirements",
        `${expectedCapability}.md`,
      ];
      break;
    case "requirements-spec":
      expected = [".hamilton", "specs", `${expectedCapability}.md`];
      break;
    case "plan":
      expected = [".hamilton", "changes", expectedChange, "plan.md"];
      break;
    case "progress":
      expected = [".hamilton", "changes", expectedChange, "progress.md"];
      break;
    case "task-progress":
      expected = [
        ".hamilton",
        "changes",
        expectedChange,
        "tasks",
        `task-${expectedTask}`,
        "progress.md",
      ];
      break;
    case "feedback":
      expected = [
        ".hamilton",
        "changes",
        expectedChange,
        "tasks",
        `task-${expectedTask}`,
        "feedback.md",
      ];
      break;
    case "review":
      expected = [".hamilton", "changes", expectedChange, "review.md"];
      break;
    case "finish":
      expected = [".hamilton", "changes", expectedChange, "finish.md"];
      break;
    case "critique":
      expected = [".hamilton", "changes", expectedChange, "critique.md"];
      break;
    case "map":
      expected = [".hamilton", "maps", expectedEffort, "map.md"];
      break;
    case "ticket":
      expected = [
        ".hamilton",
        "maps",
        expectedEffort,
        "tickets",
        expectedTicket + "-<slug>.md",
      ];
      if (
        segments.length === expected.length &&
        segments
          .slice(0, -1)
          .every((segment, index) => segment === expected[index]) &&
        (segments[segments.length - 1] ?? "").startsWith(
          expectedTicket + "-",
        ) &&
        (segments[segments.length - 1] ?? "").endsWith(".md")
      )
        return undefined;
      return pathDiagnostic(artifact, expected.join("/"));
    case "route":
      expected = [".hamilton", "maps", expectedEffort, "route.md"];
      break;
    default:
      return undefined;
  }
  if (
    segments.length !== expected.length ||
    !segments.every((segment, index) => segment === expected[index])
  ) {
    return pathDiagnostic(artifact, expected.join("/"));
  }
  return undefined;
};

const validateNestedLists = (
  artifact: RecognizedArtifact,
  kind: SupportedArtifact,
  metadata: Record<string, unknown>,
): ArtifactContractDiagnostic[] => {
  const diagnostics: ArtifactContractDiagnostic[] = [];
  if (kind === "progress" && Array.isArray(metadata.tasks)) {
    for (const [index, task] of metadata.tasks.entries()) {
      if (!isRecord(task)) {
        diagnostics.push(
          diagnostic(
            artifact,
            "invalid-type",
            "tasks[" + index + "] must be a mapping",
            "tasks",
            "mapping",
            task,
          ),
        );
        continue;
      }
      for (const field of ["id", "title", "status", "progress"]) {
        if (!Object.hasOwn(task, field))
          diagnostics.push(
            diagnostic(
              artifact,
              "missing-field",
              "tasks[" + index + "] is missing " + field,
              "tasks[" + index + "]." + field,
            ),
          );
      }
      for (const [field, validator] of [
        ["id", positiveIntegerField],
        ["title", stringField],
        ["progress", stringField],
      ] as const) {
        if (Object.hasOwn(task, field)) {
          const result = validator(
            task[field],
            "tasks[" + index + "]." + field,
            artifact,
          );
          if (result) diagnostics.push(result);
        }
      }
      if (
        Object.hasOwn(task, "status") &&
        (!isNonEmptyString(task.status) ||
          !["pending", "in-progress", "blocked", "done"].includes(task.status))
      ) {
        diagnostics.push(
          diagnostic(
            artifact,
            "invalid-value",
            "tasks[" + index + "].status is not allowed",
            "tasks[" + index + "].status",
            "pending | in-progress | blocked | done",
            task.status,
          ),
        );
      }
      if (
        typeof task.id === "number" &&
        Number.isInteger(task.id) &&
        task.id > 0 &&
        typeof task.progress === "string" &&
        task.progress !== "tasks/task-" + task.id + "/progress.md"
      ) {
        diagnostics.push(
          diagnostic(
            artifact,
            "path-mismatch",
            "Task progress must identify its task",
            "tasks[" + index + "].progress",
            "tasks/task-" + task.id + "/progress.md",
            task.progress,
          ),
        );
      }
    }
  }
  if (kind === "ticket" && Array.isArray(metadata.blocked_by)) {
    for (const [index, ticket] of metadata.blocked_by.entries()) {
      if (
        !(typeof ticket === "number" && Number.isInteger(ticket) && ticket > 0)
      )
        diagnostics.push(
          diagnostic(
            artifact,
            "invalid-type",
            "blocked_by[" + index + "] must be a positive integer",
            "blocked_by[" + index + "]",
            "positive integer",
            ticket,
          ),
        );
    }
  }
  if (kind === "route" && Array.isArray(metadata.units)) {
    for (const [index, unit] of metadata.units.entries()) {
      if (!isRecord(unit)) {
        diagnostics.push(
          diagnostic(
            artifact,
            "invalid-type",
            "units[" + index + "] must be a mapping",
            "units",
            "mapping",
            unit,
          ),
        );
        continue;
      }
      for (const field of ["id", "name", "status", "depends_on", "backed_by"]) {
        if (!Object.hasOwn(unit, field))
          diagnostics.push(
            diagnostic(
              artifact,
              "missing-field",
              "units[" + index + "] is missing " + field,
              "units[" + index + "]." + field,
            ),
          );
      }
      for (const [field, validator] of [
        ["id", positiveIntegerField],
        ["name", stringField],
        ["depends_on", listField],
        ["backed_by", listField],
      ] as const) {
        if (Object.hasOwn(unit, field)) {
          const result = validator(
            unit[field],
            "units[" + index + "]." + field,
            artifact,
          );
          if (result) diagnostics.push(result);
        }
      }
      if (
        Object.hasOwn(unit, "status") &&
        (!isNonEmptyString(unit.status) ||
          !["pending", "in-progress", "shipped"].includes(unit.status))
      ) {
        diagnostics.push(
          diagnostic(
            artifact,
            "invalid-value",
            "units[" + index + "].status is not allowed",
            "units[" + index + "].status",
            "pending | in-progress | shipped",
            unit.status,
          ),
        );
      }
      for (const field of ["depends_on", "backed_by"]) {
        if (Array.isArray(unit[field])) {
          for (const [itemIndex, item] of unit[field].entries()) {
            if (
              field === "depends_on" &&
              !(typeof item === "number" && Number.isInteger(item) && item > 0)
            )
              diagnostics.push(
                diagnostic(
                  artifact,
                  "invalid-type",
                  "units[" +
                    index +
                    "].depends_on[" +
                    itemIndex +
                    "] must be a positive integer",
                  "units[" + index + "].depends_on[" + itemIndex + "]",
                  "positive integer",
                  item,
                ),
              );
            if (field === "backed_by" && !isNonEmptyString(item))
              diagnostics.push(
                diagnostic(
                  artifact,
                  "invalid-type",
                  "units[" +
                    index +
                    "].backed_by[" +
                    itemIndex +
                    "] must be a non-empty string",
                  "units[" + index + "].backed_by[" + itemIndex + "]",
                  "non-empty string",
                  item,
                ),
              );
          }
        }
      }
    }
  }
  return diagnostics;
};

interface BodyContract {
  readonly heading: string;
  readonly sections: readonly string[];
  readonly records?:
    | ArtifactWorkflowRecordKind
    | readonly ArtifactWorkflowRecordKind[];
}

const bodyContracts: Record<SupportedArtifact, BodyContract> = {
  proposal: {
    heading: "Proposal:",
    sections: [
      "Why",
      "Goals & Success Criteria",
      "Non-Goals",
      "Proposed Change",
      "Capabilities",
      "Impact",
    ],
  },
  design: {
    heading: "Design:",
    sections: [
      "Context",
      "Goals / Non-Goals",
      "Decisions",
      "Architecture & Components",
      "Testing Strategy",
      "Constraints & Boundaries",
      "Risks / Trade-offs",
    ],
  },
  "requirements-change": {
    heading: "Capability:",
    sections: ["ADDED Requirements"],
  },
  "requirements-spec": {
    heading: "Capability:",
    sections: ["Overview", "Contract", "Behavior", "Invariants", "Decisions"],
  },
  plan: {
    heading: "Plan:",
    sections: ["Overview", "Tasks", "Done when"],
    records: "task",
  },
  progress: { heading: "Progress:", sections: [] },
  "task-progress": {
    heading: "Task Progress:",
    sections: [],
    records: "attempt",
  },
  feedback: {
    heading: "Code Feedback:",
    sections: ["Blocking", "Suggestions"],
    records: "pass",
  },
  review: {
    heading: "Whole-branch Review:",
    sections: ["Blocking", "Suggestions"],
    records: "pass",
  },
  finish: {
    heading: "Finish History:",
    sections: [],
    records: ["attempt", "outcome"],
  },
  critique: {
    heading: "Critique:",
    sections: ["Scope", "Findings", "Quality Lens", "Summary"],
  },
  map: {
    heading: "",
    sections: [
      "Destination",
      "Notes",
      "Operation rules",
      "Decisions so far",
      "Not yet specified",
      "Out of scope",
    ],
  },
  route: {
    heading: "Route —",
    sections: ["Shipping rules", "Units"],
    records: "unit",
  },
  ticket: {
    heading: "",
    sections: ["Question", "Answer", "Outdated decisions"],
  },
};

export interface ArtifactBodyView {
  readonly source: string;
  readonly lines: readonly string[];
}

export const createArtifactBodyView = (body: string): ArtifactBodyView => {
  let visible = body.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
  visible = visible.replace(/<!--?[\s\S]*$/g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
  return { source: visible, lines: visible.split(/\r\n|\n|\r/) };
};

const bodyLines = (artifact: RecognizedArtifact): readonly string[] =>
  createArtifactBodyView(artifact.body).lines;

const bodyHeading = (line: string) => {
  const match = /^( {0,3})(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
  if (!match) return undefined;
  return { level: match[2].length, text: match[3].trim() };
};

const readBodyHeadings = (
  artifact: RecognizedArtifact,
): readonly ArtifactHeading[] =>
  bodyLines(artifact).flatMap((line, index) => {
    const heading = bodyHeading(line);
    return heading
      ? [{ ...heading, line: artifact.locations.body.startLine + index }]
      : [];
  });

const bodyDiagnostic = (
  artifact: RecognizedArtifact,
  code: ArtifactContractDiagnosticCode,
  message: string,
  line: number,
  expected?: string,
  actual?: unknown,
): ArtifactContractDiagnostic => ({
  _tag: "ArtifactContractDiagnostic",
  code,
  message,
  sourcePath: artifact.sourcePath,
  expected,
  actual,
  location: { line },
});

const recordHeading = (kind: ArtifactWorkflowRecordKind, text: string) => {
  const label =
    kind === "pass"
      ? "Pass"
      : kind === "attempt"
        ? "Attempt"
        : kind === "outcome"
          ? "Outcome"
          : kind === "unit"
            ? "Unit"
            : "Task";
  if (kind === "unit") {
    const unit = /^([1-9][0-9]*)\. (.+)$/.exec(text);
    return unit ? { number: Number(unit[1]), title: unit[2] } : undefined;
  }
  const match = new RegExp(
    "^" + label + " ([1-9][0-9]*) — ([0-9]{4}-[0-9]{2}-[0-9]{2})(?:$| )",
  ).exec(text);
  if (!match) return undefined;
  return { number: Number(match[1]), date: match[2] };
};

const recordFields = (
  lines: readonly string[],
  start: number,
  end: number,
): Readonly<Record<string, string>> => {
  const fields: Record<string, string> = {};
  for (let index = start + 1; index < end; index += 1) {
    const match = /^- ([A-Za-z][A-Za-z -]*):[ \t]*(.*)$/.exec(
      lines[index] ?? "",
    );
    if (match) fields[match[1].trim()] = match[2].trim();
  }
  return fields;
};

const readWorkflow = (
  artifact: RecognizedArtifact,
  kind:
    | ArtifactWorkflowRecordKind
    | readonly ArtifactWorkflowRecordKind[]
    | undefined,
  headings: readonly ArtifactHeading[],
): {
  readonly state: ArtifactWorkflowState;
  readonly diagnostics: readonly ArtifactContractDiagnostic[];
} => {
  if (!kind)
    return {
      state: { classification: "supported", records: [] },
      diagnostics: [],
    };
  const kinds = Array.isArray(kind) ? kind : [kind];
  const lines = bodyLines(artifact);
  const candidates = headings.filter(
    (heading) =>
      heading.level === 2 || (kinds.includes("unit") && heading.level === 3),
  );
  const records: ArtifactWorkflowRecord[] = [];
  const diagnostics: ArtifactContractDiagnostic[] = [];
  let sawLegacy = false;
  for (const heading of candidates) {
    const matchingKind = kinds.find((candidate) => {
      const label =
        candidate === "pass"
          ? "Pass"
          : candidate === "attempt"
            ? "Attempt"
            : candidate === "outcome"
              ? "Outcome"
              : candidate === "unit"
                ? "Unit"
                : "Task";
      return (
        heading.text.startsWith(label + " ") ||
        (candidate === "unit" && /^[1-9][0-9]*\. /.test(heading.text))
      );
    });
    if (!matchingKind) {
      const legacy = /^(Pass|Attempt|Outcome|Task|Unit)\b/.exec(heading.text);
      if (legacy) {
        sawLegacy = true;
        diagnostics.push(
          bodyDiagnostic(
            artifact,
            "legacy-unsupported",
            `Unsupported legacy ${legacy[1].toLowerCase()} record`,
            heading.line,
            kinds.join(" | "),
            heading.text,
          ),
        );
      }
      continue;
    }
    const parsed = recordHeading(matchingKind, heading.text);
    const label =
      matchingKind === "pass"
        ? "Pass"
        : matchingKind === "attempt"
          ? "Attempt"
          : matchingKind === "outcome"
            ? "Outcome"
            : matchingKind === "unit"
              ? "Unit"
              : "Task";
    if (matchingKind === "unit" || heading.text.startsWith(label + " ")) {
      if (!parsed) {
        sawLegacy = true;
        diagnostics.push(
          bodyDiagnostic(
            artifact,
            "invalid-record",
            `Malformed ${label.toLowerCase()} record`,
            heading.line,
            `${label} N — YYYY-MM-DD`,
            heading.text,
          ),
        );
        continue;
      }
      const start = heading.line - artifact.locations.body.startLine;
      const next = candidates.find(
        (candidate) => candidate.line > heading.line,
      );
      const end = next
        ? next.line - artifact.locations.body.startLine
        : lines.length;
      records.push({
        kind: matchingKind,
        number: parsed.number,
        date: "date" in parsed ? parsed.date : undefined,
        title: "title" in parsed ? parsed.title : undefined,
        line: heading.line,
        fields: recordFields(lines, start, end),
      });
    }
  }
  for (const recordKind of kinds) {
    const numbered = records.filter(
      (record) => record.kind === recordKind && record.number !== undefined,
    );
    for (let index = 0; index < numbered.length; index += 1) {
      const expected = index + 1;
      if (numbered[index]?.number !== expected) {
        diagnostics.push(
          bodyDiagnostic(
            artifact,
            "non-monotonic-record",
            "Record numbering must be append-only and contiguous",
            numbered[index]?.line ?? artifact.locations.body.startLine,
            String(expected),
            numbered[index]?.number,
          ),
        );
        break;
      }
    }
  }
  const passRecords = records.filter((record) => record.kind === "pass");
  const passNumbers = passRecords.flatMap((record) =>
    record.number === undefined ? [] : [record.number],
  );
  const lastPass =
    passNumbers.length > 0 ? Math.max(...passNumbers) : undefined;
  const physicalLastPass =
    passNumbers.length > 0 ? passNumbers[passNumbers.length - 1] : undefined;
  const levelTwo = headings.filter((heading) => heading.level === 2);
  const physicalPass =
    passRecords.length > 0 &&
    levelTwo.at(-1)?.line === passRecords.at(-1)?.line;
  if (passRecords.length > 0 && !physicalPass) {
    diagnostics.push(
      bodyDiagnostic(
        artifact,
        "invalid-record",
        "The latest pass must be the physical last pass",
        passRecords.at(-1)?.line ?? artifact.locations.body.startLine,
        "physical last pass",
      ),
    );
  }
  const classification: ArtifactBodyClassification = sawLegacy
    ? "legacy-unsupported"
    : physicalPass
      ? "physical-last-pass"
      : "supported";
  const state: ArtifactWorkflowState = {
    classification,
    records,
    ...(physicalLastPass === undefined ? {} : { physicalLastPass }),
    ...(lastPass === undefined ? {} : { lastPass }),
  };
  return { state, diagnostics };
};

export const validateArtifactBody = (
  artifact: RecognizedArtifact,
  kind: SupportedArtifact,
): ArtifactBodyValidation => {
  const headings = readBodyHeadings(artifact);
  const contract = bodyContracts[kind];
  const diagnostics: ArtifactContractDiagnostic[] = [];
  const title = headings.find((heading) => heading.level === 1);
  if (
    !title ||
    (contract.heading && !title.text.startsWith(contract.heading))
  ) {
    diagnostics.push(
      bodyDiagnostic(
        artifact,
        "missing-heading",
        `Body is missing the # ${contract.heading || "artifact title"} heading`,
        title?.line ?? artifact.locations.body.startLine,
        contract.heading || "# title",
        title?.text,
      ),
    );
  }
  for (const section of contract.sections) {
    if (
      !headings.some(
        (heading) => heading.level >= 2 && heading.text === section,
      )
    ) {
      diagnostics.push(
        bodyDiagnostic(
          artifact,
          "missing-section",
          `Body is missing the ## ${section} section`,
          artifact.locations.body.startLine,
          section,
        ),
      );
    }
  }
  const workflow = readWorkflow(artifact, contract.records, headings);
  diagnostics.push(...workflow.diagnostics);
  if (kind === "plan" && contract.records) {
    const tasks = headings.filter(
      (heading) =>
        heading.level === 3 && /^Task [1-9][0-9]*:/.test(heading.text),
    );
    if (tasks.length === 0)
      diagnostics.push(
        bodyDiagnostic(
          artifact,
          "missing-section",
          "Plan must declare at least one task",
          artifact.locations.body.startLine,
          "### Task N: title",
        ),
      );
    for (let index = 0; index < tasks.length; index += 1) {
      const match = /^Task ([1-9][0-9]*):[ \t]*(.*)$/.exec(tasks[index].text);
      if (match)
        (workflow.state.records as ArtifactWorkflowRecord[]).push({
          kind: "task",
          number: Number(match[1]),
          title: match[2],
          line: tasks[index].line,
          fields: {},
        });
    }
  }
  return {
    headings,
    sections: headings
      .filter((heading) => heading.level === 2)
      .map((heading) => heading.text),
    workflow: workflow.state,
    diagnostics,
  };
};

const validateContract = (
  contract: ArtifactContract,
  artifact: RecognizedArtifact,
): readonly ArtifactContractDiagnostic[] => {
  const metadata = artifact.metadata;
  const diagnostics: ArtifactContractDiagnostic[] = [];
  for (const field of contract.requiredFields) {
    if (!Object.hasOwn(metadata, field))
      diagnostics.push(
        diagnostic(
          artifact,
          "missing-field",
          "Frontmatter is missing the " + field + " field",
          field,
        ),
      );
  }
  if (metadata.artifact !== contract.artifact)
    diagnostics.push(
      diagnostic(
        artifact,
        "invalid-value",
        "artifact must be " + contract.artifact,
        "artifact",
        contract.artifact,
        metadata.artifact,
      ),
    );
  for (const [field, values] of Object.entries(
    enumValues[contract.artifact] ?? {},
  )) {
    if (!values) continue;
    if (
      Object.hasOwn(metadata, field) &&
      (!isNonEmptyString(metadata[field]) || !values.includes(metadata[field]))
    )
      diagnostics.push(
        diagnostic(
          artifact,
          "invalid-value",
          field + " is not allowed for " + contract.artifact,
          field,
          values.join(" | "),
          metadata[field],
        ),
      );
  }
  for (const [field, validator] of Object.entries(
    fieldValidators[contract.artifact] ?? {},
  )) {
    if (!validator) continue;
    if (Object.hasOwn(metadata, field)) {
      const result = validator(metadata[field], field, artifact);
      if (result) diagnostics.push(result);
    }
  }
  const identity = expectedPath(artifact, metadata);
  if (identity) diagnostics.push(identity);
  diagnostics.push(
    ...validateNestedLists(artifact, contract.artifact, metadata),
  );
  return diagnostics;
};

export const artifactContracts: Readonly<
  Record<SupportedArtifact, ArtifactContract>
> = Object.fromEntries(
  supportedArtifacts.map((artifact) => [
    artifact,
    {
      artifact,
      requiredFields: requiredFields[artifact],
      validate: (source) =>
        validateContract(artifactContracts[artifact], source),
      validateBody: (source) => validateArtifactBody(source, artifact),
    },
  ]),
) as Record<SupportedArtifact, ArtifactContract>;

export const artifactContractRegistry = artifactContracts;

export const validateArtifact = (
  result: ArtifactReadResult,
): ArtifactContractResult => {
  if (result._tag === "unrelated")
    return { _tag: "skipped", sourcePath: result.sourcePath };
  if (result._tag === "invalid")
    return {
      _tag: "invalid",
      sourcePath: result.sourcePath,
      diagnostics: [result.diagnostic],
    };
  const artifact = result.metadata.artifact;
  if (
    typeof artifact !== "string" ||
    !Object.hasOwn(artifactContracts, artifact)
  ) {
    return {
      _tag: "invalid",
      sourcePath: result.sourcePath,
      diagnostics: [
        diagnostic(
          result,
          "unsupported-artifact",
          "Frontmatter declares an unsupported artifact value",
          "artifact",
          supportedArtifacts.join(" | "),
          artifact,
        ),
      ],
    };
  }
  const contract = artifactContracts[artifact as SupportedArtifact];
  const body = contract.validateBody(result);
  const diagnostics = [...contract.validate(result), ...body.diagnostics];
  return diagnostics.length === 0
    ? {
        _tag: "valid",
        artifact: contract.artifact,
        sourcePath: result.sourcePath,
        metadata: result.metadata,
        body,
        diagnostics: [],
      }
    : { _tag: "invalid", sourcePath: result.sourcePath, diagnostics };
};

export const validateArtifactContract = validateArtifact;
export const validateArtifactMetadata = validateArtifact;
