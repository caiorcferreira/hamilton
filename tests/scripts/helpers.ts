import { spawnSync } from "node:child_process"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { fileURLToPath } from "node:url"

const here = Path.dirname(fileURLToPath(import.meta.url))

/** The scripts under test, read from the bundle rather than an installed ~/.hamilton. */
export const SCRIPTS_DIR = Path.resolve(here, "../../bundle/scripts")

export interface RunResult {
  status: number
  stdout: string
  stderr: string
  /** Non-empty stdout lines. */
  lines: string[]
  /** The load-bearing line: every script puts its result last. */
  lastLine: string
}

/**
 * Run a script through `bash` explicitly — the exec bit is `hamilton setup`'s job
 * (covered in tests/cli/setup.test.ts), not a precondition for testing behavior.
 */
export function run(name: string, args: string[], cwd: string): RunResult {
  const result = spawnSync("bash", [Path.join(SCRIPTS_DIR, name), ...args], {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }
  })
  const stdout = result.stdout ?? ""
  const lines = stdout.split("\n").filter((line) => line !== "")
  return {
    status: result.status ?? -1,
    stdout,
    stderr: result.stderr ?? "",
    lines,
    lastLine: lines.at(-1) ?? ""
  }
}

export function git(cwd: string, ...args: string[]): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" }
  })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr}`)
  }
  return (result.stdout ?? "").trim()
}

const created: string[] = []

export function makeRepo(options?: { defaultBranch?: string }): string {
  // realpath: macOS resolves /var -> /private/var, and the scripts report `pwd -P`.
  const dir = Fs.mkdtempSync(Path.join(Fs.realpathSync(Os.tmpdir()), "hamilton-script-"))
  created.push(dir)
  git(dir, "init", "-q", "-b", options?.defaultBranch ?? "main")
  git(dir, "config", "user.email", "test@example.com")
  git(dir, "config", "user.name", "Test")
  git(dir, "config", "commit.gpgsign", "false")
  write(dir, "README.md", "# fixture\n")
  git(dir, "add", "-A")
  git(dir, "commit", "-q", "-m", "initial")
  return dir
}

export function cleanupRepos(): void {
  for (const dir of created.splice(0)) {
    Fs.rmSync(dir, { recursive: true, force: true })
  }
}

export function write(repo: string, relPath: string, content: string): string {
  const full = Path.join(repo, relPath)
  Fs.mkdirSync(Path.dirname(full), { recursive: true })
  Fs.writeFileSync(full, content)
  return full
}

export function commitAll(repo: string, message: string): string {
  git(repo, "add", "-A")
  git(repo, "commit", "-q", "-m", message)
  return git(repo, "rev-parse", "HEAD")
}

/** Create `.hamilton/changes/<slug>/` and return its absolute path. */
export function makeChangeDir(repo: string, slug: string): string {
  const dir = Path.join(repo, ".hamilton", "changes", slug)
  Fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** The value after `<key>: ` on the first matching output line. */
export function field(result: RunResult, key: string): string | undefined {
  const line = result.lines.find((l) => l.startsWith(`${key}: `))
  return line?.slice(key.length + 2)
}
