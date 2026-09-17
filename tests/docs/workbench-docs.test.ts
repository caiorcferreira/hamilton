import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const documents = ["README.md", "docs/modes.md", "docs/skills.md", "docs/sdd-framework.md"];
const content = Object.fromEntries(
  documents.map((document) => [document, readFileSync(resolve(root, document), "utf8")]),
);
const specifications = [
  ".hamilton/specs/artifact-templates.md",
  ".hamilton/specs/review.md",
  ".hamilton/specs/workbench.md",
];
const specificationContent = Object.fromEntries(
  specifications.map((document) => [document, readFileSync(resolve(root, document), "utf8")]),
);
const allDocumentation = Object.values(content).join("\n");
const contractDocuments = [
  ...specifications,
  "docs/sdd-framework.md",
  "docs/skills.md",
] as const;
const contractContent = Object.fromEntries(
  contractDocuments.map((document) => [
    document,
    document in specificationContent
      ? specificationContent[document]
      : content[document],
  ]),
);

const workbenchSubcommands = ["isolate", "diff", "precondition", "context", "prototype", "lint"];

describe("workbench documentation", () => {
  it("describes setup without installing helper scripts", () => {
    expect(content["README.md"]).toMatch(/hamilton setup.*templates.*guidelines/s);
    expect(content["README.md"]).toMatch(/hamilton workbench/);
    expect(allDocumentation).not.toMatch(/~\/\.hamilton\/scripts\//);
    expect(allDocumentation).not.toMatch(
      /hamilton-(artifact-contracts|change-context|diff-package|isolate|precondition-check|prototype-branch)\.sh/,
    );
  });

  it("names the supported workbench operations and lint scope", () => {
    for (const subcommand of workbenchSubcommands) {
      expect(allDocumentation).toMatch(new RegExp(`hamilton workbench[^\\n]*${subcommand}`));
    }
    expect(allDocumentation).toMatch(/hamilton workbench lint --file <file>/);
    expect(allDocumentation).toMatch(/hamilton workbench lint --change-dir <dir>/);
    expect(allDocumentation).toMatch(/exactly one/);
    expect(allDocumentation).toMatch(/recurs/);
    expect(allDocumentation).toMatch(/skipp/);
    expect(allDocumentation).toMatch(/warning/);
    expect(allDocumentation).toMatch(/fail.?closed/);
  });

  it("documents the between-changes migration", () => {
    expect(allDocumentation).toMatch(/CLI and (?:the )?(?:agent-loaded )?skills.*together/i);
    expect(allDocumentation).toMatch(/run `?hamilton setup`?/i);
    expect(allDocumentation).toMatch(/(?:stale helper files.*(?:not|no longer).*delet|(?:not|does not).*delet.*stale helper files)/i);
    expect(allDocumentation).toMatch(/hamilton purge/);
  });

  it.each(contractDocuments)(
    "defines review history modes and evidence authority independently in %s",
    (document) => {
      const value = contractContent[document];
      expect(value).toMatch(/legacy-global/);
      expect(value).toMatch(/transitioned/);
      expect(value).toMatch(/modern/);
      expect(value).toMatch(
        /only fully evidenced feedback and review passes carry[^.\n]*Base[^.\n]*Head[^.\n]*Verdict/i,
      );
      expect(value).toMatch(
        /structural\s+legacy\s+records\s+are\s+provenance-free,\s*cannot\s+supply\s+a\s+verdict,\s*and\s+remain\s+distinct\s+from\s+the\s+authoritative\s+latest\s+evidenced\s+record/i,
      );
      expect(value).toMatch(/physical(?:ly)? latest.*evidenced.*(?:pass|record).*authoritative|govern/i);
      expect(value).not.toMatch(/\b(?:every|each) pass\b[^.\n]*(?:Base|Head|Verdict)/i);
    },
  );

  it.each(contractDocuments)(
    "documents the atomic first append and strict suffix independently in %s",
    (document) => {
      const value = contractContent[document];
      expect(value).toMatch(/first modern append/i);
      expect(value).toMatch(/remove(?:s|d)? exactly the global provenance/i);
      expect(value).toMatch(/preserv(?:e|es|ing).*pass bod(?:y|ies).*byte-for-byte/i);
      expect(value).toMatch(/later (?:appends?|pass(?:es)?).*pass-local/i);
      expect(value).toMatch(/malformed.*transition.*fail(?:s|ing)? closed/i);
    },
  );

  it.each(contractDocuments)(
    "keeps review evidence append-only and value-typed independently in %s",
    (document) => {
      const value = contractContent[document];
      expect(value).toMatch(/append-only.*(?:file|history)/is);
      expect(value).toMatch(
        /(?:`)?Base(?:`)?\s+and\s+(?:`)?Head(?:`)?\s+contain full commit identifiers/i,
      );
      expect(value).toMatch(
        /(?:`)?Verdict(?:`)?\s+contains (?:(?:an|the) )?allowed verdict enum value/i,
      );
      expect(value).not.toMatch(
        /full commit identifiers?[^.\n]*(?:,\s*and\s+|and\s+)`?Verdict:?`?/i,
      );
    },
  );
});
