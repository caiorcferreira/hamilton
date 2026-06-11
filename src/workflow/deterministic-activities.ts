import { Effect, Data } from "effect"
import * as ChildProcess from "node:child_process"
import * as Fs from "node:fs"
import * as Path from "node:path"
import * as Os from "node:os"

export class WorktreeError extends Data.TaggedError("WorktreeError")<{
  taskId: string
  message: string
}> {}

export interface CreateGitWorktreeParams {
  repo: string
  branch: string
  worktreePath?: string
}

export interface CleanupGitWorktreeParams {
  worktreePath: string
}

function execSync(cmd: string, cwd?: string): string {
  try {
    return ChildProcess.execSync(cmd, { cwd, encoding: "utf-8", timeout: 30000 }).trim()
  } catch (e) {
    throw new Error(`Command failed: ${cmd}\n${e instanceof Error ? e.message : String(e)}`)
  }
}

export function createGitWorktree(
  params: CreateGitWorktreeParams,
  taskId: string
): Effect.Effect<{ worktreePath: string; branch: string }, WorktreeError> {
  return Effect.gen(function* () {
    const repo = params.repo
    const branch = params.branch

    if (!Fs.existsSync(repo)) {
      return yield* Effect.fail(
        new WorktreeError({ taskId, message: `Repository path does not exist: ${repo}` })
      )
    }

    const worktreeBase = params.worktreePath ?? Path.join(Os.tmpdir(), "hamilton-worktrees")
    const worktreeName = `${Path.basename(repo)}-${branch}-${Date.now()}`
    const worktreePath = Path.join(worktreeBase, worktreeName)

    try {
      execSync(`git fetch origin`, repo)
      const branchExists = execSync(`git branch --list ${branch}`, repo)
      if (branchExists) {
        execSync(`git worktree add "${worktreePath}" ${branch}`, repo)
      } else {
        const remoteBranch = execSync(`git branch --list --remotes "origin/${branch}"`, repo)
        if (remoteBranch) {
          execSync(`git worktree add "${worktreePath}" -b ${branch} origin/${branch}`, repo)
        } else {
          execSync(`git worktree add -b ${branch} "${worktreePath}" HEAD`, repo)
        }
      }
    } catch (e) {
      return yield* Effect.fail(
        new WorktreeError({ taskId, message: `Failed to create worktree: ${e instanceof Error ? e.message : String(e)}` })
      )
    }

    return { worktreePath, branch }
  })
}

export function cleanupGitWorktree(
  params: CleanupGitWorktreeParams,
  taskId: string
): Effect.Effect<{ cleaned: boolean }, WorktreeError> {
  return Effect.gen(function* () {
    const worktreePath = params.worktreePath

    if (!Fs.existsSync(worktreePath)) {
      return { cleaned: true }
    }

    const repoPath = execSync(`git rev-parse --show-toplevel 2>/dev/null || echo ""`, worktreePath).trim()

    try {
      if (repoPath && Fs.existsSync(repoPath)) {
        try {
          execSync(`git worktree remove "${worktreePath}" --force`, repoPath)
        } catch {
          execSync(`git worktree remove "${worktreePath}" --force`, repoPath)
        }
      }

      if (Fs.existsSync(worktreePath)) {
        Fs.rmSync(worktreePath, { recursive: true, force: true })
      }
    } catch (e) {
      return yield* Effect.fail(
        new WorktreeError({ taskId, message: `Failed to cleanup worktree: ${e instanceof Error ? e.message : String(e)}` })
      )
    }

    return { cleaned: true }
  })
}