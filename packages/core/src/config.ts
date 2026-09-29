import * as Fs from "node:fs";
import * as Yaml from "yaml";

export type KeplerSettings = Record<string, unknown>;

export class KeplerConfigError extends Error {
  constructor(
    readonly configPath: string,
    message: string,
    cause?: unknown,
  ) {
    super(`Failed to load Kepler config at ${configPath}: ${message}`, { cause });
    this.name = "KeplerConfigError";
  }
}

export function parseKeplerSettings(
  content: string,
  configPath = "<settings>",
): KeplerSettings {
  let document: Yaml.Document;
  try {
    document = Yaml.parseDocument(content);
  } catch (error) {
    throw new KeplerConfigError(configPath, String(error), error);
  }

  if (document.errors.length > 0) {
    throw new KeplerConfigError(
      configPath,
      document.errors.map((error) => error.message).join("; "),
    );
  }

  if (document.contents === null) return {};

  let parsed: unknown;
  try {
    parsed = document.toJS();
  } catch (error) {
    throw new KeplerConfigError(configPath, String(error), error);
  }

  if (parsed === undefined) return {};
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new KeplerConfigError(configPath, "the document root must be a mapping");
  }
  const prototype = Object.getPrototypeOf(parsed);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new KeplerConfigError(configPath, "the document root must be a mapping");
  }
  return parsed as KeplerSettings;
}

export function loadKeplerSettings(configPath: string): KeplerSettings {
  let content: string;
  try {
    content = Fs.readFileSync(configPath, "utf8");
  } catch (error) {
    throw new KeplerConfigError(configPath, String(error), error);
  }
  return parseKeplerSettings(content, configPath);
}
