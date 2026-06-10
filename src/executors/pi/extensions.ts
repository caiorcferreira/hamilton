import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../../paths.js"
import { createRtkExtension } from "./rtk-extension.js"
import lsp from "@narumitw/pi-lsp"

export interface ExtensionEntry {
  name: string
  enabled: boolean
}

export interface ExtensionSettings {
  extensions?: ExtensionEntry[]
}

export function readExtensionSettings(): ExtensionSettings {
  try {
    const path = settingsPath()
    if (!Fs.existsSync(path)) return {}
    const raw = Fs.readFileSync(path, "utf-8")
    const parsed = Yaml.parse(raw) as ExtensionSettings
    if (!parsed || typeof parsed !== "object") return {}
    return parsed
  } catch {
    return {}
  }
}

export type ExtensionFactory =
  | (() => void)
  | ((pi: unknown) => void)
  | ((pi: unknown) => Promise<void>)

export function buildExtensions(
  settings: ExtensionSettings
): ExtensionFactory[] {
  const entries = settings.extensions ?? []
  const factories: ExtensionFactory[] = []

  for (const entry of entries) {
    if (entry.enabled === false) continue

    switch (entry.name) {
      case "rtk":
        factories.push(createRtkExtension({ disabled: false }) as ExtensionFactory)
        break
      case "lsp":
        factories.push(lsp as ExtensionFactory)
        break
    }
  }

  return factories
}