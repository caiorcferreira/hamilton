import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Yaml from "yaml"
import { settingsPath } from "../../paths.js"
import { piAgentDir } from "./paths.js"

export function reconcileLspConfig(): void {
  const settingsFile = settingsPath()
  if (!Fs.existsSync(settingsFile)) return
  const raw = Fs.readFileSync(settingsFile, "utf-8")
  const doc = Yaml.parse(raw)
  const servers = (doc as Record<string, unknown> | null)?.lsp as Record<string, unknown> | undefined
  if (!servers || !servers.servers) return
  const dest = Path.join(piAgentDir(), "lsp.json")
  if (!Fs.existsSync(Path.dirname(dest))) {
    Fs.mkdirSync(Path.dirname(dest), { recursive: true })
  }
  Fs.writeFileSync(dest, JSON.stringify(servers.servers, null, 2) + "\n")
}

export function reconcileSettingsToPi(): void {
  reconcileLspConfig()
}