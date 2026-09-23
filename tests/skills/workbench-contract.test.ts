import * as Fs from "node:fs";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";
import { readSkill } from "./helpers.js";

const skillNames = [
  "hamilton-propose",
  "hamilton-plan",
  "hamilton-code",
  "hamilton-code-feedback",
  "hamilton-orchestrate",
  "hamilton-review",
  "hamilton-critique",
  "hamilton-finish-work",
  "hamilton-wayfinder-prototype",
] as const;

const obsoleteHelpers =
  /~\/\.hamilton\/scripts\/|hamilton-(?:artifact-contracts|change-context|diff-package|isolate|precondition-check|prototype-branch)\.sh/;

const readSkills = () =>
  Object.fromEntries(
    skillNames.map((name) => [name, readSkill(name)]),
  ) as Record<(typeof skillNames)[number], string>;

describe("Hamilton skill workbench contract", () => {
  it("removes obsolete helper calls from every maintained Hamilton skill", () => {
    const skillsDirectory = Path.resolve(
      Path.dirname(new URL(import.meta.url).pathname),
      "../../skills",
    );
    const maintainedSkills = Fs.readdirSync(skillsDirectory)
      .filter((name) => name.startsWith("hamilton-"))
      .map((name) =>
        Fs.readFileSync(Path.join(skillsDirectory, name, "SKILL.md"), "utf-8"),
      )
      .join("\n");

    expect(maintainedSkills).not.toMatch(obsoleteHelpers);
  });

  it("maps isolation call sites to the matching workbench modes", () => {
    const skills = readSkills();

    expect(skills["hamilton-propose"]).toContain(
      "hamilton workbench isolate --check",
    );
    expect(skills["hamilton-propose"]).toContain(
      "hamilton workbench isolate <title>",
    );
    expect(skills["hamilton-propose"]).toContain(
      "hamilton workbench isolate --verify <title>",
    );
    expect(skills["hamilton-plan"]).toContain(
      "hamilton workbench isolate --check",
    );
    expect(skills["hamilton-code"]).toContain(
      "hamilton workbench isolate --check --change-dir <change-dir>",
    );
    expect(skills["hamilton-orchestrate"]).toContain(
      "hamilton workbench isolate --check --change-dir <change-dir>",
    );
    expect(skills["hamilton-finish-work"]).toContain(
      "hamilton workbench isolate --check",
    );
  });

  it("maps diff checkpoint and package call sites without changing their flags", () => {
    const skills = readSkills();

    expect(skills["hamilton-code"]).toContain(
      "hamilton workbench diff --record --task N --change-dir <change-dir>",
    );
    expect(skills["hamilton-orchestrate"]).toContain(
      "hamilton workbench diff --record --task N --change-dir <change-dir>",
    );
    expect(skills["hamilton-orchestrate"]).toContain(
      "hamilton workbench diff --task N --change-dir <change-dir>",
    );
    expect(skills["hamilton-orchestrate"]).toContain(
      "hamilton workbench diff --whole-change",
    );
  });

  it("maps recognized artifact mutations to scoped lint commands", () => {
    const skills = readSkills()

    for (const name of [
      "hamilton-propose",
      "hamilton-code",
      "hamilton-code-feedback",
      "hamilton-critique",
      "hamilton-review",
      "hamilton-finish-work",
    ] as const) {
      expect(skills[name]).toContain("hamilton workbench lint")
    }

    expect(skills["hamilton-propose"]).toContain(
      "hamilton workbench lint --change-dir <change-dir>",
    )
    expect(skills["hamilton-code"]).toContain(
      "hamilton workbench lint --change-dir <change-dir>",
    )
    expect(skills["hamilton-code-feedback"]).toContain(
      "hamilton workbench lint --file <change-dir>/tasks/task-N/feedback.md",
    )
    expect(skills["hamilton-critique"]).toContain(
      "hamilton workbench lint --file <change-dir>/critique.md",
    )
    expect(skills["hamilton-review"]).toContain(
      "hamilton workbench lint --file <change-dir>/review.md",
    )
    expect(skills["hamilton-finish-work"]).toContain(
      "hamilton workbench lint --file <file>",
    )
  })

  it("maps context and precondition call sites to workbench commands", () => {
    const skills = readSkills();

    expect(skills["hamilton-plan"]).toContain(
      "hamilton workbench context <change-dir>",
    );
    expect(skills["hamilton-orchestrate"]).toContain(
      "hamilton workbench context <change-dir>",
    );
    expect(skills["hamilton-critique"]).toContain(
      "hamilton workbench context <change-dir>",
    );
    expect(skills["hamilton-finish-work"]).toContain(
      "hamilton workbench context <change-dir>",
    );
    expect(skills["hamilton-finish-work"]).toContain(
      "hamilton workbench precondition \\\n  --change-dir <change-dir> --test-cmd '<full test suite && build/typecheck>'",
    );
    expect(skills["hamilton-finish-work"]).toContain("--whole-change-waived");
  });

  it("maps prototype creation and verification to workbench commands", () => {
    const skill = readSkills()["hamilton-wayfinder-prototype"];

    expect(skill).toContain(
      "hamilton workbench prototype <map-name> <ticket-name>",
    );
    expect(skill).toContain(
      "hamilton workbench prototype --standalone <question-slug>",
    );
    expect(skill).toContain(
      "hamilton workbench prototype --verify <that branch>",
    );
  });

  it("names the Hamilton CLI/workbench in manual fallback paths", () => {
    const skills = readSkills();

    for (const name of [
      "hamilton-code",
      "hamilton-orchestrate",
      "hamilton-critique",
      "hamilton-finish-work",
    ] as const) {
      expect(skills[name]).toMatch(/Hamilton CLI\/workbench\s+is unavailable/i);
    }
  });

  it("keeps skill-owned control flow and migration boundaries explicit", () => {
    const skills = readSkills();
    expect(skills["hamilton-orchestrate"]).toContain(
      "**Coordinate; never implement.**",
    );
    expect(skills["hamilton-orchestrate"]).toMatch(
      /driver adjudicates.*concrete named risk/i,
    );
    expect(skills["hamilton-code"]).toMatch(
      /Do not redesign, reorder, add work/i,
    );
    expect(skills["hamilton-code"]).toMatch(/fail|blocked/i);
    expect(skills["hamilton-wayfinder-prototype"]).toMatch(/branch gate/i);
    expect(skills["hamilton-wayfinder-prototype"]).toMatch(
      /throwaway artifact/i,
    );
  });
});
