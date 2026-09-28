import { Inject, Injectable } from "@nestjs/common";
import * as Path from "node:path";
import { buildSettingsYaml } from "./setup-settings.js";
import {
  SETUP_BUNDLE_LOCATOR,
  SETUP_FILE_SYSTEM_HOME,
  type SetupBundleLocator,
  type SetupFileSystemHome,
} from "./setup-runtime.js";

export interface SetupResult {
  templates: string[];
}

@Injectable()
export class SetupService {
  constructor(
    @Inject(SETUP_FILE_SYSTEM_HOME)
    private readonly fileSystem: SetupFileSystemHome,
    @Inject(SETUP_BUNDLE_LOCATOR)
    private readonly bundleLocator: SetupBundleLocator,
  ) {}

  setup(): SetupResult {
    try {
      this.fileSystem.ensureHamiltonHome();
    } catch (error) {
      throw new Error(
        `Failed to create hamilton home directories: ${String(error)}`,
      );
    }

    let bundleRoot: string;
    try {
      bundleRoot = this.bundleLocator();
    } catch (error) {
      throw new Error(String(error));
    }

    const templates = this.copyTemplates(bundleRoot);
    this.copyGuidelineManifests(bundleRoot);
    this.writeDefaultSettings();

    return { templates };
  }

  private copyGuidelineManifests(bundleRoot: string): void {
    const source = Path.join(bundleRoot, "guidelines");
    try {
      if (!this.fileSystem.existsSync(source)) return;
      this.fileSystem.copyDirectory(source, this.fileSystem.guidelinesDir());
    } catch (error) {
      throw new Error(
        `Failed to copy guideline manifests: ${String(error)}`,
      );
    }
  }

  private copyTemplates(bundleRoot: string): string[] {
    const source = Path.join(bundleRoot, "templates");
    try {
      if (!this.fileSystem.existsSync(source)) return [];

      const destination = this.fileSystem.templatesDir();
      this.fileSystem.copyDirectory(source, destination);

      return this.fileSystem
        .readdirRecursive(destination)
        .filter((name) =>
          this.fileSystem.isFile(Path.join(destination, name)),
        )
        .map((name) => name.split(Path.sep).join("/"))
        .sort();
    } catch (error) {
      throw new Error(`Failed to copy templates: ${String(error)}`);
    }
  }

  private writeDefaultSettings(): void {
    try {
      const path = this.fileSystem.settingsPath();
      if (!this.fileSystem.existsSync(path)) {
        this.fileSystem.writeFileSync(path, buildSettingsYaml());
      }
    } catch (error) {
      throw new Error(`Failed to write settings: ${String(error)}`);
    }
  }
}
