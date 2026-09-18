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

export type ReviewPassVerdict = "approved" | "changes-requested" | "skipped";

export type ReviewPassProvenance = "per-pass" | "legacy-global";

export interface ReviewPassStructuralRecord {
  readonly provenance: "structural";
  readonly number: number;
  readonly date: string;
  readonly blocking: readonly string[];
  readonly suggestions: readonly string[];
  readonly line: number;
}

export interface ReviewPassEvidence {
  readonly number: number;
  readonly date: string;
  readonly provenance: ReviewPassProvenance;
  readonly base: string;
  readonly head: string;
  readonly verdict: ReviewPassVerdict;
  readonly blocking: readonly string[];
  readonly suggestions: readonly string[];
  readonly line: number;
}

export type ReviewPassRecord = ReviewPassStructuralRecord | ReviewPassEvidence;

export interface ReviewPassParseResult {
  readonly passes: readonly ReviewPassRecord[];
  readonly diagnostics: readonly ArtifactContractDiagnostic[];
  readonly physicalLastPass?: number;
  readonly latest?: ReviewPassEvidence;
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
  readonly passes?: readonly ReviewPassEvidence[];
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

export const supportedArtifacts: readonly SupportedArtifact[] = [
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

export const requiredFields: Record<SupportedArtifact, readonly string[]> = {
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
    "decision",
  ],
  review: [
    "artifact",
    "change",
    "created",
    "status",
    "decision",
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

export const enumValues: Partial<
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
