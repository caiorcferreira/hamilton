import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const { version: packageVersion } = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const corePackage = JSON.parse(
  readFileSync(resolve(root, "packages/core/package.json"), "utf8"),
);
const packageVersions = [
  "packages/core/package.json",
  "packages/cli/package.json",
].map((file) => JSON.parse(readFileSync(resolve(root, file), "utf8")).version);
const sourceVersion = readFileSync(resolve(root, "src/index.ts"), "utf8")
  .match(/^export const VERSION = "([^\"]+)"$/m)?.[1];
const releaseNotesFile = `docs/releases/${packageVersion}.md`;
const releaseNotesPath = resolve(root, releaseNotesFile);
const releaseWorkflow = readFileSync(
  resolve(root, ".github/workflows/release.yml"),
  "utf8",
);
const publishJob =
  releaseWorkflow.match(/\n  publish:\n([\s\S]*?)(?=\n  [\w-]+:\n|$)/)?.[1] ?? "";
const verifyJob =
  releaseWorkflow.match(/\n  verify:\n([\s\S]*?)(?=\n  [\w-]+:\n|$)/)?.[1] ?? "";
const packageJob =
  releaseWorkflow.match(/\n  package:\n([\s\S]*?)(?=\n  [\w-]+:\n|$)/)?.[1] ?? "";
const publishCoreJob =
  releaseWorkflow.match(/\n  publish-core:\n([\s\S]*?)(?=\n  [\w-]+:\n|$)/)?.[1] ?? "";

describe("versioned release notes", () => {
  it("synchronizes the root, package, and CLI version metadata before release", () => {
    expect(packageVersions).toEqual([packageVersion, packageVersion]);
    expect(sourceVersion).toBe(packageVersion);
    expect(verifyJob).toContain("bun run check:version");
    expect(verifyJob).toContain("bash scripts/smoke-installer.sh");
  });

  it("documents the current version's fixes and release format", () => {
    expect(existsSync(releaseNotesPath)).toBe(true);
    const releaseNotes = readFileSync(releaseNotesPath, "utf8");

    expect(releaseNotes).toContain(`# Kepler ${packageVersion}`);
    expect(releaseNotes).toMatch(/XDG_CONFIG_HOME.*vialactea-works\/kepler/);
    expect(releaseNotes).toMatch(/previous hidden directory.*without deleting the source/i);
    expect(releaseNotes).toMatch(/existing corrected data takes precedence/i);
    expect(releaseNotes).toMatch(/legacy `~\/\.hamilton\/` remains supported/i);
    expect(releaseNotes).toContain("@vialactea-works/kepler-cli");
    expect(releaseNotes).toContain("@vialactea-works/kepler-core");
    expect(releaseNotes).toContain(`kepler-core-${packageVersion}.tgz`);
    expect(releaseNotes).toContain("SHA256SUMS");
    expect(releaseNotes).toMatch(/publishes the core package to GitHub Packages/i);
    expect(releaseNotes).toMatch(/standalone executable/i);
    expect(releaseNotes).toContain("kepler-bundle.tar.gz");
    expect(releaseNotes).toMatch(/curl -fsSL[^\n]*install\.sh[^\n]*\| bash/);
  });

  it("preserves documentation of the first Kepler release migration", () => {
    const firstRelease = readFileSync(resolve(root, "docs/releases/0.10.0.md"), "utf8");

    expect(firstRelease).toMatch(/first release[^\n]*two-package workspace/i);
    expect(firstRelease).toMatch(/old `hamilton` command[^\n]*not provided as an alias/i);
    expect(firstRelease).toMatch(/global data now lives/i);
    expect(firstRelease).toMatch(/legacy `~\/.hamilton\/`[^\n]*source unchanged/i);
    expect(firstRelease).toMatch(/legacy `\.hamilton\/`[^\n]*without merging/i);
    expect(firstRelease).toMatch(/publishing it to GitHub Packages is a separate workflow step/i);
  });

  it("packages Kepler-named binaries, bundle, and a core tarball", () => {
    expect(releaseWorkflow).toContain("packages/cli/src/cli/main.ts");
    expect(releaseWorkflow).toContain("kepler-${{ matrix.os }}-${{ matrix.arch }}");
    expect(releaseWorkflow).toContain("kepler-bundle.tar.gz");
    expect(packageJob).toMatch(/bun pm pack --filename/);
    expect(packageJob).toMatch(/kepler-core-\$\{PACKAGE_VERSION\}\.tgz/);
    expect(packageJob).toMatch(/Smoke test binary with packaged bundle[\s\S]*?scripts\/smoke-standalone\.sh/);
    expect(packageJob).toMatch(/sha256sum kepler-\*/);
    expect(releaseWorkflow).not.toMatch(/hamilton-(?:linux|darwin|bundle)/i);
  });

  it("publishes the core package privately to GitHub Packages", () => {
    expect(corePackage.name).toBe("@vialactea-works/kepler-core");
    expect(corePackage.private).not.toBe(true);
    expect(corePackage.repository).toBe("https://github.com/vialactea-works/kepler.git");
    expect(corePackage.publishConfig).toEqual({
      registry: "https://npm.pkg.github.com",
    });
    expect(releaseWorkflow).toMatch(/workflow_dispatch:[\s\S]*?publish_core:/);
    expect(publishCoreJob).toMatch(/packages:\s*write/);
    expect(publishCoreJob).toMatch(/actions\/setup-node@[a-f0-9]{40}/);
    expect(publishCoreJob).toContain("npm view");
    expect(publishCoreJob).toContain("npm publish ./packages/core");
    expect(publishCoreJob).toContain("NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}");
    expect(publishCoreJob).toContain("inputs.publish_core");
    expect(publishCoreJob).toContain("needs.package.result == 'success'");
  });

  it("publishes only the notes for the current package version", () => {
    expect(publishJob).toMatch(/uses:\s*actions\/checkout@[a-f0-9]{40}/);
    expect(publishJob).toMatch(/VERSION="\$RELEASE_VERSION"/);
    expect(publishJob).toMatch(
      /RELEASE_VERSION:\s*\$\{\{\s*needs\.check-version\.outputs\.version\s*\}\}/,
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
