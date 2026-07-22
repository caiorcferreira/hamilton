import * as Fs from "node:fs"
import * as Path from "node:path"

export interface ResolveBundleRootOptions {
  env?: NodeJS.ProcessEnv
  execPath?: string
  sourceDir?: string
  existsSync?: (path: string) => boolean
  realpathSync?: (path: string) => string
}

export class BundleRootNotFoundError extends Error {
  constructor(checked: string[]) {
    super(`Could not locate the Hamilton bundle directory. Checked:\n${checked.map((p) => `  - ${p}`).join("\n")}`)
    this.name = "BundleRootNotFoundError"
  }
}

export function resolveBundleRoot(options: ResolveBundleRootOptions = {}): string {
  const env = options.env ?? process.env
  const execPath = options.execPath ?? process.execPath
  const sourceDir = options.sourceDir ?? import.meta.dirname
  const existsSync = options.existsSync ?? Fs.existsSync
  const realpathSync = options.realpathSync ?? Fs.realpathSync

  const checked: string[] = []

  const override = env.HAMILTON_BUNDLE_DIR
  if (override) {
    checked.push(override)
    if (existsSync(override)) return override
  }

  const binarySibling = Path.join(Path.dirname(Path.dirname(realpathSync(execPath))), "bundle")
  checked.push(binarySibling)
  if (existsSync(binarySibling)) return binarySibling

  const sourceCheckout = Path.join(Path.resolve(sourceDir, "..", ".."), "bundle")
  checked.push(sourceCheckout)
  if (existsSync(sourceCheckout)) return sourceCheckout

  throw new BundleRootNotFoundError(checked)
}
