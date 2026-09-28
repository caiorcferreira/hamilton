import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const { version: packageVersion } = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const releaseNotesFile = `docs/releases/${packageVersion}.md`;
const releaseNotesPath = resolve(root, releaseNotesFile);
const releaseWorkflow = readFileSync(
  resolve(root, ".github/workflows/release.yml"),
  "utf8",
);
const publishJob =
  releaseWorkflow.match(/\n  publish:\n([\s\S]*?)(?=\n  [\w-]+:\n|$)/)?.[1] ?? "";

describe("versioned release notes", () => {
  it("documents the version's CLI breaking changes and install path", () => {
    expect(existsSync(releaseNotesPath)).toBe(true);
    const releaseNotes = readFileSync(releaseNotesPath, "utf8");

    expect(releaseNotes).toMatch(/--completions/);
    expect(releaseNotes).toMatch(/--log-level/);
    expect(releaseNotes).toMatch(/--wizard/);
    expect(releaseNotes).toMatch(/flags?[^\n]*removed/i);
    expect(releaseNotes).toMatch(
      /rejected as a usage error with exit code `?2`?/i,
    );
    expect(releaseNotes).toMatch(
      /setup`? failure[^\n]*exit(?:s|ed)? (?:with )?(?:status|code) `?2`?[^\n]*(?:rather than|instead of) `?0`?/i,
    );
    expect(releaseNotes).toMatch(/standalone Bun executable/i);
    expect(releaseNotes).toMatch(/sidecar `?bundle\/?`?/i);
    expect(releaseNotes).toMatch(/curl -fsSL[^\n]*install\.sh[^\n]*\| bash/);
  });

  it("publishes only the notes for the current package version", () => {
    expect(publishJob).toMatch(/uses:\s*actions\/checkout@v4/);
    expect(publishJob).toMatch(
      /VERSION="\$\{\{\s*needs\.check-version\.outputs\.version\s*\}\}"/,
    );
    expect(publishJob).toMatch(
      /NOTES_FILE="docs\/releases\/\$\{VERSION\}\.md"/,
    );
    expect(publishJob).not.toMatch(/docs\/releases\/0\.9\.0\.md/);
    expect(publishJob.match(/docs\/releases\//g)).toHaveLength(1);

    const missingNotesCheck = publishJob.indexOf(
      'if [ ! -f "$NOTES_FILE" ]',
    );
    const releaseCreate = publishJob.indexOf("gh release create");

    expect(missingNotesCheck).toBeGreaterThanOrEqual(0);
    expect(missingNotesCheck).toBeLessThan(releaseCreate);
    expect(
      publishJob.slice(missingNotesCheck, releaseCreate),
    ).toMatch(/exit 1/);
    expect(publishJob).toMatch(
      /Release notes file not found[^\n]*\$NOTES_FILE/,
    );
    expect(publishJob).toMatch(
      /gh release create[\s\S]*?--notes-file "\$NOTES_FILE"/,
    );
  });
});
