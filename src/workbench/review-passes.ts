import { marked, type Token } from "marked";
import type { RecognizedArtifact } from "./artifact-reader.js";
import type {
  ArtifactContractDiagnostic,
  ArtifactContractDiagnosticCode,
  ReviewPassEvidence,
  ReviewPassParseResult,
  ReviewPassVerdict,
} from "./artifact-types.js";

interface ReviewHeading {
  readonly level: number;
  readonly text: string;
  readonly index: number;
  readonly line: number;
}

interface PassHeading {
  readonly heading: ReviewHeading;
  readonly endIndex: number;
  readonly number: number | null;
  readonly parsed: { readonly number: number; readonly date: string } | null;
}

interface FieldOccurrence {
  readonly name: "Base" | "Head" | "Verdict";
  readonly value: string;
  readonly line: number;
}

const verdicts: readonly ReviewPassVerdict[] = [
  "approved",
  "changes-requested",
  "skipped",
];

const fields = ["Base", "Head", "Verdict"] as const;

const fullCommit = (value: string): boolean => /^[0-9a-f]{40}$/.test(value);

const lineAtOffset = (source: string, offset: number): number =>
  source.slice(0, offset).split(/\r\n|\n|\r/).length;

const bodyLine = (artifact: RecognizedArtifact, index: number): number =>
  artifact.locations.body.startLine + index;

const visibleBody = (body: string): string => {
  let visible = body.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
  visible = visible.replace(/<!--?[\s\S]*$/g, (comment) =>
    comment.replace(/[^\r\n]/g, " "),
  );
  return visible;
};

const markdownHeadings = (source: string): readonly {
  readonly level: number;
  readonly text: string;
  readonly offset: number;
}[] => {
  const headings: Array<{
    readonly level: number;
    readonly text: string;
    readonly offset: number;
  }> = [];
  let offset = 0;
  let tokens: readonly Token[];
  try {
    tokens = marked.lexer(source);
  } catch {
    return headings;
  }
  for (const token of tokens) {
    const raw = "raw" in token && typeof token.raw === "string" ? token.raw : "";
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

const readHeadings = (artifact: RecognizedArtifact): readonly ReviewHeading[] => {
  const source = visibleBody(artifact.body);
  return markdownHeadings(source).map((heading) => {
    const line = lineAtOffset(source, heading.offset);
    return {
      ...heading,
      index: line - 1,
      line: bodyLine(artifact, line - 1),
    };
  });
};

const diagnostic = (
  artifact: RecognizedArtifact,
  code: ArtifactContractDiagnosticCode,
  message: string,
  line: number,
  options: {
    readonly field?: string;
    readonly expected?: string;
    readonly actual?: unknown;
    readonly actualPresent?: boolean;
  } = {},
): ArtifactContractDiagnostic => ({
  _tag: "ArtifactContractDiagnostic",
  code,
  message,
  sourcePath: artifact.sourcePath,
  ...(options.field === undefined ? {} : { field: options.field }),
  ...(options.expected === undefined ? {} : { expected: options.expected }),
  ...(options.actualPresent === true && options.actual !== undefined
    ? { actual: options.actual }
    : {}),
  location: { line },
});

const passHeadingNumber = (text: string): number | null => {
  const match = /^Pass ([1-9][0-9]*)\b/.exec(text);
  if (match === null) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number) ? number : null;
};

const parsedPassHeading = (
  text: string,
): { readonly number: number; readonly date: string } | null => {
  const match = /^Pass ([1-9][0-9]*) — ([0-9]{4}-[0-9]{2}-[0-9]{2})$/.exec(
    text,
  );
  if (match === null) return null;
  const number = Number(match[1]);
  return Number.isSafeInteger(number)
    ? { number, date: match[2] ?? "" }
    : null;
};

const passHeadings = (
  headings: readonly ReviewHeading[],
  lineCount: number,
): readonly PassHeading[] => {
  const levelTwo = headings.filter((heading) => heading.level === 2);
  return levelTwo
    .filter((heading) => heading.text.startsWith("Pass "))
    .map((heading) => ({
      heading,
      endIndex:
        levelTwo.find((candidate) => candidate.index > heading.index)?.index ??
        lineCount,
      number: passHeadingNumber(heading.text),
      parsed: parsedPassHeading(heading.text),
    }));
};

const fieldPattern = /^[ \t]*(Base|Head|Verdict):[ \t]*(.*)$/;

const fieldOccurrences = (
  lines: readonly string[],
  startIndex: number,
  endIndex: number,
  artifact: RecognizedArtifact,
): readonly FieldOccurrence[] => {
  const occurrences: FieldOccurrence[] = [];
  for (let index = startIndex; index < endIndex; index += 1) {
    const match = fieldPattern.exec(lines[index] ?? "");
    if (match === null) continue;
    occurrences.push({
      name: match[1] as FieldOccurrence["name"],
      value: match[2]?.trim() ?? "",
      line: bodyLine(artifact, index),
    });
  }
  return occurrences;
};

const isPassHeading = (heading: ReviewHeading): boolean =>
  heading.text.startsWith("Pass ");

const commentedPassDiagnostics = (
  artifact: RecognizedArtifact,
): readonly ArtifactContractDiagnostic[] => {
  const diagnostics: ArtifactContractDiagnostic[] = [];
  const comments = /<!--[\s\S]*?-->/g;
  let match: RegExpExecArray | null;
  while ((match = comments.exec(artifact.body)) !== null) {
    const inner = match[0].replace(/^<!--/, "").replace(/-->$/, "");
    for (const heading of markdownHeadings(inner)) {
      if (heading.text.startsWith("Pass "))
        diagnostics.push(
          diagnostic(
            artifact,
            "invalid-record",
            "Pass records cannot be declared in HTML comments",
            bodyLine(
              artifact,
              lineAtOffset(artifact.body, match.index + heading.offset) - 1,
            ),
            {
              expected: "## Pass N — YYYY-MM-DD",
              actual: heading.text,
            },
          ),
        );
    }
  }
  return diagnostics;
};

const fieldDiagnostic = (
  artifact: RecognizedArtifact,
  occurrence: FieldOccurrence,
): ArtifactContractDiagnostic =>
  diagnostic(
    artifact,
    "invalid-record",
    `${occurrence.name} must appear exactly once before child sections`,
    occurrence.line,
    {
      field: occurrence.name,
      expected: "Base, Head, Verdict",
      actual: occurrence.value,
      actualPresent: true,
    },
  );

const sectionDiagnostic = (
  artifact: RecognizedArtifact,
  code: ArtifactContractDiagnosticCode,
  message: string,
  line: number,
  expected?: string,
  actual?: unknown,
): ArtifactContractDiagnostic =>
  diagnostic(artifact, code, message, line, {
    expected,
    actual,
    actualPresent: actual !== undefined,
  });

const findingIsValid = (value: string): boolean => {
  const match = /^\[(.+)\] (.+)$/.exec(value);
  if (match === null) return false;
  const locations = match[1] ?? "";
  const action = match[2] ?? "";
  if (
    locations.includes("<") ||
    locations.includes(">") ||
    action.includes("<") ||
    action.includes(">")
  )
    return false;
  if (action.replace(/[\s\p{P}]/gu, "").toLowerCase() === "tbd") return false;
  return locations.split(";").every((location) => {
    const separator = location.indexOf(":");
    return separator > 0 && location.slice(separator + 1).trim() !== "";
  });
};

const sectionValues = (
  artifact: RecognizedArtifact,
  lines: readonly string[],
  headings: readonly ReviewHeading[],
  heading: ReviewHeading | undefined,
  endIndex: number,
  name: "Blocking" | "Suggestions",
): { readonly values: readonly string[]; readonly diagnostics: readonly ArtifactContractDiagnostic[] } => {
  if (heading === undefined)
    return {
      values: [],
      diagnostics: [
        sectionDiagnostic(
          artifact,
          "missing-section",
          `Pass must declare a ### ${name} section`,
          bodyLine(artifact, endIndex),
          `### ${name}`,
        ),
      ],
    };
  const nextHeading = headings.find(
    (candidate) => candidate.index > heading.index,
  );
  const sectionEnd = nextHeading?.index ?? endIndex;
  const entries = lines
    .slice(heading.index + 1, sectionEnd)
    .map((line, index) => ({ line: line.trim(), index: heading.index + 1 + index }))
    .filter((entry) => entry.line !== "");
  const diagnostics: ArtifactContractDiagnostic[] = [];
  const values: string[] = [];
  for (const entry of entries) {
    if (!entry.line.startsWith("- ") || entry.line.slice(2).trim() === "") {
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-value",
          `${name} entries must be non-empty list items`,
          bodyLine(artifact, entry.index),
          "- text",
          entry.line,
        ),
      );
      continue;
    }
    values.push(entry.line.slice(2).trim());
  }
  if (values.includes("None.") && values.length !== 1)
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-value",
        `${name} cannot combine None. with findings`,
        heading.line,
        "- None. or findings",
        values,
      ),
    );
  return { values, diagnostics };
};

const parsePass = (
  artifact: RecognizedArtifact,
  lines: readonly string[],
  headings: readonly ReviewHeading[],
  candidate: PassHeading,
  compatibility: boolean,
): { readonly evidence?: ReviewPassEvidence; readonly diagnostics: readonly ArtifactContractDiagnostic[] } => {
  const diagnostics: ArtifactContractDiagnostic[] = [];
  if (candidate.parsed === null) {
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-record",
        "Malformed pass record",
        candidate.heading.line,
        "## Pass N — YYYY-MM-DD",
        candidate.heading.text,
      ),
    );
    return { diagnostics };
  }
  const spanHeadings = headings.filter(
    (heading) =>
      heading.index > candidate.heading.index &&
      heading.index < candidate.endIndex &&
      heading.level !== 2,
  );
  for (const heading of spanHeadings) {
    if (
      heading.level !== 3 ||
      (heading.text !== "Blocking" && heading.text !== "Suggestions")
    )
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-record",
          "Pass records may only declare Blocking and Suggestions child sections",
          heading.line,
          "### Blocking | ### Suggestions",
          heading.text,
        ),
      );
  }
  const childHeadings = spanHeadings.filter((heading) => heading.level === 3);
  const blockingHeadings = childHeadings.filter(
    (heading) => heading.text === "Blocking",
  );
  const suggestionHeadings = childHeadings.filter(
    (heading) => heading.text === "Suggestions",
  );
  if (blockingHeadings.length > 1)
    for (const heading of blockingHeadings.slice(1))
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-record",
          "Pass may declare only one Blocking section",
          heading.line,
          "### Blocking",
          heading.text,
        ),
      );
  if (suggestionHeadings.length > 1)
    for (const heading of suggestionHeadings.slice(1))
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-record",
          "Pass may declare only one Suggestions section",
          heading.line,
          "### Suggestions",
          heading.text,
        ),
      );
  const firstChildIndex = spanHeadings.at(0)?.index ?? candidate.endIndex;
  const beforeFields = fieldOccurrences(
    lines,
    candidate.heading.index + 1,
    firstChildIndex,
    artifact,
  );
  const afterFields = fieldOccurrences(
    lines,
    firstChildIndex,
    candidate.endIndex,
    artifact,
  );
  for (const occurrence of afterFields)
    diagnostics.push(fieldDiagnostic(artifact, occurrence));
  for (let index = candidate.heading.index + 1; index < firstChildIndex; index += 1) {
    if (fieldPattern.test(lines[index] ?? "")) continue;
    if ((lines[index] ?? "").trim() !== "")
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-record",
          "Pass provenance must appear before child sections",
          bodyLine(artifact, index),
          "Base, Head, Verdict",
          (lines[index] ?? "").trim(),
        ),
      );
  }
  const counts = new Map<string, number>();
  for (const occurrence of beforeFields)
    counts.set(occurrence.name, (counts.get(occurrence.name) ?? 0) + 1);
  if (!compatibility) {
    for (const name of fields) {
      const count = counts.get(name) ?? 0;
      if (count === 0)
        diagnostics.push(
          sectionDiagnostic(
            artifact,
            "missing-section",
            `Pass must declare exactly one ${name} field before child sections`,
            candidate.heading.line,
            `${name}: <value>`,
          ),
        );
      if (count > 1) {
        const occurrences = beforeFields.filter(
          (field) => field.name === name,
        );
        for (const occurrence of occurrences.slice(1))
          diagnostics.push(fieldDiagnostic(artifact, occurrence));
      }
    }
    if (beforeFields.length === fields.length && fields.every((name) => (counts.get(name) ?? 0) === 1)) {
      for (let index = 0; index < fields.length; index += 1) {
        if (beforeFields[index]?.name !== fields[index])
          diagnostics.push(
            fieldDiagnostic(artifact, beforeFields[index] as FieldOccurrence),
          );
      }
    }
  } else if (
    beforeFields.length > 0 &&
    !(
      beforeFields.length === fields.length &&
      fields.every((name, index) => beforeFields[index]?.name === name) &&
      beforeFields[0]?.value === artifact.metadata.base &&
      beforeFields[1]?.value === artifact.metadata.head &&
      beforeFields[2]?.value === artifact.metadata.verdict
    )
  ) {
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-record",
        "Global provenance is ambiguous with per-pass provenance",
        candidate.heading.line,
        "one-pass global Base, Head, and Verdict",
      ),
    );
  }
  const blockingHeading = blockingHeadings[0];
  const suggestionsHeading = suggestionHeadings[0];
  if (
    blockingHeading !== undefined &&
    suggestionsHeading !== undefined &&
    blockingHeading.index > suggestionsHeading.index
  )
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-record",
        "Blocking must appear before Suggestions",
        suggestionsHeading.line,
        "### Blocking followed by ### Suggestions",
        suggestionsHeading.text,
      ),
    );
  const blocking = sectionValues(
    artifact,
    lines,
    spanHeadings,
    blockingHeading,
    candidate.endIndex,
    "Blocking",
  );
  const suggestions = sectionValues(
    artifact,
    lines,
    spanHeadings,
    suggestionsHeading,
    candidate.endIndex,
    "Suggestions",
  );
  diagnostics.push(...blocking.diagnostics, ...suggestions.diagnostics);
  let base: string | undefined;
  let head: string | undefined;
  let verdict: ReviewPassVerdict | undefined;
  if (compatibility) {
    const globalBase = artifact.metadata.base;
    const globalHead = artifact.metadata.head;
    const globalVerdict = artifact.metadata.verdict;
    if (typeof globalBase !== "string" || !fullCommit(globalBase))
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-value",
          "Global base must be a full lowercase commit identifier",
          artifact.locations.metadata.startLine,
          "40 hexadecimal characters",
          globalBase,
        ),
      );
    else base = globalBase;
    if (typeof globalHead !== "string" || !fullCommit(globalHead))
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-value",
          "Global head must be a full lowercase commit identifier",
          artifact.locations.metadata.startLine,
          "40 hexadecimal characters",
          globalHead,
        ),
      );
    else head = globalHead;
    if (
      typeof globalVerdict !== "string" ||
      !verdicts.includes(globalVerdict as ReviewPassVerdict)
    )
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-value",
          "Global verdict is not allowed",
          artifact.locations.metadata.startLine,
          verdicts.join(" | "),
          globalVerdict,
        ),
      );
    else verdict = globalVerdict as ReviewPassVerdict;
  } else {
    const valueByName = new Map(
      beforeFields.map((occurrence) => [occurrence.name, occurrence.value]),
    );
    const baseValue = valueByName.get("Base");
    const headValue = valueByName.get("Head");
    const verdictValue = valueByName.get("Verdict");
    if (baseValue !== undefined) {
      if (!fullCommit(baseValue))
        diagnostics.push(
          sectionDiagnostic(
            artifact,
            "invalid-value",
            "Base must be a full lowercase commit identifier",
            beforeFields.find((field) => field.name === "Base")?.line ??
              candidate.heading.line,
            "40 hexadecimal characters",
            baseValue,
          ),
        );
      else base = baseValue;
    }
    if (headValue !== undefined) {
      if (!fullCommit(headValue))
        diagnostics.push(
          sectionDiagnostic(
            artifact,
            "invalid-value",
            "Head must be a full lowercase commit identifier",
            beforeFields.find((field) => field.name === "Head")?.line ??
              candidate.heading.line,
            "40 hexadecimal characters",
            headValue,
          ),
        );
      else head = headValue;
    }
    if (verdictValue !== undefined) {
      if (!verdicts.includes(verdictValue as ReviewPassVerdict))
        diagnostics.push(
          sectionDiagnostic(
            artifact,
            "invalid-value",
            "Verdict is not allowed",
            beforeFields.find((field) => field.name === "Verdict")?.line ??
              candidate.heading.line,
            verdicts.join(" | "),
            verdictValue,
          ),
        );
      else verdict = verdictValue as ReviewPassVerdict;
    }
  }
  if (base === undefined || head === undefined || verdict === undefined)
    return { diagnostics };
  const blockingIsNone =
    blocking.values.length === 0 ||
    (blocking.values.length === 1 && blocking.values[0] === "None.");
  if (verdict === "approved" && !blockingIsNone)
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-value",
        "Approved passes cannot contain blocking findings",
        blockingHeading?.line ?? candidate.heading.line,
        "- None.",
        blocking.values,
      ),
    );
  if (verdict === "changes-requested" && blockingIsNone)
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-value",
        "Changes-requested passes must contain a blocking finding",
        blockingHeading?.line ?? candidate.heading.line,
        "blocking finding",
        blocking.values,
      ),
    );
  if (
    blocking.values.length > 0 &&
    blocking.values[0] !== "None." &&
    !blocking.values.every((value) => findingIsValid(value))
  )
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-value",
        "Blocking findings must identify a location and action",
        blockingHeading?.line ?? candidate.heading.line,
        "[path:line] action",
        blocking.values,
      ),
    );
  if (diagnostics.length > 0) return { diagnostics };
  return {
    evidence: {
      number: candidate.parsed.number,
      date: candidate.parsed.date,
      base,
      head,
      verdict,
      blocking:
        blocking.values.length === 1 && blocking.values[0] === "None."
          ? []
          : blocking.values,
      suggestions:
        suggestions.values.length === 1 && suggestions.values[0] === "None."
          ? []
          : suggestions.values,
      line: candidate.heading.line,
    },
    diagnostics,
  };
};

const globalFieldPresence = (artifact: RecognizedArtifact): number =>
  ["base", "head", "verdict"].filter((field) =>
    Object.hasOwn(artifact.metadata, field),
  ).length;

export const parseReviewPasses = (
  artifact: RecognizedArtifact,
): ReviewPassParseResult => {
  const headings = readHeadings(artifact);
  const lines = visibleBody(artifact.body).split(/\r\n|\n|\r/);
  const candidates = passHeadings(headings, lines.length);
  const diagnostics: ArtifactContractDiagnostic[] = [
    ...commentedPassDiagnostics(artifact),
  ];
  for (const heading of headings.filter(isPassHeading))
    if (heading.level !== 2)
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "invalid-record",
          "Pass records must use level 2 headings",
          heading.line,
          "## Pass N — YYYY-MM-DD",
          heading.text,
        ),
      );
  for (const heading of headings.filter(
    (candidate) => candidate.level === 2 && !isPassHeading(candidate),
  ))
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-record",
        "Review bodies may only declare level 2 Pass headings",
        heading.line,
        "## Pass N — YYYY-MM-DD",
        heading.text,
      ),
    );
  if (candidates.length === 0)
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "missing-section",
        "Body must declare at least one Pass record",
        artifact.locations.body.startLine,
        "## Pass N — YYYY-MM-DD",
      ),
    );
  const numbered = candidates.flatMap((candidate) =>
    candidate.parsed === null ? [] : [candidate],
  );
  for (let index = 0; index < numbered.length; index += 1) {
    const expected = index + 1;
    const actual = numbered[index]?.parsed?.number;
    if (actual !== expected) {
      diagnostics.push(
        sectionDiagnostic(
          artifact,
          "non-monotonic-record",
          "Pass numbering must be append-only and contiguous",
          numbered[index]?.heading.line ?? artifact.locations.body.startLine,
          String(expected),
          actual,
        ),
      );
      break;
    }
  }
  const lastLevelTwo = headings.filter((heading) => heading.level === 2).at(-1);
  const lastPass = candidates.at(-1);
  if (lastPass !== undefined && lastLevelTwo?.index !== lastPass.heading.index)
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-record",
        "The latest pass must be the physical last pass",
        lastLevelTwo?.line ?? lastPass.heading.line,
        "physical last pass",
        lastLevelTwo?.text,
      ),
    );
  const globalCount = globalFieldPresence(artifact);
  if (globalCount > 0 && globalCount < 3)
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-record",
        "Global review provenance must contain Base, Head, and Verdict together",
        artifact.locations.metadata.startLine,
        "Base, Head, and Verdict",
      ),
    );
  if (globalCount === 3 && candidates.length !== 1)
    diagnostics.push(
      sectionDiagnostic(
        artifact,
        "invalid-record",
        "Global review provenance is supported only for one unambiguous pass",
        artifact.locations.metadata.startLine,
        "one pass",
        candidates.length,
      ),
    );
  const compatibility = globalCount === 3 && candidates.length === 1;
  const passes: ReviewPassEvidence[] = [];
  for (const candidate of candidates) {
    const parsed = parsePass(
      artifact,
      lines,
      headings,
      candidate,
      compatibility,
    );
    diagnostics.push(...parsed.diagnostics);
    if (parsed.evidence !== undefined) passes.push(parsed.evidence);
  }
  const physicalLastPass = lastPass?.number ?? undefined;
  const latest =
    diagnostics.length === 0 &&
    passes.length === candidates.length &&
    passes.at(-1)?.number === physicalLastPass
      ? passes.at(-1)
      : undefined;
  return {
    passes,
    diagnostics,
    ...(physicalLastPass === undefined ? {} : { physicalLastPass }),
    ...(latest === undefined ? {} : { latest }),
  };
};
