import { marked, type Token } from "marked";
import type { RecognizedArtifact } from "./artifact-reader.js";
import { parseReviewPasses } from "./review-passes.js";
import type {
  ArtifactBodyValidation,
  ArtifactContractDiagnostic,
  ArtifactContractDiagnosticCode,
  ArtifactHeading,
  ArtifactWorkflowRecord,
  ArtifactWorkflowRecordKind,
  ArtifactWorkflowState,
  ReviewPassEvidence,
  SupportedArtifact,
} from "./artifact-types.js";

interface BodyContract {
  readonly heading: string;
  readonly sections: readonly string[];
  readonly records?:
    | GenericWorkflowRecordKind
    | readonly GenericWorkflowRecordKind[];
  readonly ledger?: "plan" | "progress";
}

type GenericWorkflowRecordKind = Exclude<ArtifactWorkflowRecordKind, "pass">;

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
    ledger: "plan",
  },
  progress: { heading: "Progress:", sections: [], ledger: "progress" },
  "task-progress": {
    heading: "Task Progress:",
    sections: [],
    records: "attempt",
  },
  feedback: {
    heading: "Code Feedback:",
    sections: ["Blocking", "Suggestions"],
  },
  review: {
    heading: "Whole-branch Review:",
    sections: ["Blocking", "Suggestions"],
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
    sections: [
      "Point of departure",
      "Destination",
      "Path chosen",
      "Shipping rules",
      "Units",
    ],
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

const lineAtOffset = (source: string, offset: number): number =>
  source.slice(0, offset).split(/\r\n|\n|\r/).length;

interface ParsedHeading {
  readonly level: number;
  readonly text: string;
  readonly offset: number;
}

const markdownHeadings = (source: string): readonly ParsedHeading[] => {
  const headings: ParsedHeading[] = [];
  let offset = 0;
  let tokens: readonly Token[];
  try {
    tokens = marked.lexer(source);
  } catch {
    return headings;
  }
  for (const token of tokens) {
    const raw =
      "raw" in token && typeof token.raw === "string" ? token.raw : "";
    const tokenOffset = raw === "" ? offset : source.indexOf(raw, offset);
    const resolvedOffset = tokenOffset < 0 ? offset : tokenOffset;
    if (token.type === "heading")
      headings.push({
        level: token.depth,
        text: token.text.trim(),
        offset: resolvedOffset,
      });
    offset = resolvedOffset + raw.length;
  }
  return headings;
};

const readBodyHeadings = (
  artifact: RecognizedArtifact,
): readonly ArtifactHeading[] => {
  const view = createArtifactBodyView(artifact.body);
  return markdownHeadings(view.source).map((heading) => ({
    level: heading.level,
    text: heading.text,
    line:
      artifact.locations.body.startLine +
      lineAtOffset(view.source, heading.offset) -
      1,
  }));
};

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
  ...(expected === undefined ? {} : { expected }),
  ...(actual === undefined ? {} : { actual }),
  location: { line },
});

const recordLabel = (kind: GenericWorkflowRecordKind): string =>
  kind === "attempt"
    ? "Attempt"
    : kind === "outcome"
      ? "Outcome"
      : kind === "unit"
        ? "Unit"
        : "Task";

const recordHeadingMatches = (
  kind: GenericWorkflowRecordKind,
  text: string,
): boolean =>
  text.startsWith(recordLabel(kind) + " ") ||
  (kind === "unit" && /^[1-9][0-9]*\. /.test(text));

const recordLevel = (kind: GenericWorkflowRecordKind): number =>
  kind === "unit" ? 3 : 2;

type ParsedRecordHeading =
  | { readonly number: number; readonly date: string }
  | { readonly number: number; readonly title: string };

const recordHeading = (
  kind: GenericWorkflowRecordKind,
  text: string,
): ParsedRecordHeading | null => {
  const label = recordLabel(kind);
  if (kind === "unit") {
    const unit = /^([1-9][0-9]*)\. (.+)$/.exec(text);
    return unit ? { number: Number(unit[1]), title: unit[2] ?? "" } : null;
  }
  const match = new RegExp(
    "^" + label + " ([1-9][0-9]*) — ([0-9]{4}-[0-9]{2}-[0-9]{2})$",
  ).exec(text);
  return match ? { number: Number(match[1]), date: match[2] ?? "" } : null;
};

const commentedRecordHeadings = (
  artifact: RecognizedArtifact,
  kinds: readonly GenericWorkflowRecordKind[],
): readonly ArtifactHeading[] => {
  const headings: ArtifactHeading[] = [];
  const comments = /<!--[\s\S]*?-->/g;
  let match: RegExpExecArray | null;
  while ((match = comments.exec(artifact.body)) !== null) {
    const comment = match[0];
    const inner = comment.replace(/^<!--/, "").replace(/-->$/, "");
    for (const heading of markdownHeadings(inner)) {
      const text = heading.text;
      if (kinds.some((kind) => recordHeadingMatches(kind, text)))
        headings.push({
          level: heading.level,
          text,
          line:
            artifact.locations.body.startLine +
            lineAtOffset(
              artifact.body.slice(0, match.index) + inner,
              match.index + heading.offset,
            ) -
            1,
        });
    }
  }
  return headings;
};

const recordFields = (
  lines: readonly string[],
  start: number,
  end: number,
): Readonly<Record<string, string>> => {
  const fields: Record<string, string> = {};
  for (let index = start + 1; index < end; index += 1) {
    const match = /^- ([A-Za-z][A-Za-z -]*):[ \t]*(.*)$/.exec(
      lines[index] || "",
    );
    if (match) fields[match[1]?.trim() ?? ""] = match[2]?.trim() ?? "";
  }
  return fields;
};

const readWorkflow = (
  artifact: RecognizedArtifact,
  kind: GenericWorkflowRecordKind | readonly GenericWorkflowRecordKind[] | null,
  headings: readonly ArtifactHeading[],
): {
  readonly state: ArtifactWorkflowState;
  readonly diagnostics: readonly ArtifactContractDiagnostic[];
} => {
  if (kind === null)
    return {
      state: { classification: "supported", records: [] },
      diagnostics: [],
    };
  const kinds = Array.isArray(kind) ? kind : [kind];
  const lines = bodyLines(artifact);
  const unitsSection = headings.find(
    (heading) => heading.level === 2 && heading.text === "Units",
  );
  const unitsSectionEnd =
    unitsSection === undefined
      ? Number.POSITIVE_INFINITY
      : (headings.find(
          (heading) => heading.level === 2 && heading.line > unitsSection.line,
        )?.line ?? Number.POSITIVE_INFINITY);
  const isUnitSectionHeading = (heading: ArtifactHeading): boolean =>
    unitsSection !== undefined &&
    heading.line > unitsSection.line &&
    heading.line < unitsSectionEnd;
  const candidates = headings.filter(
    (heading) =>
      heading.level === 2 ||
      (kinds.includes("unit") &&
        heading.level === 3 &&
        isUnitSectionHeading(heading)),
  );
  const records: ArtifactWorkflowRecord[] = [];
  const diagnostics: ArtifactContractDiagnostic[] = [];
  let sawLegacy = false;
  for (const heading of headings.filter((candidate) => candidate.level > 1)) {
    const matchingKind =
      kinds.find(
        (candidate) =>
          recordHeadingMatches(candidate, heading.text) &&
          (candidate !== "unit" || isUnitSectionHeading(heading)),
      ) ?? null;
    if (matchingKind === null) {
      const legacy = /^(Pass|Attempt|Outcome|Task|Unit)\b/.exec(heading.text);
      if (legacy && !(kinds.includes("unit") && heading.level === 3)) {
        sawLegacy = true;
        diagnostics.push(
          bodyDiagnostic(
            artifact,
            "legacy-unsupported",
            `Unsupported legacy ${legacy[1]?.toLowerCase() ?? ""} record`,
            heading.line,
            kinds.join(" | "),
            heading.text,
          ),
        );
      }
      continue;
    }
    const label = recordLabel(matchingKind);
    if (heading.level !== recordLevel(matchingKind)) {
      diagnostics.push(
        bodyDiagnostic(
          artifact,
          "invalid-record",
          `${label} records must use level ${recordLevel(matchingKind)} headings`,
          heading.line,
          `${"#".repeat(recordLevel(matchingKind))} ${label} N — YYYY-MM-DD`,
          heading.text,
        ),
      );
      continue;
    }
    const parsed = recordHeading(matchingKind, heading.text);
    if (parsed === null) {
      sawLegacy = true;
      diagnostics.push(
        bodyDiagnostic(
          artifact,
          "invalid-record",
          `Malformed ${label.toLowerCase()} record`,
          heading.line,
          matchingKind === "unit" ? "N. title" : `${label} N — YYYY-MM-DD`,
          heading.text,
        ),
      );
      continue;
    }
    const start = heading.line - artifact.locations.body.startLine;
    const next =
      candidates.find((candidate) => candidate.line > heading.line) ?? null;
    const end =
      next === null
        ? lines.length
        : next.line - artifact.locations.body.startLine;
    records.push({
      kind: matchingKind,
      number: parsed.number,
      ...(parsed && "date" in parsed ? { date: parsed.date } : {}),
      ...(parsed && "title" in parsed ? { title: parsed.title } : {}),
      line: heading.line,
      fields: recordFields(lines, start, end),
    });
  }
  for (const heading of commentedRecordHeadings(artifact, kinds)) {
    const matchingKind =
      kinds.find((candidate) =>
        recordHeadingMatches(candidate, heading.text),
      ) ?? null;
    if (matchingKind === null) continue;
    diagnostics.push(
      bodyDiagnostic(
        artifact,
        "invalid-record",
        `${recordLabel(matchingKind)} records cannot be declared in HTML comments`,
        heading.line,
        `${"#".repeat(recordLevel(matchingKind))} ${recordLabel(matchingKind)} N — YYYY-MM-DD`,
        heading.text,
      ),
    );
  }
  for (const recordKind of kinds) {
    if (!records.some((record) => record.kind === recordKind)) {
      const label = recordLabel(recordKind);
      diagnostics.push(
        bodyDiagnostic(
          artifact,
          "missing-section",
          `Body must declare at least one ${label.toLowerCase()} record`,
          artifact.locations.body.startLine,
          recordKind === "unit" ? "N. title" : `${label} N — YYYY-MM-DD`,
        ),
      );
    }
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
  const state: ArtifactWorkflowState = {
    classification: sawLegacy ? "legacy-unsupported" : "supported",
    records,
  };
  return { state, diagnostics };
};

const readReviewWorkflow = (
  artifact: RecognizedArtifact,
): {
  readonly state: ArtifactWorkflowState;
  readonly diagnostics: readonly ArtifactContractDiagnostic[];
} => {
  const parsed = parseReviewPasses(artifact);
  const records = parsed.passes.map((pass): ArtifactWorkflowRecord => {
    const fields = {
      Blocking: pass.blocking.join("\n"),
      Suggestions: pass.suggestions.join("\n"),
    };
    if (pass.provenance === "structural")
      return {
        kind: "pass",
        number: pass.number,
        date: pass.date,
        line: pass.line,
        fields,
      };
    return {
      kind: "pass",
      number: pass.number,
      date: pass.date,
      line: pass.line,
      fields: {
        ...fields,
        Base: pass.base,
        Head: pass.head,
        Verdict: pass.verdict,
      },
    };
  });
  const evidence = parsed.passes.filter(
    (pass): pass is ReviewPassEvidence => pass.provenance !== "structural",
  );
  return {
    state: {
      classification:
        parsed.physicalLastPass === undefined
          ? "supported"
          : "physical-last-pass",
      records,
      passes: evidence,
      ...(parsed.physicalLastPass === undefined
        ? {}
        : { physicalLastPass: parsed.physicalLastPass }),
      ...(parsed.physicalLastPass === undefined
        ? {}
        : { lastPass: parsed.physicalLastPass }),
    },
    diagnostics: parsed.diagnostics,
  };
};

const tableCells = (line: string): readonly string[] | null => {
  const opening = /^\s*\|/.exec(line);
  if (opening === null) return null;
  const content = line.slice(opening[0].length);
  let closing = content.length - 1;
  while (closing >= 0 && /\s/.test(content[closing] ?? "")) closing -= 1;
  if (content[closing] !== "|") return null;
  let backslashes = 0;
  for (
    let index = closing - 1;
    index >= 0 && content[index] === "\\";
    index -= 1
  )
    backslashes += 1;
  if (backslashes % 2 === 1) return null;

  const cells: string[] = [];
  let cell = "";
  let escaped = false;
  for (let index = 0; index < closing; index += 1) {
    const character = content[index] ?? "";
    if (escaped) {
      cell += character === "|" ? "|" : `\\${character}`;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (escaped) cell += "\\";
  cells.push(cell.trim());
  return cells;
};

const isTableSeparator = (cells: readonly string[]): boolean =>
  cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));

const readTaskLedger = (
  artifact: RecognizedArtifact,
  ledger: "plan" | "progress",
  headings: readonly ArtifactHeading[],
): {
  readonly records: readonly ArtifactWorkflowRecord[];
  readonly diagnostics: readonly ArtifactContractDiagnostic[];
} => {
  const records: ArtifactWorkflowRecord[] = [];
  const diagnostics: ArtifactContractDiagnostic[] = [];
  const lines = bodyLines(artifact);
  if (ledger === "plan") {
    const taskHeadings = headings.filter(
      (heading) => heading.level === 3 && heading.text.startsWith("Task "),
    );
    if (taskHeadings.length === 0) {
      diagnostics.push(
        bodyDiagnostic(
          artifact,
          "missing-section",
          "Plan must declare at least one task",
          artifact.locations.body.startLine,
          "### Task N: title",
        ),
      );
    }
    for (const heading of taskHeadings) {
      const match = /^Task ([1-9][0-9]*):[ \t]+(.+)$/.exec(heading.text);
      if (match === null) {
        diagnostics.push(
          bodyDiagnostic(
            artifact,
            "invalid-record",
            "Malformed task record",
            heading.line,
            "Task N: title",
            heading.text,
          ),
        );
        continue;
      }
      records.push({
        kind: "task",
        number: Number(match[1]),
        title: match[2] ?? "",
        line: heading.line,
        fields: {},
      });
    }
  } else {
    const headerIndex = lines.findIndex((line) => {
      const cells = tableCells(line);
      return (
        cells?.length === 3 &&
        cells[0] === "Task" &&
        cells[1] === "Status" &&
        cells[2] === "Progress"
      );
    });
    if (headerIndex === -1) {
      diagnostics.push(
        bodyDiagnostic(
          artifact,
          "missing-section",
          "Progress must declare a task ledger",
          artifact.locations.body.startLine,
          "| Task | Status | Progress |",
        ),
      );
    } else {
      const separator = tableCells(lines[headerIndex + 1] || "");
      if (separator === null || !isTableSeparator(separator)) {
        diagnostics.push(
          bodyDiagnostic(
            artifact,
            "invalid-record",
            "Progress task ledger must declare a separator row",
            artifact.locations.body.startLine + headerIndex + 1,
            "| --- | --- | --- |",
            lines[headerIndex + 1],
          ),
        );
      }
      for (let index = headerIndex + 1; index < lines.length; index += 1) {
        const cells = tableCells(lines[index] || "");
        if (cells === null || isTableSeparator(cells)) continue;
        const line = artifact.locations.body.startLine + index;
        if (cells.length !== 3) {
          diagnostics.push(
            bodyDiagnostic(
              artifact,
              "invalid-record",
              "Malformed progress task record",
              line,
              "| Task N: title | status | [details](tasks/task-N/progress.md) |",
              lines[index],
            ),
          );
          continue;
        }
        const task = /^Task ([1-9][0-9]*):[ \t]+(.+)$/.exec(cells[0] || "");
        const status = ["pending", "in-progress", "blocked", "done"].includes(
          cells[1] || "",
        );
        const progress =
          /^\[details\]\(tasks\/task-([1-9][0-9]*)\/progress\.md\)$/.exec(
            cells[2] || "",
          );
        if (!task || !status || !progress || progress[1] !== task[1]) {
          diagnostics.push(
            bodyDiagnostic(
              artifact,
              "invalid-record",
              "Malformed progress task record",
              line,
              "| Task N: title | status | [details](tasks/task-N/progress.md) |",
              lines[index],
            ),
          );
          continue;
        }
        records.push({
          kind: "task",
          number: Number(task[1]),
          title: task[2] ?? "",
          line,
          fields: { Status: cells[1] ?? "", Progress: cells[2] ?? "" },
        });
      }
    }
  }
  for (let index = 0; index < records.length; index += 1) {
    const expected = index + 1;
    if (records[index]?.number !== expected) {
      diagnostics.push(
        bodyDiagnostic(
          artifact,
          "non-monotonic-record",
          "Task numbering must be append-only and contiguous",
          records[index]?.line ?? artifact.locations.body.startLine,
          String(expected),
          records[index]?.number,
        ),
      );
      break;
    }
  }
  return { records, diagnostics };
};

export const validateArtifactBody = (
  artifact: RecognizedArtifact,
  kind: SupportedArtifact,
): ArtifactBodyValidation => {
  const headings = readBodyHeadings(artifact);
  const contract = bodyContracts[kind];
  const diagnostics: ArtifactContractDiagnostic[] = [];
  const title = headings.find((heading) => heading.level === 1) ?? null;
  if (
    title === null ||
    (contract.heading !== "" && !title.text.startsWith(contract.heading))
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
        (heading) =>
          heading.text === section &&
          (kind === "route" ? heading.level === 2 : heading.level >= 2),
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
  const workflow =
    kind === "feedback" || kind === "review"
      ? readReviewWorkflow(artifact)
      : readWorkflow(artifact, contract.records ?? null, headings);
  diagnostics.push(...workflow.diagnostics);
  const workflowRecords = [...workflow.state.records];
  if (contract.ledger) {
    const ledger = readTaskLedger(artifact, contract.ledger, headings);
    diagnostics.push(...ledger.diagnostics);
    workflowRecords.push(...ledger.records);
  }
  return {
    headings,
    sections: headings
      .filter((heading) => heading.level === 2)
      .map((heading) => heading.text),
    workflow: { ...workflow.state, records: workflowRecords },
    diagnostics,
  };
};
