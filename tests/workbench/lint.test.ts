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

const proposal = (
  body = "# Proposal: Demo\n## Why\n## Goals & Success Criteria\n## Non-Goals\n## Proposed Change\n## Capabilities\n## Impact\n",
) =>
  `---\nartifact: proposal\nchange: demo\nstatus: approved\ndecision: accepted\nauthor: caio\ncreated: 2026-09-12\nroute_unit: null\n---\n${body}`;

type ReviewArtifactKind = "feedback" | "review";

type ReviewGlobals = {
  readonly base?: string;
  readonly head?: string;
  readonly verdict?: string;
};

const reviewBase = "0123456789abcdef0123456789abcdef01234567";
const reviewHead = "fedcba9876543210fedcba9876543210fedcba98";
const reviewNext = "abcdef0123456789abcdef0123456789abcdef01";

const reviewPass = ({
  number,
  date,
  base = reviewBase,
  head = reviewHead,
  verdict,
  blocking = ["None."],
  suggestions = ["None."],
  fields = true,
}: {
  readonly number: number;
  readonly date: string;
  readonly base?: string;
  readonly head?: string;
  readonly verdict: string;
  readonly blocking?: readonly string[];
  readonly suggestions?: readonly string[];
  readonly fields?: boolean;
}) =>
  [
    `## Pass ${number} — ${date}`,
    "",
    ...(fields
      ? [`Base: ${base}`, `Head: ${head}`, `Verdict: ${verdict}`, ""]
      : []),
    "### Blocking",
    ...blocking.map((value) => `- ${value}`),
    "",
    "### Suggestions",
    ...suggestions.map((value) => `- ${value}`),
  ].join("\n");

const compatibilityPass = (number: number, date: string) =>
  reviewPass({ number, date, verdict: "approved", fields: false });

const reviewSource = (
  kind: ReviewArtifactKind,
  body: string,
  globals: ReviewGlobals = {},
) => {
  const globalLines = [
    globals.base === undefined ? [] : [`base: ${globals.base}`],
    globals.head === undefined ? [] : [`head: ${globals.head}`],
    globals.verdict === undefined ? [] : [`verdict: ${globals.verdict}`],
  ].flat();
  const metadata =
    kind === "feedback"
      ? [
          "artifact: feedback",
          "change: demo",
          "task: 1",
          "created: 2026-09-12",
          "status: resolved",
          "decision: accepted",
        ]
      : [
          "artifact: review",
          "change: demo",
          "created: 2026-09-12",
          "status: complete",
          "decision: accepted",
        ];
  const title =
    kind === "feedback"
      ? "# Code Feedback: Task 1 — Demo"
      : "# Whole-branch Review: Demo";
  return ["---", ...metadata, ...globalLines, "---", title, "", body, ""].join(
    "\n",
  );
};

const writeReviewArtifact = async (
  kind: ReviewArtifactKind,
  body: string,
  globals: ReviewGlobals = {},
) => {
  const directory = await temporaryDirectory();
  const file =
    kind === "feedback"
      ? Path.join(
          directory,
          ".hamilton",
          "changes",
          "demo",
          "tasks",
          "task-1",
          "feedback.md",
        )
      : Path.join(directory, ".hamilton", "changes", "demo", "review.md");
  const source = reviewSource(kind, body, globals);
  await Fs.mkdir(Path.dirname(file), { recursive: true });
  await Fs.writeFile(file, source);
  return { file, source };
};

const sourceLine = (
  source: string,
  text: string,
  occurrence = 0,
): number => {
  let offset = -1;
  let start = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    offset = source.indexOf(text, start);
    start = offset + text.length;
  }
  return source.slice(0, offset).split(/\r\n|\n|\r/).length;
};

const reviewTitle = (kind: ReviewArtifactKind): string =>
  kind === "feedback"
    ? "# Code Feedback: Task 1 — Demo"
    : "# Whole-branch Review: Demo";

type LineLocator = (source: string, kind: ReviewArtifactKind) => number;

const parserFailureCases: readonly {
  readonly name: string;
  readonly body: string;
  readonly globals?: ReviewGlobals;
  readonly code: string;
  readonly message: string;
  readonly line: LineLocator;
}[] = [
  {
    name: "missing pass record",
    body: "### Blocking\n- None.\n\n### Suggestions\n- None.",
    code: "missing-section",
    message: "Body must declare at least one Pass record",
    line: (source, kind) => sourceLine(source, reviewTitle(kind)),
  },
  {
    name: "malformed pass heading",
    body: "## Pass 1\n\n### Blocking\n- None.\n\n### Suggestions\n- None.",
    code: "invalid-record",
    message: "Malformed pass record",
    line: (source) => sourceLine(source, "## Pass 1"),
  },
  {
    name: "nested pass heading",
    body: "### Pass 1 — 2026-09-12\n\n### Blocking\n- None.\n\n### Suggestions\n- None.",
    code: "invalid-record",
    message: "Pass records must use level 2 headings",
    line: (source) => sourceLine(source, "### Pass 1"),
  },
  {
    name: "unexpected level two heading",
    body: [
      "## Overview",
      "Text",
      "",
      reviewPass({ number: 1, date: "2026-09-12", verdict: "approved" }),
    ].join("\n"),
    code: "invalid-record",
    message: "Review bodies may only declare level 2 Pass headings",
    line: (source) => sourceLine(source, "## Overview"),
  },
  {
    name: "non-contiguous pass numbering",
    body: [
      reviewPass({ number: 1, date: "2026-09-12", verdict: "approved" }),
      reviewPass({ number: 3, date: "2026-09-13", verdict: "approved" }),
    ].join("\n\n"),
    code: "non-monotonic-record",
    message: "Pass numbering must be append-only and contiguous",
    line: (source) => sourceLine(source, "## Pass 3"),
  },
  {
    name: "pass is not physically last",
    body: [
      reviewPass({ number: 1, date: "2026-09-12", verdict: "approved" }),
      "## Notes\nText",
    ].join("\n\n"),
    code: "invalid-record",
    message: "The latest pass must be the physical last pass",
    line: (source) => sourceLine(source, "## Notes"),
  },
  {
    name: "pass in an HTML comment",
    body: [
      "<!--",
      "## Pass 99 — 2026-09-01",
      "-->",
      "",
      reviewPass({ number: 1, date: "2026-09-12", verdict: "approved" }),
    ].join("\n"),
    code: "invalid-record",
    message: "Pass records cannot be declared in HTML comments",
    line: (source) => sourceLine(source, "<!--"),
  },
  {
    name: "partial global provenance",
    body: reviewPass({ number: 1, date: "2026-09-12", verdict: "approved" }),
    globals: { base: reviewBase },
    code: "invalid-record",
    message:
      "Global review provenance must contain Base, Head, and Verdict together",
    line: (source) => sourceLine(source, "artifact:"),
  },
  {
    name: "unsupported child heading",
    body: [
      "## Pass 1 — 2026-09-12",
      "",
      `Base: ${reviewBase}`,
      `Head: ${reviewHead}`,
      "Verdict: approved",
      "",
      "### Notes",
      "Text",
      "",
      "### Blocking",
      "- None.",
      "",
      "### Suggestions",
      "- None.",
    ].join("\n"),
    code: "invalid-record",
    message:
      "Pass records may only declare Blocking and Suggestions child sections",
    line: (source) => sourceLine(source, "### Notes"),
  },
  {
    name: "duplicate blocking section",
    body: [
      "## Pass 1 — 2026-09-12",
      "",
      `Base: ${reviewBase}`,
      `Head: ${reviewHead}`,
      "Verdict: approved",
      "",
      "### Blocking",
      "- None.",
      "",
      "### Blocking",
      "- None.",
      "",
      "### Suggestions",
      "- None.",
    ].join("\n"),
    code: "invalid-record",
    message: "Pass may declare only one Blocking section",
    line: (source) => sourceLine(source, "### Blocking", 1),
  },
  {
    name: "provenance after child sections",
    body: [
      "## Pass 1 — 2026-09-12",
      "",
      "### Blocking",
      "- None.",
      "",
      `Base: ${reviewBase}`,
      `Head: ${reviewHead}`,
      "Verdict: approved",
      "",
      "### Suggestions",
      "- None.",
    ].join("\n"),
    code: "invalid-record",
    message: "Base must appear exactly once before child sections",
    line: (source) => sourceLine(source, `Base: ${reviewBase}`),
  },
  {
    name: "missing pass field",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
    }).replace("Verdict: approved\n", ""),
    code: "missing-section",
    message: "Pass must declare exactly one Verdict field before child sections",
    line: (source) => sourceLine(source, "## Pass 1"),
  },
  {
    name: "pass fields in the wrong order",
    body: [
      "## Pass 1 — 2026-09-12",
      "",
      "Verdict: approved",
      `Base: ${reviewBase}`,
      `Head: ${reviewHead}`,
      "",
      "### Blocking",
      "- None.",
      "",
      "### Suggestions",
      "- None.",
    ].join("\n"),
    code: "invalid-record",
    message: "Verdict must appear exactly once before child sections",
    line: (source) => sourceLine(source, "Verdict: approved"),
  },
  {
    name: "invalid pass base",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
      base: "short",
    }),
    code: "invalid-value",
    message: "Base must be a full lowercase commit identifier",
    line: (source) => sourceLine(source, "Base: short"),
  },
  {
    name: "invalid pass head",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
      head: "short",
    }),
    code: "invalid-value",
    message: "Head must be a full lowercase commit identifier",
    line: (source) => sourceLine(source, "Head: short"),
  },
  {
    name: "invalid pass verdict",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "pending",
    }),
    code: "invalid-value",
    message: "Verdict is not allowed",
    line: (source) => sourceLine(source, "Verdict: pending"),
  },
  {
    name: "missing blocking section",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
    })
      .replace("### Blocking\n- None.\n\n", "")
      .replace("### Suggestions\n- None.", "### Suggestions\n- None.\n\n## End"),
    code: "missing-section",
    message: "Pass must declare a ### Blocking section",
    line: (source) => sourceLine(source, "## End"),
  },
  {
    name: "missing suggestions section",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
    }).replace("### Suggestions\n- None.", "## End"),
    code: "missing-section",
    message: "Pass must declare a ### Suggestions section",
    line: (source) => sourceLine(source, "## End"),
  },
  {
    name: "blocking after suggestions",
    body: [
      "## Pass 1 — 2026-09-12",
      "",
      `Base: ${reviewBase}`,
      `Head: ${reviewHead}`,
      "Verdict: approved",
      "",
      "### Suggestions",
      "- None.",
      "",
      "### Blocking",
      "- None.",
    ].join("\n"),
    code: "invalid-record",
    message: "Blocking must appear before Suggestions",
    line: (source) => sourceLine(source, "### Suggestions"),
  },
  {
    name: "invalid blocking list entry",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
      blocking: ["not a list item"],
    }).replace("- not a list item", "not a list item"),
    code: "invalid-value",
    message: "Blocking entries must be non-empty list items",
    line: (source) => sourceLine(source, "not a list item"),
  },
  {
    name: "None combined with blocking findings",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
      blocking: ["None.", "[src/file.ts:10] Fix the issue."],
    }),
    code: "invalid-value",
    message: "Blocking cannot combine None. with findings",
    line: (source) => sourceLine(source, "### Blocking"),
  },
  {
    name: "approved pass with blocking finding",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
      blocking: ["[src/file.ts:10] Fix the issue."],
    }),
    code: "invalid-value",
    message: "Approved passes cannot contain blocking findings",
    line: (source) => sourceLine(source, "### Blocking"),
  },
  {
    name: "changes requested without blocking finding",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "changes-requested",
    }),
    code: "invalid-value",
    message: "Changes-requested passes must contain a blocking finding",
    line: (source) => sourceLine(source, "### Blocking"),
  },
  {
    name: "malformed blocking finding",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "changes-requested",
      blocking: ["TBD"],
    }),
    code: "invalid-value",
    message: "Blocking findings must identify a location and action",
    line: (source) => sourceLine(source, "### Blocking"),
  },
  {
    name: "ambiguous global and pass provenance",
    body: reviewPass({
      number: 1,
      date: "2026-09-12",
      verdict: "approved",
      base: reviewHead,
      head: reviewNext,
    }),
    globals: { base: reviewBase, head: reviewHead, verdict: "approved" },
    code: "invalid-record",
    message:
      "Global review provenance cannot be combined with an explicit pass suffix",
    line: (source) => sourceLine(source, "artifact:"),
  },
  {
    name: "invalid global base",
    body: compatibilityPass(1, "2026-09-12"),
    globals: { base: "short", head: reviewHead, verdict: "approved" },
    code: "invalid-value",
    message: "Global base must be a full lowercase commit identifier",
    line: (source) => sourceLine(source, "artifact:"),
  },
  {
    name: "invalid global head",
    body: compatibilityPass(1, "2026-09-12"),
    globals: { base: reviewBase, head: "short", verdict: "approved" },
    code: "invalid-value",
    message: "Global head must be a full lowercase commit identifier",
    line: (source) => sourceLine(source, "artifact:"),
  },
  {
    name: "invalid global verdict",
    body: compatibilityPass(1, "2026-09-12"),
    globals: { base: reviewBase, head: reviewHead, verdict: "pending" },
    code: "invalid-value",
    message: "Global verdict is not allowed",
    line: (source) => sourceLine(source, "artifact:"),
  },
];

const expectExit = (result: LintResult, exitCode: 0 | 1 | 2) => {
  expect(result.exitCode).toBe(exitCode);
  expect(renderLintResult(result)).toContain(
    `lint: ${exitCode === 0 ? "success" : exitCode === 1 ? "findings" : "invalid scope"}`,
  );
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => Fs.rm(directory, { recursive: true, force: true })),
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
    expectExit(
      await lintScope({ file, changeDir: directory }, { fileSystem }),
      2,
    );
    expect(reads).toBe(0);
  });

  it("rejects missing and non-regular file or directory scopes", async () => {
    const directory = await temporaryDirectory();
    const file = Path.join(directory, "artifact.md");
    await Fs.writeFile(file, "text");
    expectExit(
      await lintScope({ file: Path.join(directory, "missing.md") }),
      2,
    );
    expectExit(await lintScope({ file: directory }), 2);
    expectExit(
      await lintScope({ changeDir: Path.join(directory, "missing") }),
      2,
    );
    expectExit(await lintScope({ changeDir: file }), 2);
  });

  it("validates only the selected regular file", async () => {
    const directory = await temporaryDirectory();
    const file = Path.join(
      directory,
      ".hamilton",
      "changes",
      "demo",
      "proposal.md",
    );
    const outside = Path.join(directory, "outside.md");
    await Fs.mkdir(Path.dirname(file), { recursive: true });
    await Fs.writeFile(file, proposal());
    await Fs.writeFile(outside, "# unrelated");
    const result = await lintScope({ file });
    expectExit(result, 0);
    expect(result.findings.map((finding) => finding.sourcePath)).toEqual([
      file,
    ]);
    expect(result.findings[0]?.kind).toBe("success");
  });

  it("recursively considers nested regular files and ignores outside symlinks", async () => {
    const directory = await temporaryDirectory();
    const changeDirectory = Path.join(
      directory,
      ".hamilton",
      "changes",
      "demo",
    );
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
    expect(
      result.findings.filter((finding) => finding.kind === "error").length,
    ).toBeGreaterThan(1);
    expect(
      result.findings.every(
        (finding) => finding.sourcePath === file && finding.line > 0,
      ),
    ).toBe(true);
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
    const paths = result.findings
      .filter((finding) => finding.kind === "error")
      .map((finding) => finding.sourcePath);
    expect(paths).toEqual([...paths].sort());
    expect(renderLintResult(result).indexOf(first)).toBeLessThan(
      renderLintResult(result).indexOf(second),
    );
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

  it.each(parserFailureCases)(
    "surfaces $name parser diagnostics for feedback and review",
    async (failure) => {
      for (const kind of ["feedback", "review"] as const) {
        const artifact = await writeReviewArtifact(
          kind,
          failure.body,
          failure.globals,
        );
        const result = await lintScope({ file: artifact.file });
        expectExit(result, 1);
        const line = failure.line(artifact.source, kind);
        expect(result.findings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              kind: "error",
              sourcePath: artifact.file,
              code: failure.code,
              message: failure.message,
              line,
            }),
          ]),
        );
        expect(renderLintResult(result)).toContain(
          `ERROR ${artifact.file}:${line} [${failure.code}] ${failure.message}`,
        );
      }
    },
  );

  it("accepts valid multi-pass feedback and review evidence", async () => {
    const body = [
      reviewPass({
        number: 1,
        date: "2026-09-12",
        base: reviewBase,
        head: reviewHead,
        verdict: "changes-requested",
        blocking: ["[src/file.ts:10] Fix the issue."],
      }),
      reviewPass({
        number: 2,
        date: "2026-09-13",
        base: reviewHead,
        head: reviewNext,
        verdict: "approved",
      }),
    ].join("\n\n");
    for (const kind of ["feedback", "review"] as const) {
      const artifact = await writeReviewArtifact(kind, body);
      const result = await lintScope({ file: artifact.file });
      expectExit(result, 0);
      expect(result.findings).toEqual([
        expect.objectContaining({
          kind: "success",
          sourcePath: artifact.file,
          code: "valid",
        }),
      ]);
    }
  });

  it("accepts legacy global evidence only on the physical latest pass", async () => {
    const globals = {
      base: reviewBase,
      head: reviewHead,
      verdict: "approved",
    };
    for (const kind of ["feedback", "review"] as const) {
      const single = await writeReviewArtifact(
        kind,
        compatibilityPass(1, "2026-09-12"),
        globals,
      );
      expectExit(await lintScope({ file: single.file }), 0);

      const multiple = await writeReviewArtifact(
        kind,
        [
          reviewPass({
            number: 1,
            date: "2026-09-12",
            verdict: "changes-requested",
            blocking: ["[src/file.ts:10] Fix the issue."],
            fields: false,
          }),
          compatibilityPass(2, "2026-09-13"),
        ].join("\n\n"),
        globals,
      );
      expectExit(await lintScope({ file: multiple.file }), 0);
    }
  });

  it("accepts a migrated fieldless prefix with an explicit suffix", async () => {
    const body = [
      reviewPass({
        number: 1,
        date: "2026-09-12",
        verdict: "changes-requested",
        blocking: ["[src/file.ts:10] Fix the issue."],
        fields: false,
      }),
      reviewPass({
        number: 2,
        date: "2026-09-13",
        base: reviewHead,
        head: reviewNext,
        verdict: "approved",
      }),
    ].join("\n\n");
    for (const kind of ["feedback", "review"] as const) {
      const artifact = await writeReviewArtifact(kind, body);
      expectExit(await lintScope({ file: artifact.file }), 0);
    }
  });
});
