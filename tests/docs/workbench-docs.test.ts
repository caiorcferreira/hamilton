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
const allContractDocumentation = [
  ...Object.values(content),
  ...Object.values(specificationContent),
].join("\n");

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

  it("defines the three review history modes and evidence authority", () => {
    expect(allContractDocumentation).toMatch(/legacy-global/);
    expect(allContractDocumentation).toMatch(/structural/);
    expect(allContractDocumentation).toMatch(/transitioned/);
    expect(allContractDocumentation).toMatch(/global.*(?:bind|apply).*physical(?:ly)? last.*legacy/i);
    expect(allContractDocumentation).toMatch(/structural.*(?:history|prefix).*(?:without|not).*verdict/i);
    expect(allContractDocumentation).toMatch(/fully evidenced.*(?:verdict|record)/i);
  });

  it("documents the atomic first append and strict suffix", () => {
    expect(allContractDocumentation).toMatch(
      /first modern append.*remove.*global.*preserv(?:e|ing).*pass bod(?:y|ies).*explicit suffix/is,
    );
    expect(allContractDocumentation).toMatch(/later appends?.*pass-local/i);
    expect(allContractDocumentation).toMatch(/physical(?:ly)? latest.*evidenced.*(?:pass|record).*govern/i);
    expect(allContractDocumentation).toMatch(/malformed.*transition.*fail(?:s|ing)? closed/i);
  });

  it("keeps review evidence append-only and commit-bound", () => {
    expect(allContractDocumentation).toMatch(/single owning (?:feedback|review) file/i);
    expect(allContractDocumentation).toMatch(/full commit identifier|full `Base:`.*full `Head:`/is);
    expect(allContractDocumentation).toMatch(/freshness/i);
    expect(allContractDocumentation).toMatch(/numbered `?(?:feedback|review)(?:-k|-<k>)?\.md`?.*(?:not|never)/is);
  });
});
