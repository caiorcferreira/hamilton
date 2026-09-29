import * as Fs from "node:fs";
import * as Path from "node:path";
import { describe, expect, it } from "vitest";

const skillsDirectory = Path.resolve(import.meta.dirname, "../../skills");
const ownedSkills = Fs.readdirSync(skillsDirectory).filter((name) =>
  name.startsWith("kepler-") &&
  Fs.statSync(Path.join(skillsDirectory, name)).isDirectory(),
);

describe("Kepler skill branding", () => {
  it.each(ownedSkills)("uses the directory name as the SKILL.md name: %s", (name) => {
    const skill = Fs.readFileSync(
      Path.join(skillsDirectory, name, "SKILL.md"),
      "utf8",
    );

    expect(skill).toMatch(new RegExp(`^---\\nname: ${name}\\n`, "m"));
    expect(skill.replaceAll(".hamilton", "")).not.toMatch(/hamilton/i);
  });
});
