import * as Path from "node:path"
import { hamiltonHome } from "../../paths.js"

export function piAgentDir(): string {
  return Path.join(hamiltonHome(), "executors", "pi", "agent")
}
