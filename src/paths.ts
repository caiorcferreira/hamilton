import * as Path from "node:path"
import * as Os from "node:os"
import * as Fs from "node:fs"

export function hamiltonHome(): string {
  const home = process.env.HOME ?? Os.homedir()
  return Path.join(home, ".hamilton")
}

export function guidelinesDir(): string {
  return Path.join(hamiltonHome(), "guidelines")
}

export function templatesDir(): string {
  return Path.join(hamiltonHome(), "templates")
}

export function settingsPath(): string {
  return Path.join(hamiltonHome(), "settings.yaml")
}

export function ensureHamiltonHome(): void {
  const dirs = [
    hamiltonHome(),
    templatesDir(),
    guidelinesDir()
  ]
  for (const dir of dirs) {
    if (!Fs.existsSync(dir)) {
      Fs.mkdirSync(dir, { recursive: true })
    }
  }
}
