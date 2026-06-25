import * as Fs from "node:fs"
import * as Yaml from "yaml"
import { settingsPath } from "../../../paths.js"
import { createRtkExtension } from "./rtk-extension.js"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import lsp from "@narumitw/pi-lsp"

export interface ExtensionEntry {
  name: string
  enabled: boolean
  parameters?: Record<string, unknown>
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

export type ExtensionFactory = (pi: ExtensionAPI) => void

// todo: support other entry names
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