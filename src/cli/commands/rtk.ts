import { Effect } from "effect"
import * as ChildProcess from "node:child_process"

export interface RtkStatus {
  installed: boolean
  version: string | null
  path: string | null
  message: string
}

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

export const verifyRtk: Effect.Effect<RtkStatus, never> = Effect.gen(function* () {
  const rtkPath = yield* Effect.sync((): string | null => {
    try {
      return ChildProcess.execSync("which rtk", { encoding: "utf-8" }).trim() || null
    } catch {
      return null
    }
  })

  if (!rtkPath) {
    return {
      installed: false,
      version: null,
      path: null,
      message: "rtk not found in PATH. Install with: npm install -g @rtk-ai/rtk"
    }
  }

  const version = yield* Effect.sync((): string | null => {
    try {
      const out = ChildProcess.execSync("rtk --version", { encoding: "utf-8" }).trim()
      return out || null
    } catch {
      return null
    }
  })

  if (!version) {
    return {
      installed: true,
      version: null,
      path: rtkPath,
      message: "rtk found but version could not be determined"
    }
  }

  const minVersion = "0.23.0"
  const meetsMinimum = compareSemver(version, minVersion) >= 0

  return {
    installed: true,
    version,
    path: rtkPath,
    message: meetsMinimum
      ? "OK"
      : `rtk ${version} found but minimum required is ${minVersion}. Upgrade with: npm install -g @rtk-ai/rtk@latest`
  }
})