import { afterEach, describe, expect, it } from "vitest";
import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import {
  legacyMigrationMarkerPath,
  legacyMigrationStagingPath,
  migrationCanonicalOwnershipMarkerPath,
  migrationLeasePath,
  migrationMarkerPath,
  migrationOwnershipMarkerPath,
  migrationProcessIdentity,
  migrationStagingPath,
  type KeplerMigrationState,
} from "../src/migration.js";
import {
  KeplerConfigError,
  KeplerMigrationError,
  KeplerService,
  loadKeplerSettings,
  parseKeplerSettings,
} from "../src/index.js";

const temporaryDirectories: string[] = [];

const makeDirectory = (): string => {
  const directory = Fs.mkdtempSync(Path.join(Os.tmpdir(), "kepler-core-"));
  temporaryDirectories.push(directory);
  return directory;
};

const makeInterruptedMigration = (root: string, createCanonical: boolean) => {
  const home = Path.join(root, "home");
  const configHome = Path.join(root, "config");
  const legacyPath = Path.join(home, ".hamilton");
  const canonicalPath = Path.join(configHome, ".vialactea-works", "kepler");
  const transactionId = "bcd12345-6789-4abc-8def-0123456789ab";
  const stagingPath = migrationStagingPath(canonicalPath, transactionId);
  Fs.mkdirSync(legacyPath, { recursive: true });
  Fs.writeFileSync(Path.join(legacyPath, "settings.yaml"), "source: legacy\n");
  Fs.writeFileSync(Path.join(legacyPath, "legacy-only.txt"), "legacy data\n");
  Fs.mkdirSync(Path.dirname(stagingPath), { recursive: true });
  Fs.cpSync(legacyPath, stagingPath, { recursive: true });
  if (createCanonical) {
    Fs.mkdirSync(canonicalPath);
    Fs.writeFileSync(Path.join(canonicalPath, "settings.yaml"), "source: par");
    Fs.writeFileSync(Path.join(canonicalPath, "partial.txt"), "partial\n");
  }
  const markerPath = migrationMarkerPath(canonicalPath);
  const state: KeplerMigrationState = {
    format: "kepler-legacy-migration-v2",
    pid: Number.MAX_SAFE_INTEGER,
    processIdentity: "stale-process-instance",
    transactionId,
    legacyPath: Path.resolve(legacyPath),
    sourcePath: Fs.realpathSync(legacyPath),
    canonicalPath: Path.resolve(canonicalPath),
    stagingPath: Path.resolve(stagingPath),
    temporaryMarkerPath: `${markerPath}.tmp-${transactionId}`,
  };
  if (createCanonical) {
    Fs.writeFileSync(
      migrationCanonicalOwnershipMarkerPath(state),
      `kepler-legacy-migration-canonical-owner-v1\n${transactionId}\n`,
      { flag: "wx", mode: 0o600 },
    );
  }
  Fs.writeFileSync(
    migrationOwnershipMarkerPath(state),
    `kepler-legacy-migration-owner-v1\n${transactionId}\n`,
    { flag: "wx", mode: 0o600 },
  );
  Fs.writeFileSync(state.temporaryMarkerPath, JSON.stringify(state), { mode: 0o600 });
  Fs.linkSync(state.temporaryMarkerPath, markerPath);
  return {
    home,
    configHome,
    legacyPath,
    canonicalPath,
    stagingPath,
    markerPath,
    state,
    temporaryMarkerPath: state.temporaryMarkerPath,
  };
};

const makeLegacyProjectMigration = (
  root: string,
  canonicalName: string,
  createCanonical: boolean,
) => {
  const projectRoot = Path.join(root, "project");
  const legacyPath = Path.join(projectRoot, ".hamilton");
  const canonicalPath = Path.join(projectRoot, canonicalName);
  const transactionId = "cde12345-6789-4abc-8def-0123456789ab";
  const stagingPath = legacyMigrationStagingPath(canonicalPath, transactionId);
  Fs.mkdirSync(legacyPath, { recursive: true });
  Fs.writeFileSync(Path.join(legacyPath, "settings.yaml"), "source: legacy\n");
  Fs.mkdirSync(Path.dirname(stagingPath), { recursive: true });
  Fs.cpSync(legacyPath, stagingPath, { recursive: true });
  if (createCanonical) {
    Fs.mkdirSync(canonicalPath);
    Fs.writeFileSync(Path.join(canonicalPath, "settings.yaml"), "source: user\n");
  }
  const markerPath = legacyMigrationMarkerPath(canonicalPath);
  const state: KeplerMigrationState = {
    format: "kepler-legacy-migration-v1",
    pid: Number.MAX_SAFE_INTEGER,
    transactionId,
    legacyPath: Path.resolve(legacyPath),
    sourcePath: Fs.realpathSync(legacyPath),
    canonicalPath: Path.resolve(canonicalPath),
    stagingPath: Path.resolve(stagingPath),
    temporaryMarkerPath: `${markerPath}.tmp-${transactionId}`,
  };
  Fs.writeFileSync(
    migrationOwnershipMarkerPath(state),
    `kepler-legacy-migration-owner-v1\n${transactionId}\n`,
    { flag: "wx", mode: 0o600 },
  );
  Fs.writeFileSync(state.temporaryMarkerPath, JSON.stringify(state), { mode: 0o600 });
  Fs.linkSync(state.temporaryMarkerPath, markerPath);
  return {
    projectRoot,
    legacyPath,
    canonicalPath,
    stagingPath,
    markerPath,
    state,
    temporaryMarkerPath: state.temporaryMarkerPath,
  };
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    Fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("KeplerService paths", () => {
  it("uses XDG_CONFIG_HOME for global data and .kepler for project data", () => {
    const root = makeDirectory();
    const service = new KeplerService({
      homeDirectory: Path.join(root, "home"),
      xdgConfigHome: Path.join(root, "config"),
    });

    expect(service.globalPaths()).toEqual({
      home: Path.join(root, "config", ".vialactea-works", "kepler"),
      templates: Path.join(root, "config", ".vialactea-works", "kepler", "templates"),
      guidelines: Path.join(root, "config", ".vialactea-works", "kepler", "guidelines"),
      settings: Path.join(root, "config", ".vialactea-works", "kepler", "settings.yaml"),
    });
    expect(service.projectDataPath(Path.join(root, "project"))).toBe(
      Path.join(root, "project", ".kepler"),
    );
  });

  it("uses distinct migration paths for .kepler and kepler siblings", () => {
    const root = makeDirectory();
    const parent = Path.join(root, "project");
    const dottedCanonical = Path.join(parent, ".kepler");
    const bareCanonical = Path.join(parent, "kepler");
    const transactionId = "bcd12345-6789-4abc-8def-0123456789ab";
    const stateFor = (canonicalPath: string): KeplerMigrationState => ({
      format: "kepler-legacy-migration-v2",
      pid: process.pid,
      processIdentity: "test-process-instance",
      transactionId,
      legacyPath: Path.join(root, ".hamilton"),
      sourcePath: root,
      canonicalPath,
      stagingPath: migrationStagingPath(canonicalPath, transactionId),
      temporaryMarkerPath: `${migrationMarkerPath(canonicalPath)}.tmp-${transactionId}`,
    });
    const dottedState = stateFor(dottedCanonical);
    const bareState = stateFor(bareCanonical);

    expect(migrationMarkerPath(dottedCanonical)).not.toBe(
      migrationMarkerPath(bareCanonical),
    );
    expect(dottedState.stagingPath).not.toBe(bareState.stagingPath);
    expect(migrationOwnershipMarkerPath(dottedState)).not.toBe(
      migrationOwnershipMarkerPath(bareState),
    );
  });

  it("defaults XDG_CONFIG_HOME under HOME/.config", () => {
    const root = makeDirectory();
    const service = new KeplerService({ homeDirectory: root });

    expect(service.globalHome()).toBe(
      Path.join(root, ".config", ".vialactea-works", "kepler"),
    );
  });

  it("treats an empty home override as unset instead of resolving it to cwd", () => {
    const root = makeDirectory();
    const service = new KeplerService({
      homeDirectory: "",
      environment: { HOME: root },
    });

    expect(service.globalHome()).toBe(
      Path.join(root, ".config", ".vialactea-works", "kepler"),
    );
  });

  it("copies legacy data from a symlinked home directory", () => {
    const root = makeDirectory();
    const home = Path.join(root, "home");
    const sourceHome = Path.join(root, "legacy-storage");
    const legacyHome = Path.join(home, ".hamilton");
    Fs.mkdirSync(home, { recursive: true });
    Fs.mkdirSync(sourceHome, { recursive: true });
    Fs.writeFileSync(Path.join(sourceHome, "settings.yaml"), "source: symlink\n");
    const symlinkTarget = Path.relative(home, sourceHome);
    Fs.symlinkSync(symlinkTarget, legacyHome, "dir");
    const service = new KeplerService({
      homeDirectory: home,
      xdgConfigHome: Path.join(root, "config"),
    });

    const canonicalHome = service.globalHome();
    expect(Fs.lstatSync(canonicalHome).isDirectory()).toBe(true);
    expect(Fs.readFileSync(Path.join(canonicalHome, "settings.yaml"), "utf8")).toBe(
      "source: symlink\n",
    );
    expect(Fs.lstatSync(legacyHome).isSymbolicLink()).toBe(true);
    expect(Fs.readlinkSync(legacyHome)).toBe(symlinkTarget);
  });

  it("rejects global path overlap before creating anything inside legacy data", () => {
    for (const useSymlink of [false, true]) {
      const root = makeDirectory();
      const home = Path.join(root, "home");
      const legacyHome = Path.join(home, ".hamilton");
      Fs.mkdirSync(legacyHome, { recursive: true });
      Fs.writeFileSync(Path.join(legacyHome, "settings.yaml"), "legacy: true\n");
      const xdgConfigHome = useSymlink
        ? Path.join(root, "config-link")
        : legacyHome;
      if (useSymlink) Fs.symlinkSync(legacyHome, xdgConfigHome, "dir");
      const service = new KeplerService({ homeDirectory: home, xdgConfigHome });

      expect(() => service.globalHome()).toThrow(KeplerMigrationError);
      expect(Fs.existsSync(Path.join(legacyHome, ".vialactea-works"))).toBe(false);
      expect(Fs.readdirSync(legacyHome)).toEqual(["settings.yaml"]);
    }
  });

  it("rejects an existing canonical symlink into legacy data before writing through it", () => {
    const root = makeDirectory();
    const home = Path.join(root, "home");
    const legacyHome = Path.join(home, ".hamilton");
    const canonicalHome = Path.join(
      root,
      "config",
      ".vialactea-works",
      "kepler",
    );
    Fs.mkdirSync(legacyHome, { recursive: true });
    Fs.writeFileSync(Path.join(legacyHome, "settings.yaml"), "legacy: true\n");
    Fs.mkdirSync(Path.dirname(canonicalHome), { recursive: true });
    Fs.symlinkSync(legacyHome, canonicalHome, "dir");
    const service = new KeplerService({
      homeDirectory: home,
      xdgConfigHome: Path.join(root, "config"),
    });

    expect(() => service.ensureGlobalHome()).toThrow(KeplerMigrationError);
    expect(Fs.existsSync(Path.join(legacyHome, "templates"))).toBe(false);
    expect(Fs.existsSync(Path.join(legacyHome, "guidelines"))).toBe(false);
    expect(Fs.readFileSync(Path.join(legacyHome, "settings.yaml"), "utf8")).toBe(
      "legacy: true\n",
    );
  });

  it("rejects a non-directory canonical path without changing legacy data", () => {
    const root = makeDirectory();
    const home = Path.join(root, "home");
    const xdgConfigHome = Path.join(root, "config");
    const legacySettings = Path.join(home, ".hamilton", "settings.yaml");
    const canonicalHome = Path.join(
      xdgConfigHome,
      ".vialactea-works",
      "kepler",
    );
    Fs.mkdirSync(Path.dirname(legacySettings), { recursive: true });
    Fs.mkdirSync(Path.dirname(canonicalHome), { recursive: true });
    Fs.writeFileSync(legacySettings, "source: legacy\n");
    Fs.writeFileSync(canonicalHome, "not a directory");
    const service = new KeplerService({ homeDirectory: home, xdgConfigHome });

    expect(() => service.globalHome()).toThrow(KeplerMigrationError);
    expect(Fs.readFileSync(legacySettings, "utf8")).toBe("source: legacy\n");
    expect(Fs.readFileSync(canonicalHome, "utf8")).toBe("not a directory");
  });

  it("repairs a partial canonical file from verified migration staging data", () => {
    const paths = makeInterruptedMigration(makeDirectory(), true);
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(service.globalHome()).toBe(paths.canonicalPath);
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "legacy-only.txt"), "utf8"))
      .toBe("legacy data\n");
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "partial.txt"), "utf8"))
      .toBe("partial\n");
    expect(Fs.existsSync(Path.join(paths.legacyPath, "settings.yaml"))).toBe(true);
    expect(Fs.readdirSync(paths.canonicalPath).some((name) => name.includes("migration-owner")))
      .toBe(false);
    expect(Fs.existsSync(paths.markerPath)).toBe(false);
    expect(Fs.existsSync(paths.temporaryMarkerPath)).toBe(false);
    expect(Fs.existsSync(paths.stagingPath)).toBe(false);
  });

  it("refuses to overwrite a canonical directory without transaction ownership", () => {
    const paths = makeInterruptedMigration(makeDirectory(), false);
    Fs.mkdirSync(paths.canonicalPath);
    Fs.writeFileSync(Path.join(paths.canonicalPath, "settings.yaml"), "source: user\n");
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(() => service.globalHome()).toThrow(KeplerMigrationError);
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "settings.yaml"), "utf8"))
      .toBe("source: user\n");
    expect(Fs.existsSync(migrationCanonicalOwnershipMarkerPath(paths.state))).toBe(false);
    expect(Fs.existsSync(paths.markerPath)).toBe(true);
    expect(Fs.existsSync(paths.temporaryMarkerPath)).toBe(true);
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
  });

  it("finishes staged migration when interruption preceded canonical creation", () => {
    const paths = makeInterruptedMigration(makeDirectory(), false);
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(service.globalHome()).toBe(paths.canonicalPath);
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
    expect(Fs.existsSync(paths.markerPath)).toBe(false);
    expect(Fs.existsSync(paths.stagingPath)).toBe(false);
  });

  it("recovers a prior dotted-name migration when canonical data is absent", () => {
    const paths = makeLegacyProjectMigration(makeDirectory(), ".kepler", false);
    const service = new KeplerService({ homeDirectory: Path.join(paths.projectRoot, "home") });

    expect(service.projectDataPath(paths.projectRoot)).toBe(paths.canonicalPath);
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
    expect(Fs.existsSync(paths.markerPath)).toBe(false);
    expect(Fs.existsSync(paths.temporaryMarkerPath)).toBe(false);
    expect(Fs.existsSync(paths.stagingPath)).toBe(false);
    expect(Fs.existsSync(Path.join(paths.legacyPath, "settings.yaml"))).toBe(true);
  });

  it("reports unavailable legacy-owner identity without clearing state", () => {
    const paths = makeLegacyProjectMigration(makeDirectory(), ".kepler", false);
    const state: KeplerMigrationState = {
      ...paths.state,
      pid: process.pid,
      processIdentity: undefined,
    };
    Fs.writeFileSync(paths.temporaryMarkerPath, JSON.stringify(state));
    const service = new KeplerService({ homeDirectory: Path.join(paths.projectRoot, "home") });

    expect(() => service.projectDataPath(paths.projectRoot)).toThrow(
      /Cannot verify legacy migration owner PID/,
    );
    expect(Fs.existsSync(paths.markerPath)).toBe(true);
    expect(Fs.existsSync(paths.temporaryMarkerPath)).toBe(true);
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
    expect(Fs.existsSync(paths.canonicalPath)).toBe(false);
  });

  it("preserves prior dotted-name staging when canonical data is unowned", () => {
    const paths = makeLegacyProjectMigration(makeDirectory(), ".kepler", true);
    const service = new KeplerService({ homeDirectory: Path.join(paths.projectRoot, "home") });

    expect(() => service.projectDataPath(paths.projectRoot)).toThrow(KeplerMigrationError);
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "settings.yaml"), "utf8"))
      .toBe("source: user\n");
    expect(Fs.existsSync(paths.markerPath)).toBe(true);
    expect(Fs.existsSync(paths.temporaryMarkerPath)).toBe(true);
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
  });

  it("ignores a legacy sibling marker with a different canonical path", () => {
    const paths = makeLegacyProjectMigration(makeDirectory(), "kepler", false);
    const service = new KeplerService({ homeDirectory: Path.join(paths.projectRoot, "home") });
    const dottedCanonical = Path.join(paths.projectRoot, ".kepler");

    expect(service.projectDataPath(paths.projectRoot)).toBe(dottedCanonical);
    expect(Fs.readFileSync(Path.join(dottedCanonical, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
    expect(Fs.existsSync(paths.markerPath)).toBe(true);
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
    expect(legacyMigrationMarkerPath(dottedCanonical)).toBe(paths.markerPath);
    expect(legacyMigrationStagingPath(dottedCanonical, paths.state.transactionId))
      .toBe(paths.stagingPath);
  });

  it("retains staged data if the canonical path becomes an external symlink", () => {
    const paths = makeInterruptedMigration(makeDirectory(), false);
    const unrelatedTarget = Path.join(paths.configHome, "unrelated-config");
    Fs.mkdirSync(unrelatedTarget, { recursive: true });
    Fs.writeFileSync(Path.join(unrelatedTarget, "settings.yaml"), "source: unrelated\n");
    Fs.symlinkSync(unrelatedTarget, paths.canonicalPath, "dir");
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(() => service.globalHome()).toThrow(KeplerMigrationError);
    expect(Fs.readFileSync(Path.join(unrelatedTarget, "settings.yaml"), "utf8"))
      .toBe("source: unrelated\n");
    expect(Fs.readFileSync(Path.join(paths.stagingPath, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
    expect(Fs.existsSync(paths.markerPath)).toBe(true);
    expect(Fs.existsSync(paths.temporaryMarkerPath)).toBe(true);
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
    expect(Fs.existsSync(Path.join(paths.legacyPath, "settings.yaml"))).toBe(true);

    Fs.unlinkSync(paths.canonicalPath);
    expect(service.globalHome()).toBe(paths.canonicalPath);
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
    expect(Fs.readFileSync(Path.join(unrelatedTarget, "settings.yaml"), "utf8"))
      .toBe("source: unrelated\n");
    expect(Fs.existsSync(paths.markerPath)).toBe(false);
    expect(Fs.existsSync(paths.stagingPath)).toBe(false);
  });

  it("recovers when a stale lease PID has been reused", () => {
    const paths = makeInterruptedMigration(makeDirectory(), false);
    const reusedPid = process.ppid;
    const currentIdentity = migrationProcessIdentity(reusedPid);
    expect(currentIdentity).toBeDefined();
    const leasePath = migrationLeasePath(paths.markerPath);
    Fs.writeFileSync(
      leasePath,
      JSON.stringify({
        format: "kepler-legacy-migration-lease-v1",
        pid: reusedPid,
        processIdentity: `stale:${currentIdentity}`,
        transactionId: paths.state.transactionId,
      }),
      { mode: 0o600 },
    );
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(() => process.kill(reusedPid, 0)).not.toThrow();
    expect(service.globalHome()).toBe(paths.canonicalPath);
    expect(Fs.readFileSync(Path.join(paths.canonicalPath, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
    expect(Fs.existsSync(paths.markerPath)).toBe(false);
    expect(Fs.existsSync(leasePath)).toBe(false);
  });

  it("blocks another execution context while a same-process lease is active", () => {
    const paths = makeInterruptedMigration(makeDirectory(), false);
    const ownerPid = process.pid;
    const ownerIdentity = migrationProcessIdentity(ownerPid);
    expect(ownerIdentity).toBeDefined();
    const leasePath = migrationLeasePath(paths.markerPath);
    Fs.writeFileSync(
      leasePath,
      JSON.stringify({
        format: "kepler-legacy-migration-lease-v1",
        pid: ownerPid,
        processIdentity: ownerIdentity,
        transactionId: paths.state.transactionId,
      }),
      { mode: 0o600 },
    );
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(() => service.globalHome()).toThrow(KeplerMigrationError);
    expect(Fs.existsSync(paths.markerPath)).toBe(true);
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
    expect(Fs.existsSync(leasePath)).toBe(true);
  });

  it("fails closed when migration staging lacks its ownership marker", () => {
    const paths = makeInterruptedMigration(makeDirectory(), false);
    Fs.rmSync(migrationOwnershipMarkerPath(paths.state));
    const unrelatedPath = Path.join(paths.stagingPath, "unrelated.txt");
    Fs.writeFileSync(unrelatedPath, "keep this file\n");
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(() => service.globalHome()).toThrow(KeplerMigrationError);
    expect(Fs.readFileSync(unrelatedPath, "utf8")).toBe("keep this file\n");
    expect(Fs.readFileSync(Path.join(paths.legacyPath, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
    expect(Fs.existsSync(paths.canonicalPath)).toBe(false);
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
    expect(Fs.existsSync(paths.markerPath)).toBe(true);
  });

  it("refuses forged marker paths without deleting unrelated sibling data", () => {
    const paths = makeInterruptedMigration(makeDirectory(), false);
    const parent = Path.dirname(paths.canonicalPath);
    const unrelatedStage = Path.join(parent, ".kepler.migration-victim");
    const unrelatedTemporaryMarker = `${paths.markerPath}.tmp-victim`;
    Fs.mkdirSync(unrelatedStage);
    Fs.writeFileSync(Path.join(unrelatedStage, "keep.txt"), "keep stage\n");
    Fs.writeFileSync(unrelatedTemporaryMarker, "keep marker\n");
    Fs.writeFileSync(
      paths.markerPath,
      JSON.stringify({
        ...paths.state,
        stagingPath: unrelatedStage,
        temporaryMarkerPath: unrelatedTemporaryMarker,
      }),
    );
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(() => service.globalHome()).toThrow(KeplerMigrationError);
    expect(Fs.readFileSync(Path.join(unrelatedStage, "keep.txt"), "utf8"))
      .toBe("keep stage\n");
    expect(Fs.readFileSync(unrelatedTemporaryMarker, "utf8")).toBe("keep marker\n");
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
    expect(Fs.readFileSync(Path.join(paths.legacyPath, "settings.yaml"), "utf8"))
      .toBe("source: legacy\n");
  });

  it("rejects a migration marker that is no longer hard-linked to its temporary record", () => {
    const paths = makeInterruptedMigration(makeDirectory(), false);
    Fs.unlinkSync(paths.temporaryMarkerPath);
    Fs.writeFileSync(paths.temporaryMarkerPath, JSON.stringify(paths.state), {
      mode: 0o600,
    });
    const service = new KeplerService({
      homeDirectory: paths.home,
      xdgConfigHome: paths.configHome,
    });

    expect(() => service.globalHome()).toThrow(KeplerMigrationError);
    expect(Fs.existsSync(paths.stagingPath)).toBe(true);
    expect(Fs.existsSync(paths.markerPath)).toBe(true);
    expect(Fs.existsSync(paths.temporaryMarkerPath)).toBe(true);
    expect(Fs.existsSync(paths.canonicalPath)).toBe(false);
  });

  it("copies legacy global data to the new path and leaves the source intact", () => {
    const root = makeDirectory();
    const home = Path.join(root, "home");
    const xdgConfigHome = Path.join(root, "config");
    const legacyHome = Path.join(home, ".hamilton");
    const legacySettings = Path.join(legacyHome, "settings.yaml");
    Fs.mkdirSync(Path.join(legacyHome, "guidelines", "custom"), { recursive: true });
    Fs.writeFileSync(legacySettings, "extensions:\n  - name: custom\n");
    const guideContent = Buffer.from([0, 1, 2, 255]);
    const legacyGuide = Path.join(legacyHome, "guidelines", "custom", "guide.md");
    Fs.writeFileSync(legacyGuide, guideContent);
    Fs.symlinkSync("guide.md", Path.join(legacyHome, "guidelines", "custom", "current.md"));
    const service = new KeplerService({ homeDirectory: home, xdgConfigHome });

    const paths = service.globalPaths();
    expect(paths.home).toBe(Path.join(xdgConfigHome, ".vialactea-works", "kepler"));
    expect(Fs.readFileSync(paths.settings, "utf8")).toBe(
      "extensions:\n  - name: custom\n",
    );
    expect(
      Fs.readFileSync(Path.join(paths.guidelines, "custom", "guide.md")),
    ).toEqual(guideContent);
    const migratedLink = Path.join(paths.guidelines, "custom", "current.md");
    expect(Fs.readlinkSync(migratedLink)).toBe("guide.md");
    expect(Fs.readFileSync(migratedLink)).toEqual(guideContent);
    expect(Fs.readFileSync(legacySettings, "utf8")).toBe(
      "extensions:\n  - name: custom\n",
    );
  });

  it("prefers existing new global data without copying or changing legacy data", () => {
    const root = makeDirectory();
    const home = Path.join(root, "home");
    const xdgConfigHome = Path.join(root, "config");
    const legacySettings = Path.join(home, ".hamilton", "settings.yaml");
    const canonicalSettings = Path.join(
      xdgConfigHome,
      ".vialactea-works",
      "kepler",
      "settings.yaml",
    );
    Fs.mkdirSync(Path.dirname(legacySettings), { recursive: true });
    Fs.mkdirSync(Path.dirname(canonicalSettings), { recursive: true });
    Fs.writeFileSync(legacySettings, "source: legacy\n");
    Fs.writeFileSync(canonicalSettings, "source: new\n");
    const service = new KeplerService({ homeDirectory: home, xdgConfigHome });

    expect(service.globalHome()).toBe(Path.dirname(canonicalSettings));
    expect(Fs.readFileSync(canonicalSettings, "utf8")).toBe("source: new\n");
    expect(Fs.readFileSync(legacySettings, "utf8")).toBe("source: legacy\n");
  });

  it("copies project data from .hamilton to .kepler without deleting the source", () => {
    const root = makeDirectory();
    const legacyRoot = Path.join(root, ".hamilton");
    Fs.mkdirSync(Path.join(legacyRoot, "changes", "active"), { recursive: true });
    Fs.writeFileSync(Path.join(legacyRoot, "changes", "active", "plan.md"), "legacy plan\n");
    const service = new KeplerService({ homeDirectory: Path.join(root, "home") });

    const canonicalRoot = service.projectDataPath(root);
    expect(canonicalRoot).toBe(Path.join(root, ".kepler"));
    expect(Fs.readFileSync(Path.join(canonicalRoot, "changes", "active", "plan.md"), "utf8")).toBe("legacy plan\n");
    expect(Fs.readFileSync(Path.join(legacyRoot, "changes", "active", "plan.md"), "utf8")).toBe("legacy plan\n");
  });

  it("prefers existing .kepler project data and leaves .hamilton unchanged", () => {
    const root = makeDirectory();
    const legacyPlan = Path.join(root, ".hamilton", "changes", "plan.md");
    const canonicalPlan = Path.join(root, ".kepler", "changes", "plan.md");
    Fs.mkdirSync(Path.dirname(legacyPlan), { recursive: true });
    Fs.mkdirSync(Path.dirname(canonicalPlan), { recursive: true });
    Fs.writeFileSync(legacyPlan, "legacy\n");
    Fs.writeFileSync(canonicalPlan, "canonical\n");
    const service = new KeplerService({ homeDirectory: Path.join(root, "home") });

    expect(service.projectDataPath(root)).toBe(Path.join(root, ".kepler"));
    expect(Fs.readFileSync(canonicalPlan, "utf8")).toBe("canonical\n");
    expect(Fs.readFileSync(legacyPlan, "utf8")).toBe("legacy\n");
  });

  it("creates the global directories and loads the settings file", () => {
    const root = makeDirectory();
    const service = new KeplerService({ homeDirectory: root });
    const paths = service.ensureGlobalHome();
    Fs.writeFileSync(paths.settings, "feature:\n  enabled: true\n");

    expect(Fs.existsSync(paths.templates)).toBe(true);
    expect(Fs.existsSync(paths.guidelines)).toBe(true);
    expect(service.loadConfig()).toEqual({ feature: { enabled: true } });
  });

  it("returns no config when settings do not exist", () => {
    const service = new KeplerService({ homeDirectory: makeDirectory() });

    expect(service.loadConfig()).toBeUndefined();
  });

  it("reports failed legacy copies without deleting the source", () => {
    const root = makeDirectory();
    const legacyHome = Path.join(root, ".hamilton");
    const canonicalHome = Path.join(root, "config", ".vialactea-works", "kepler");
    Fs.mkdirSync(legacyHome, { recursive: true });
    Fs.writeFileSync(Path.join(legacyHome, "settings.yaml"), "legacy: true\n");
    const canonicalParent = Path.dirname(canonicalHome);
    Fs.mkdirSync(Path.dirname(canonicalParent), { recursive: true });
    Fs.writeFileSync(canonicalParent, "not a directory");
    const service = new KeplerService({
      homeDirectory: root,
      xdgConfigHome: Path.join(root, "config"),
    });

    expect(() => service.globalHome()).toThrow(KeplerMigrationError);
    expect(Fs.readFileSync(Path.join(legacyHome, "settings.yaml"), "utf8")).toBe(
      "legacy: true\n",
    );
  });
});

describe("Kepler config", () => {
  it("loads YAML mappings and accepts an empty document", () => {
    expect(parseKeplerSettings("feature:\n  enabled: true\n")).toEqual({
      feature: { enabled: true },
    });
    expect(parseKeplerSettings("")).toEqual({});
  });

  it("rejects malformed YAML and non-mapping roots", () => {
    expect(() => parseKeplerSettings("feature: [\n", "settings.yaml")).toThrow(
      KeplerConfigError,
    );
    expect(() => parseKeplerSettings("- item\n", "settings.yaml")).toThrow(
      "document root must be a mapping",
    );
    for (const document of [
      "!!binary AQID\n",
      "!!timestamp 2020-01-01T00:00:00Z\n",
      "!!set {a: null}\n",
      "null\n",
    ]) {
      expect(() => parseKeplerSettings(document, "settings.yaml")).toThrow(
        KeplerConfigError,
      );
    }
  });

  it("reads a settings file from disk", () => {
    const root = makeDirectory();
    const path = Path.join(root, "settings.yaml");
    Fs.writeFileSync(path, "models:\n  aliases:\n    fast: test-model\n");

    expect(loadKeplerSettings(path)).toEqual({
      models: { aliases: { fast: "test-model" } },
    });
  });

});
