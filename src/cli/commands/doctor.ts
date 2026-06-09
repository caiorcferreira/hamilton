import { Command } from "@effect/cli"
import { Console, Effect } from "effect"
import * as ChildProcess from "node:child_process"
import { green, red } from "../formatting/colors.js"

interface CheckResult {
  name: string
  pass: boolean
  detail: string
}

const compareSemver = (a: string, b: string): number => {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0
    const vb = pb[i] ?? 0
    if (va > vb) return 1
    if (va < vb) return -1
  }
  return 0
}

function makeBinaryCheck(name: string, binary: string, installHint: string): Effect.Effect<CheckResult> {
  return Effect.sync(() => {
    try {
      const path = ChildProcess.execSync(`which ${binary}`, { encoding: "utf-8" }).trim()
      return { name, pass: true, detail: path }
    } catch {
      return { name, pass: false, detail: `not found (install: ${installHint})` }
    }
  })
}

const checkRtk: Effect.Effect<CheckResult> = Effect.gen(function* () {
  return yield* Effect.sync(() => {
    const rtkPath = (() => {
      try { return ChildProcess.execSync("which rtk", { encoding: "utf-8" }).trim() }
      catch { return null }
    })()

    if (!rtkPath) {
      return { name: "rtk", pass: false, detail: "not found (install: npm install -g @rtk-ai/rtk)" }
    }

    const version = (() => {
      try { return ChildProcess.execSync("rtk --version", { encoding: "utf-8" }).trim() }
      catch { return null }
    })()

    if (!version) {
      return { name: "rtk", pass: false, detail: "found but version could not be determined" }
    }

    if (compareSemver(version, "0.23.0") >= 0) {
      return { name: "rtk", pass: true, detail: `${version}  ${rtkPath}` }
    }
    return {
      name: "rtk",
      pass: false,
      detail: `${version} (need >= 0.23.0; upgrade: npm install -g @rtk-ai/rtk@latest)`
    }
  })
})

const checkLspTs = makeBinaryCheck("lsp-ts", "typescript-language-server", "npm install -g typescript-language-server")
const checkLspPython = makeBinaryCheck("lsp-py", "pylsp", "pip install python-lsp-server")
const checkLspGo = makeBinaryCheck("lsp-go", "gopls", "go install golang.org/x/tools/gopls@latest")
const checkLspJava = makeBinaryCheck("lsp-java", "jdtls", "brew install jdtls")

const checks: Array<Effect.Effect<CheckResult>> = [
  checkRtk,
  checkLspTs,
  checkLspPython,
  checkLspGo,
  checkLspJava,
]

export const doctorCommand = Command.make("doctor", {}, () =>
  Effect.gen(function* () {
    const results = yield* Effect.all(checks, { concurrency: "unbounded" })
    for (const r of results) {
      const mark = r.pass ? green("  ✓") : red("  ✗")
      yield* Console.log(`${mark} ${r.name.padEnd(10)}  ${r.detail}`)
    }
  })
).pipe(Command.withDescription("Check prerequisites for running Hamilton"))