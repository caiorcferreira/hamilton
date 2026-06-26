import { defineTool } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"

export function createGitExtension(projectDir: string): (pi: ExtensionAPI) => void {
  return (pi: ExtensionAPI) => {
    pi.registerTool(defineTool({
      name: "git_diff",
      label: "Git Diff",
      description: "Show git diff for the working directory. Set staged=true to see staged changes (git diff --cached). Defaults to unstaged changes.",
      parameters: Type.Object({
        staged: Type.Optional(Type.Boolean({ description: "Show staged changes instead of unstaged (default: false)" }))
      }),
      promptSnippet: "- git_diff: shows current git diff (staged or unstaged)",
      execute: async (_toolCallId, { staged }, _signal, _onUpdate, _ctx) => {
        try {
          const args = staged ? ["diff", "--cached"] : ["diff"]
          const proc = Bun.spawnSync(["git", ...args], {
            cwd: projectDir,
            stdout: "pipe",
            stderr: "pipe"
          })
          const output = new TextDecoder().decode(proc.stdout)
          const errorOutput = new TextDecoder().decode(proc.stderr)

          if (proc.exitCode !== 0 && errorOutput) {
            return {
              content: [{ type: "text" as const, text: `git diff failed: ${errorOutput.trim()}` }],
              details: {}
            }
          }

          return {
            content: [{ type: "text" as const, text: output || "No changes." }],
            details: {}
          }
        } catch (e) {
          return {
            content: [{ type: "text" as const, text: `git diff error: ${String(e)}` }],
            details: {}
          }
        }
      }
    }))
  }
}
