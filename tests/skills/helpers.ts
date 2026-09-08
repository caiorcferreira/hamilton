import * as Fs from "node:fs"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryDir = Path.resolve(Path.dirname(fileURLToPath(import.meta.url)), "../..")

export function readSkill(name: string): string {
  return Fs.readFileSync(Path.join(repositoryDir, "skills", name, "SKILL.md"), "utf-8")
}

export function section(content: string, heading: string): string {
  const start = content.indexOf(heading)
  if (start === -1) {
    return ""
  }
  const rest = content.slice(start + heading.length)
  const next = rest.search(/\n## /)
  return next === -1 ? rest : rest.slice(0, next)
}
