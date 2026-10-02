import * as Fs from "node:fs";
import * as Os from "node:os";
import * as Path from "node:path";
import { loadKeplerSettings, type KeplerSettings } from "./config.js";
import {
  legacyMigrationMarkerPath,
  migrationMarkerPath,
  resolveLegacyDataPath,
} from "./migration.js";

export interface KeplerEnvironment {
  HOME?: string;
  XDG_CONFIG_HOME?: string;
}

export interface KeplerServiceOptions {
  homeDirectory?: string;
  xdgConfigHome?: string;
  environment?: KeplerEnvironment;
}

export interface KeplerGlobalPaths {
  home: string;
  templates: string;
  guidelines: string;
  settings: string;
}

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

export class KeplerService {
  private readonly homeDirectory: string;
  private readonly configHome: string;

  constructor(options: KeplerServiceOptions = {}) {
    const environment = options.environment ?? process.env;
    this.homeDirectory = Path.resolve(
      options.homeDirectory || environment.HOME || Os.homedir(),
    );

    const configuredXdgHome = options.xdgConfigHome ?? environment.XDG_CONFIG_HOME;
    this.configHome = configuredXdgHome && Path.isAbsolute(configuredXdgHome)
      ? Path.resolve(configuredXdgHome)
      : Path.join(this.homeDirectory, ".config");
  }

  globalPaths(): KeplerGlobalPaths {
    const home = this.globalHome();
    return {
      home,
      templates: Path.join(home, "templates"),
      guidelines: Path.join(home, "guidelines"),
      settings: Path.join(home, "settings.yaml"),
    };
  }

  globalHome(): string {
    const canonicalPath = Path.join(
      this.configHome,
      "vialactea-works",
      "kepler",
    );
    const previousCanonicalPath = Path.join(
      this.configHome,
      ".vialactea-works",
      "kepler",
    );
    const previousMigrationInProgress =
      pathExists(migrationMarkerPath(previousCanonicalPath)) ||
      pathExists(legacyMigrationMarkerPath(previousCanonicalPath));
    if (!pathExists(previousCanonicalPath) && !previousMigrationInProgress) {
      return resolveLegacyDataPath(
        Path.join(this.homeDirectory, ".hamilton"),
        canonicalPath,
      );
    }
    const migratedPreviousPath = resolveLegacyDataPath(
      Path.join(this.homeDirectory, ".hamilton"),
      previousCanonicalPath,
    );
    return resolveLegacyDataPath(migratedPreviousPath, canonicalPath);
  }

  projectDataPath(projectRoot: string): string {
    const root = Path.resolve(projectRoot);
    return resolveLegacyDataPath(
      Path.join(root, ".hamilton"),
      Path.join(root, ".kepler"),
    );
  }

  ensureGlobalHome(): KeplerGlobalPaths {
    const paths = this.globalPaths();
    for (const directory of [paths.home, paths.templates, paths.guidelines]) {
      Fs.mkdirSync(directory, { recursive: true });
    }
    return paths;
  }

  loadConfig(): KeplerSettings | undefined {
    const settingsPath = this.globalPaths().settings;
    if (!pathExists(settingsPath)) return undefined;
    return loadKeplerSettings(settingsPath);
  }
}
