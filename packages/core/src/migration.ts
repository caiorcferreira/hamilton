import { execFileSync } from "node:child_process";
import * as Fs from "node:fs";
import * as Path from "node:path";
import { randomUUID } from "node:crypto";

export interface KeplerMigrationState {
  format: "kepler-legacy-migration-v1" | "kepler-legacy-migration-v2";
  pid: number;
  processIdentity?: string;
  transactionId: string;
  legacyPath: string;
  sourcePath: string;
  canonicalPath: string;
  stagingPath: string;
  temporaryMarkerPath: string;
}

interface MigrationLease {
  format: "kepler-legacy-migration-lease-v1";
  pid: number;
  processIdentity: string;
  transactionId: string;
}

export class KeplerMigrationError extends Error {
  constructor(
    readonly legacyPath: string,
    readonly canonicalPath: string,
    cause: unknown,
  ) {
    super(
      `Failed to copy legacy data from ${legacyPath} to ${canonicalPath}: ${String(cause)}`,
      { cause },
    );
    this.name = "KeplerMigrationError";
  }
}

const migrationFormat = "kepler-legacy-migration-v2";
const legacyMigrationFormat = "kepler-legacy-migration-v1";
const ownershipFormat = "kepler-legacy-migration-owner-v1";
const canonicalOwnershipFormat = "kepler-legacy-migration-canonical-owner-v1";
const leaseFormat = "kepler-legacy-migration-lease-v1";
const transactionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const pathExists = (path: string): boolean => {
  try {
    Fs.lstatSync(path);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
};

const canonicalName = (canonicalPath: string): string =>
  Path.basename(Path.resolve(canonicalPath)) || "data";

const legacyDataName = (canonicalPath: string): string =>
  Path.basename(Path.resolve(canonicalPath)).replace(/^\.+/, "") || "data";

export const migrationMarkerPath = (canonicalPath: string): string => {
  const canonical = Path.resolve(canonicalPath);
  return Path.join(
    Path.dirname(canonical),
    `.kepler-migration-${canonicalName(canonical)}.json`,
  );
};

export const legacyMigrationMarkerPath = (canonicalPath: string): string => {
  const canonical = Path.resolve(canonicalPath);
  return Path.join(
    Path.dirname(canonical),
    `.${legacyDataName(canonical)}.migration.json`,
  );
};

export const migrationStagingPath = (
  canonicalPath: string,
  transactionId: string,
): string => {
  const canonical = Path.resolve(canonicalPath);
  return Path.join(
    Path.dirname(canonical),
    `.kepler-migration-${canonicalName(canonical)}-${transactionId}`,
  );
};

export const legacyMigrationStagingPath = (
  canonicalPath: string,
  transactionId: string,
): string => {
  const canonical = Path.resolve(canonicalPath);
  return Path.join(
    Path.dirname(canonical),
    `.${legacyDataName(canonical)}.migration-${transactionId}`,
  );
};

export const migrationOwnershipMarkerPath = (
  state: KeplerMigrationState,
): string => {
  const fileName = state.format === legacyMigrationFormat
    ? `.${legacyDataName(state.canonicalPath)}.migration-owner-${state.transactionId}`
    : `.kepler-migration-owner-${canonicalName(state.canonicalPath)}-${state.transactionId}`;
  return Path.join(state.stagingPath, fileName);
};

export const migrationCanonicalOwnershipMarkerPath = (
  state: KeplerMigrationState,
): string =>
  Path.join(
    state.canonicalPath,
    `.kepler-migration-owner-${state.transactionId}`,
  );

export const migrationLeasePath = (markerPath: string): string =>
  `${markerPath}.lease`;

const expectedTemporaryMarkerPath = (
  markerPath: string,
  transactionId: string,
): string => `${markerPath}.tmp-${transactionId}`;

const resolveThroughExistingAncestor = (path: string): string => {
  let existingAncestor = Path.resolve(path);
  const remainingSegments: string[] = [];

  while (!pathExists(existingAncestor)) {
    const parent = Path.dirname(existingAncestor);
    if (parent === existingAncestor) return existingAncestor;
    remainingSegments.unshift(Path.basename(existingAncestor));
    existingAncestor = parent;
  }

  return Path.resolve(Fs.realpathSync(existingAncestor), ...remainingSegments);
};

const isWithinPath = (parent: string, candidate: string): boolean => {
  const relative = Path.relative(parent, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${Path.sep}`) &&
    !Path.isAbsolute(relative)
  );
};

const assertDisjointPaths = (sourcePath: string, canonicalPath: string): void => {
  const resolvedCanonicalPath = resolveThroughExistingAncestor(canonicalPath);
  if (
    isWithinPath(sourcePath, resolvedCanonicalPath) ||
    isWithinPath(resolvedCanonicalPath, sourcePath)
  ) {
    throw new Error("Legacy and canonical data paths overlap");
  }
};

const inspectCanonicalDirectory = (
  canonicalPath: string,
  sourcePath?: string,
): { realPath: string; isSymlink: boolean } => {
  const linkStatus = Fs.lstatSync(canonicalPath);
  const status = Fs.statSync(canonicalPath);
  if (!status.isDirectory()) {
    throw new Error(`Canonical data path is not a directory: ${canonicalPath}`);
  }
  const realPath = Fs.realpathSync(canonicalPath);
  if (sourcePath) assertDisjointPaths(sourcePath, realPath);
  return { realPath, isSymlink: linkStatus.isSymbolicLink() };
};

const stateMarkerPath = (state: KeplerMigrationState): string =>
  state.format === legacyMigrationFormat
    ? legacyMigrationMarkerPath(state.canonicalPath)
    : migrationMarkerPath(state.canonicalPath);

const stateStagingPath = (
  state: KeplerMigrationState,
  transactionId: string,
): string =>
  state.format === legacyMigrationFormat
    ? legacyMigrationStagingPath(state.canonicalPath, transactionId)
    : migrationStagingPath(state.canonicalPath, transactionId);

type MigrationJsonValue =
  | string
  | number
  | boolean
  | null
  | MigrationJsonValue[]
  | { [key: string]: MigrationJsonValue };

type MigrationMarkerRecord = { [key: string]: MigrationJsonValue };

const validateState = (
  value: MigrationMarkerRecord,
  legacyPath: string,
  canonicalPath: string,
  markerPath: string,
): KeplerMigrationState => {
  const state = value as Partial<KeplerMigrationState>;
  if (
    (state.format !== migrationFormat && state.format !== legacyMigrationFormat) ||
    !Number.isSafeInteger(state.pid) ||
    (state.pid ?? 0) < 1 ||
    (state.format === migrationFormat &&
      (typeof state.processIdentity !== "string" || state.processIdentity.length === 0)) ||
    (state.processIdentity !== undefined &&
      (typeof state.processIdentity !== "string" || state.processIdentity.length === 0)) ||
    typeof state.transactionId !== "string" ||
    !transactionIdPattern.test(state.transactionId) ||
    state.legacyPath !== legacyPath ||
    state.canonicalPath !== canonicalPath ||
    markerPath !== stateMarkerPath(state as KeplerMigrationState) ||
    typeof state.sourcePath !== "string" ||
    Path.resolve(state.sourcePath) !== state.sourcePath ||
    state.stagingPath !== stateStagingPath(
      state as KeplerMigrationState,
      state.transactionId,
    ) ||
    state.temporaryMarkerPath !== expectedTemporaryMarkerPath(
      markerPath,
      state.transactionId,
    )
  ) {
    throw new Error("Invalid migration state");
  }
  return state as KeplerMigrationState;
};

const readMarkerValue = (markerPath: string): MigrationMarkerRecord => {
  const status = Fs.lstatSync(markerPath);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Invalid migration marker: ${markerPath}`);
  }
  try {
    const parsed = JSON.parse(Fs.readFileSync(markerPath, "utf8")) as MigrationJsonValue;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Invalid migration state");
    }
    return parsed as MigrationMarkerRecord;
  } catch (error) {
    throw new Error(`Invalid migration state: ${String(error)}`, { cause: error });
  }
};

const assertMarkerPair = (
  markerPath: string,
  state: KeplerMigrationState,
): Fs.Stats => {
  const markerStatus = Fs.lstatSync(markerPath);
  const temporaryStatus = Fs.lstatSync(state.temporaryMarkerPath);
  if (
    !markerStatus.isFile() ||
    markerStatus.isSymbolicLink() ||
    !temporaryStatus.isFile() ||
    temporaryStatus.isSymbolicLink() ||
    markerStatus.ino === 0 ||
    markerStatus.dev !== temporaryStatus.dev ||
    markerStatus.ino !== temporaryStatus.ino
  ) {
    throw new Error(`Invalid migration marker pair: ${markerPath}`);
  }
  return temporaryStatus;
};

const readMigrationState = (
  markerPath: string,
  legacyPath: string,
  canonicalPath: string,
): KeplerMigrationState => {
  const state = validateState(
    readMarkerValue(markerPath),
    legacyPath,
    canonicalPath,
    markerPath,
  );
  assertMarkerPair(markerPath, state);
  return state;
};

const legacyMarkerBelongsToPath = (
  markerPath: string,
  canonicalPath: string,
): boolean => {
  const value = readMarkerValue(markerPath);
  return value.canonicalPath === canonicalPath;
};

const findMigrationMarkerPath = (canonicalPath: string): string | undefined => {
  const currentMarker = migrationMarkerPath(canonicalPath);
  if (pathExists(currentMarker)) return currentMarker;

  const legacyMarker = legacyMigrationMarkerPath(canonicalPath);
  if (legacyMarker === currentMarker || !pathExists(legacyMarker)) return undefined;
  return legacyMarkerBelongsToPath(legacyMarker, canonicalPath)
    ? legacyMarker
    : undefined;
};

const createMigrationState = (
  legacyPath: string,
  sourcePath: string,
  canonicalPath: string,
  stagingPath: string,
  markerPath: string,
  transactionId: string,
  processIdentity: string,
): KeplerMigrationState => {
  const temporaryMarkerPath = expectedTemporaryMarkerPath(
    markerPath,
    transactionId,
  );
  const state: KeplerMigrationState = {
    format: migrationFormat,
    pid: process.pid,
    processIdentity,
    transactionId,
    legacyPath,
    sourcePath,
    canonicalPath,
    stagingPath,
    temporaryMarkerPath,
  };
  Fs.writeFileSync(temporaryMarkerPath, JSON.stringify(state), {
    flag: "wx",
    mode: 0o600,
  });
  try {
    Fs.linkSync(temporaryMarkerPath, markerPath);
  } catch (error) {
    Fs.rmSync(temporaryMarkerPath, { force: true });
    throw error;
  }
  return state;
};

export const migrationProcessIdentity = (pid: number): string | undefined => {
  if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
  try {
    if (process.platform === "linux") {
      const stat = Fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const closingParenthesis = stat.lastIndexOf(")");
      if (closingParenthesis < 0) return undefined;
      const fields = stat.slice(closingParenthesis + 2).trim().split(/\s+/);
      const startTime = fields[19];
      const bootId = Fs.readFileSync(
        "/proc/sys/kernel/random/boot_id",
        "utf8",
      ).trim();
      return startTime && bootId ? `linux:${bootId}:${startTime}` : undefined;
    }
    if (process.platform === "darwin") {
      const startTime = execFileSync(
        "ps",
        ["-p", String(pid), "-o", "lstart="],
        {
          encoding: "utf8",
          env: { ...process.env, LC_ALL: "C" },
          stdio: ["ignore", "pipe", "ignore"],
        },
      ).trim();
      return startTime ? `darwin:${startTime}` : undefined;
    }
    if (process.platform === "win32") {
      const startTime = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `(Get-Process -Id ${pid}).StartTime.ToUniversalTime().Ticks`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return startTime ? `windows:${startTime}` : undefined;
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

type LeaseOwnerStatus = "active" | "stale" | "unavailable";

const processOwnerStatus = (
  pid: number,
  expectedIdentity?: string,
): LeaseOwnerStatus => {
  if (!processIsAlive(pid)) return "stale";
  if (!expectedIdentity) return "unavailable";
  const currentIdentity = migrationProcessIdentity(pid);
  if (!currentIdentity) return "unavailable";
  return currentIdentity === expectedIdentity ? "active" : "stale";
};

const leaseOwnerStatus = (lease: MigrationLease): LeaseOwnerStatus =>
  processOwnerStatus(lease.pid, lease.processIdentity);

const readMigrationLease = (
  leasePath: string,
): { lease: MigrationLease; status: Fs.Stats } => {
  const status = Fs.lstatSync(leasePath);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Invalid migration lease: ${leasePath}`);
  }
  let parsed: MigrationJsonValue;
  try {
    parsed = JSON.parse(Fs.readFileSync(leasePath, "utf8")) as MigrationJsonValue;
  } catch (error) {
    throw new Error(`Invalid migration lease: ${String(error)}`, { cause: error });
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid migration lease: ${leasePath}`);
  }
  const lease = parsed as Partial<MigrationLease>;
  if (
    lease.format !== leaseFormat ||
    !Number.isSafeInteger(lease.pid) ||
    (lease.pid ?? 0) < 1 ||
    typeof lease.processIdentity !== "string" ||
    lease.processIdentity.length === 0 ||
    typeof lease.transactionId !== "string" ||
    !transactionIdPattern.test(lease.transactionId)
  ) {
    throw new Error(`Invalid migration lease: ${leasePath}`);
  }
  return { lease: lease as MigrationLease, status };
};

const removeLeaseIfOwned = (
  leasePath: string,
  ownedStatus: Fs.Stats,
): void => {
  try {
    const currentStatus = Fs.lstatSync(leasePath);
    if (
      currentStatus.isFile() &&
      !currentStatus.isSymbolicLink() &&
      currentStatus.dev === ownedStatus.dev &&
      currentStatus.ino === ownedStatus.ino
    ) {
      Fs.unlinkSync(leasePath);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
};

const acquireMigrationLease = (
  markerPath: string,
  transactionId: string,
): (() => void) => {
  const leasePath = migrationLeasePath(markerPath);
  const processIdentity = migrationProcessIdentity(process.pid);
  if (!processIdentity) {
    throw new Error("Cannot determine the current process identity for migration");
  }
  const lease: MigrationLease = {
    format: leaseFormat,
    pid: process.pid,
    processIdentity,
    transactionId,
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    let descriptor: number;
    try {
      descriptor = Fs.openSync(leasePath, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = readMigrationLease(leasePath);
      const ownerStatus = leaseOwnerStatus(existing.lease);
      if (ownerStatus === "active") {
        throw new Error(`Legacy data migration is already in progress: ${leasePath}`);
      }
      if (ownerStatus === "unavailable") {
        throw new Error(
          `Cannot verify migration lease owner PID ${existing.lease.pid}; preserving migration state`,
        );
      }
      const currentStatus = Fs.lstatSync(leasePath);
      if (
        currentStatus.dev !== existing.status.dev ||
        currentStatus.ino !== existing.status.ino
      ) {
        continue;
      }
      try {
        Fs.unlinkSync(leasePath);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw unlinkError;
      }
      continue;
    }

    const ownedStatus = Fs.fstatSync(descriptor);
    try {
      Fs.writeFileSync(descriptor, JSON.stringify(lease));
      Fs.fsyncSync(descriptor);
    } catch (error) {
      Fs.closeSync(descriptor);
      removeLeaseIfOwned(leasePath, ownedStatus);
      throw error;
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      Fs.closeSync(descriptor);
      removeLeaseIfOwned(leasePath, ownedStatus);
    };
  }

  throw new Error(`Could not acquire migration lease: ${leasePath}`);
};

const assertValidStagingDirectory = (state: KeplerMigrationState): void => {
  const status = Fs.lstatSync(state.stagingPath);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`Invalid migration staging directory: ${state.stagingPath}`);
  }
  const ownerMarkerPath = migrationOwnershipMarkerPath(state);
  const ownerStatus = Fs.lstatSync(ownerMarkerPath);
  if (!ownerStatus.isFile() || ownerStatus.isSymbolicLink()) {
    throw new Error(`Invalid migration staging ownership marker: ${ownerMarkerPath}`);
  }
  const ownerContents = Fs.readFileSync(ownerMarkerPath, "utf8");
  if (ownerContents !== `${ownershipFormat}\n${state.transactionId}\n`) {
    throw new Error(`Invalid migration staging ownership marker: ${ownerMarkerPath}`);
  }
};

const assertValidCanonicalOwnership = (state: KeplerMigrationState): void => {
  const ownerMarkerPath = migrationCanonicalOwnershipMarkerPath(state);
  const ownerStatus = Fs.lstatSync(ownerMarkerPath);
  if (!ownerStatus.isFile() || ownerStatus.isSymbolicLink()) {
    throw new Error(`Invalid canonical migration ownership marker: ${ownerMarkerPath}`);
  }
  const ownerContents = Fs.readFileSync(ownerMarkerPath, "utf8");
  if (ownerContents !== `${canonicalOwnershipFormat}\n${state.transactionId}\n`) {
    throw new Error(`Invalid canonical migration ownership marker: ${ownerMarkerPath}`);
  }
};

const writeCanonicalOwnershipMarker = (
  state: KeplerMigrationState,
): void => {
  Fs.writeFileSync(
    migrationCanonicalOwnershipMarkerPath(state),
    `${canonicalOwnershipFormat}\n${state.transactionId}\n`,
    { flag: "wx", mode: 0o600 },
  );
};

const removeCanonicalOwnershipMarker = (state: KeplerMigrationState): void => {
  const canonical = inspectCanonicalDirectory(
    state.canonicalPath,
    state.sourcePath,
  );
  if (canonical.isSymlink) {
    throw new Error(
      `Canonical data path became a symlink during migration: ${state.canonicalPath}`,
    );
  }
  const ownerMarkerPath = migrationCanonicalOwnershipMarkerPath(state);
  if (!pathExists(ownerMarkerPath)) return;
  assertValidCanonicalOwnership(state);
  Fs.unlinkSync(ownerMarkerPath);
};

const clearMigrationState = (
  state: KeplerMigrationState,
  markerPath: string,
): void => {
  assertValidStagingDirectory(state);
  const temporaryStatus = assertMarkerPair(markerPath, state);
  Fs.unlinkSync(markerPath);
  if (pathExists(state.temporaryMarkerPath)) {
    const currentTemporaryStatus = Fs.lstatSync(state.temporaryMarkerPath);
    if (
      currentTemporaryStatus.isFile() &&
      !currentTemporaryStatus.isSymbolicLink() &&
      currentTemporaryStatus.dev === temporaryStatus.dev &&
      currentTemporaryStatus.ino === temporaryStatus.ino
    ) {
      Fs.unlinkSync(state.temporaryMarkerPath);
    }
  }
  Fs.rmSync(state.stagingPath, { recursive: true, force: true });
};

const copyStagingIntoCanonical = (
  state: KeplerMigrationState,
): void => {
  assertValidStagingDirectory(state);
  const canonical = inspectCanonicalDirectory(
    state.canonicalPath,
    state.sourcePath,
  );
  if (canonical.isSymlink) {
    throw new Error(
      `Canonical data path became a symlink during migration: ${state.canonicalPath}`,
    );
  }
  assertValidCanonicalOwnership(state);
  const ownerMarkerPath = migrationOwnershipMarkerPath(state);
  Fs.cpSync(state.stagingPath, state.canonicalPath, {
    recursive: true,
    errorOnExist: false,
    filter: (source) => Path.resolve(source) !== ownerMarkerPath,
    force: true,
    verbatimSymlinks: true,
  });
};

const removeEmptyDirectory = (path: string): void => {
  try {
    Fs.rmdirSync(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTEMPTY" && code !== "EEXIST") {
      throw error;
    }
  }
};

const finishMigration = (
  state: KeplerMigrationState,
  markerPath: string,
  recovering: boolean,
): string => {
  assertValidStagingDirectory(state);
  if (pathExists(state.canonicalPath)) {
    const canonical = inspectCanonicalDirectory(
      state.canonicalPath,
      state.sourcePath,
    );
    if (canonical.isSymlink) {
      throw new Error(
        `Canonical data path became a symlink during migration: ${state.canonicalPath}`,
      );
    }
    if (!recovering) {
      throw new Error(
        `Canonical data path appeared while migration was in progress: ${state.canonicalPath}`,
      );
    }
    assertValidCanonicalOwnership(state);
  } else {
    try {
      Fs.mkdirSync(state.canonicalPath);
    } catch (error) {
      if (pathExists(state.canonicalPath)) {
        const canonical = inspectCanonicalDirectory(
          state.canonicalPath,
          state.sourcePath,
        );
        if (canonical.isSymlink) {
          throw new Error(
            `Canonical data path became a symlink during migration: ${state.canonicalPath}`,
            { cause: error },
          );
        }
        throw new Error(
          `Canonical data path appeared while migration was in progress: ${state.canonicalPath}`,
          { cause: error },
        );
      }
      throw error;
    }
    try {
      writeCanonicalOwnershipMarker(state);
    } catch (error) {
      try {
        removeEmptyDirectory(state.canonicalPath);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to clean an incomplete canonical directory: ${state.canonicalPath}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  copyStagingIntoCanonical(state);
  clearMigrationState(state, markerPath);
  removeCanonicalOwnershipMarker(state);
  return state.canonicalPath;
};

const assertLegacyMigrationOwnerInactive = (
  state: KeplerMigrationState,
): void => {
  if (state.format !== legacyMigrationFormat) return;
  const status = processOwnerStatus(state.pid, state.processIdentity);
  if (status === "active") {
    throw new Error(
      `Legacy data migration is already in progress: ${state.canonicalPath}`,
    );
  }
  if (status === "unavailable") {
    throw new Error(
      `Cannot verify legacy migration owner PID ${state.pid}; preserving migration state`,
    );
  }
};

const recoverMigration = (
  legacyPath: string,
  canonicalPath: string,
  markerPath: string,
): string => {
  let initialState: KeplerMigrationState;
  try {
    initialState = readMigrationState(markerPath, legacyPath, canonicalPath);
  } catch (error) {
    if (!pathExists(markerPath) && pathExists(canonicalPath)) {
      inspectCanonicalDirectory(canonicalPath);
      return canonicalPath;
    }
    throw error;
  }
  assertLegacyMigrationOwnerInactive(initialState);
  assertDisjointPaths(
    initialState.sourcePath,
    resolveThroughExistingAncestor(canonicalPath),
  );
  const releaseLease = acquireMigrationLease(
    markerPath,
    initialState.transactionId,
  );
  try {
    if (!pathExists(markerPath)) {
      if (pathExists(canonicalPath)) {
        inspectCanonicalDirectory(canonicalPath, initialState.sourcePath);
        return canonicalPath;
      }
      throw new Error(`Migration state disappeared before recovery: ${markerPath}`);
    }
    const state = readMigrationState(markerPath, legacyPath, canonicalPath);
    if (state.transactionId !== initialState.transactionId) {
      throw new Error(`Migration transaction changed during recovery: ${markerPath}`);
    }
    assertDisjointPaths(
      state.sourcePath,
      resolveThroughExistingAncestor(canonicalPath),
    );
    return finishMigration(state, markerPath, true);
  } finally {
    releaseLease();
  }
};

export function resolveLegacyDataPath(
  legacyPath: string,
  canonicalPath: string,
): string {
  const legacy = Path.resolve(legacyPath);
  const canonical = Path.resolve(canonicalPath);
  let legacyExists: boolean;
  let canonicalExists: boolean;
  let sourcePath: string | undefined;

  try {
    legacyExists = pathExists(legacy);
    canonicalExists = pathExists(canonical);
    if (legacyExists) sourcePath = Fs.realpathSync(legacy);
    if (sourcePath) assertDisjointPaths(sourcePath, canonical);
    if (canonicalExists) inspectCanonicalDirectory(canonical, sourcePath);
    const markerPath = findMigrationMarkerPath(canonical);
    if (markerPath) return recoverMigration(legacy, canonical, markerPath);
    if (canonicalExists) return canonical;
    if (!legacyExists) return canonical;
    if (!Fs.statSync(legacy).isDirectory()) {
      throw new Error(`Legacy data path is not a directory: ${legacy}`);
    }
  } catch (error) {
    if (error instanceof KeplerMigrationError) throw error;
    throw new KeplerMigrationError(legacy, canonical, error);
  }

  if (!sourcePath) {
    throw new KeplerMigrationError(
      legacy,
      canonical,
      new Error("Legacy data path could not be resolved"),
    );
  }

  const processIdentity = migrationProcessIdentity(process.pid);
  if (!processIdentity) {
    throw new KeplerMigrationError(
      legacy,
      canonical,
      new Error("Cannot determine the current process identity for migration"),
    );
  }

  const transactionId = randomUUID();
  const stagingPath = migrationStagingPath(canonical, transactionId);
  let stagingCreated = false;

  try {
    Fs.mkdirSync(Path.dirname(canonical), { recursive: true });
    Fs.mkdirSync(stagingPath);
    stagingCreated = true;
    Fs.cpSync(sourcePath, stagingPath, {
      recursive: true,
      errorOnExist: false,
      force: false,
      verbatimSymlinks: true,
    });
    const initialState: KeplerMigrationState = {
      format: migrationFormat,
      pid: process.pid,
      processIdentity,
      transactionId,
      legacyPath: legacy,
      sourcePath,
      canonicalPath: canonical,
      stagingPath,
      temporaryMarkerPath: expectedTemporaryMarkerPath(
        migrationMarkerPath(canonical),
        transactionId,
      ),
    };
    Fs.writeFileSync(
      migrationOwnershipMarkerPath(initialState),
      `${ownershipFormat}\n${transactionId}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (stagingCreated) {
      Fs.rmSync(stagingPath, { recursive: true, force: true });
    }
    throw new KeplerMigrationError(legacy, canonical, error);
  }

  const markerPath = migrationMarkerPath(canonical);
  let state: KeplerMigrationState;
  try {
    state = createMigrationState(
      legacy,
      sourcePath,
      canonical,
      stagingPath,
      markerPath,
      transactionId,
      processIdentity,
    );
  } catch (error) {
    if (stagingCreated) {
      Fs.rmSync(stagingPath, { recursive: true, force: true });
    }
    throw new KeplerMigrationError(legacy, canonical, error);
  }

  try {
    const releaseLease = acquireMigrationLease(markerPath, state.transactionId);
    try {
      return finishMigration(state, markerPath, false);
    } finally {
      releaseLease();
    }
  } catch (error) {
    throw new KeplerMigrationError(legacy, canonical, error);
  }
}
