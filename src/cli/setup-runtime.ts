import * as Fs from "node:fs";
import {
  ensureHamiltonHome,
  guidelinesDir,
  settingsPath,
  templatesDir,
} from "../paths.js";
import { resolveBundleRoot } from "./bundle-root.js";

export interface SetupFileSystemHome {
  ensureHamiltonHome(): void;
  existsSync(path: string): boolean;
  copyDirectory(source: string, destination: string): void;
  readdirRecursive(path: string): string[];
  isFile(path: string): boolean;
  writeFileSync(path: string, content: string): void;
  guidelinesDir(): string;
  settingsPath(): string;
  templatesDir(): string;
}

export type SetupBundleLocator = () => string;

export const SETUP_FILE_SYSTEM_HOME = Symbol("SETUP_FILE_SYSTEM_HOME");
export const SETUP_BUNDLE_LOCATOR = Symbol("SETUP_BUNDLE_LOCATOR");

export function createSetupRuntime(): {
  fileSystemHome: SetupFileSystemHome;
  bundleLocator: SetupBundleLocator;
} {
  return {
    fileSystemHome: {
      ensureHamiltonHome,
      existsSync: (path) => Fs.existsSync(path),
      copyDirectory: (source, destination) =>
        Fs.cpSync(source, destination, { recursive: true, force: true }),
      readdirRecursive: (path) =>
        Fs.readdirSync(path, { recursive: true }) as string[],
      isFile: (path) => Fs.statSync(path).isFile(),
      writeFileSync: (path, content) => Fs.writeFileSync(path, content),
      guidelinesDir,
      settingsPath,
      templatesDir,
    },
    bundleLocator: resolveBundleRoot,
  };
}
