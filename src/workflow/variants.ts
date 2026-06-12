import { Data } from "effect"

import type { AgentManifest, WorkflowSpec, WorkflowTask, VariantTask } from "../types.js"

export class UnsupportedVariantError extends Data.TaggedError("UnsupportedVariantError")<{
  variant: string
  supported: string[]
}> { }

interface VariantDefinition {
  tasks: VariantTask[]
}

export const VARIANT_REGISTRY: Record<string, VariantDefinition> = {
  branchout: {
    tasks: [
      {
        placement: "start",
        capabilities: { provides: ["branch-created"], replaces: [] },
        task: {
          name: "create-branch",
          agent: {
            executorRef: "setup",
            prompt: {
              content: `## Steps
              1. Think of a branch name that reflects the user input. Use prefix like "feat/", "refact/", "fix/", "chore/" or other that captures the main type of change that will be made.
              2. Run the command to learn the original branch: git branch --show-current
              2. Run the command: cd {{cwd}}
              3. Run the command: git checkout -b <branch-name>
              
              ## Output
              Set your output with a JSON like:
              \`\`\`json
              {"status": "done", "branch": "<branch-name>", "original_branch": "<original-branch>"}
              \`\`\`

              ## User Input
              {{user_input}}
              `
            }
          }
        }
      }
    ]
  },
  worktree: {
    tasks: [
      {
        placement: "start",
        capabilities: { provides: ["workspace-created"], replaces: ["branch-created"] },
        task: {
          name: "create-worktree",
          agent: {
            executorRef: "setup",
            prompt: {
              content: `## Steps
              1. Think of a branch name that reflects the user input. Use prefix like "feat/", "refact/", "fix/", "chore/" or other that captures the main type of change that will be made.
              2. Run the command: cd {{cwd}}
              3. Run the command to learn the original branch: git branch --show-current
              4. Run the command: git worktree add -b <branch-name> ./.worktree/<branch-name> <original-branch>
              6. Run the command: cd <worktree-path>
              
              ## Output
              Set your output with a JSON like:
              \`\`\`json
              {"status": "done", "branch": "<branch-name>", "original_branch": "<original-branch>", "worktree_path": "<absolute-path>"}
              \`\`\`

              ## User Input
              {{user_input}}
              `
            }
          }
        }
      }
    ]
  },
  merge: {
    tasks: [
      {
        placement: "end",
        capabilities: { provides: ["branch-merged"], replaces: [] },
        task: {
          name: "finalize-merge",
          agent: {
            executorRef: "merger",
            prompt: {
              content: `## Steps
              1. Run the command: cd {{cwd}}
              2. Run the command to get the current branch: git branch --show-current
              3. Squash all commits into a clean history
              4. Merge the branch into the main branch
              
              ## Output
              Set your output with a JSON like:
              \`\`\`json
              {"status": "done", "branch": "<branch-name>", "merged_into": "<target-branch>"}
              \`\`\`

              ## User Input
              {{user_input}}
              `
            }
          }
        }
      }
    ]
  },
  github_pr: {
    tasks: [
      {
        placement: "end",
        capabilities: { provides: ["pr-created"], replaces: [] },
        task: {
          name: "create-pr",
          agent: {
            executorRef: "developer",
            prompt: {
              content: `## Steps
              1. Run the command: cd {{cwd}}
              2. Run the command to get the current branch: git branch --show-current
              3. Create a pull request using gh CLI
              4. Use the user input to craft a descriptive PR title and body
              
              ## Output
              Set your output with a JSON like:
              \`\`\`json
              {"status": "done", "branch": "<branch-name>", "pr_url": "<pr-url>"}
              \`\`\`

              ## User Input
              {{user_input}}
              `
            }
          }
        }
      }
    ]
  }
}

export function composeVariants(
  spec: WorkflowSpec,
  agentRegistry: Map<string, AgentManifest>,
  activeVariants: string[]
): WorkflowSpec {
  if (activeVariants.length === 0) return spec

  const supported = spec.spec.variants?.supported ?? []
  for (const v of activeVariants) {
    if (!supported.includes(v)) {
      throw new UnsupportedVariantError({ variant: v, supported })
    }
  }

  const orderedBySupported = supported.filter(v => activeVariants.includes(v))

  const startTasks: VariantTask[] = []
  const endTasks: VariantTask[] = []

  for (const v of orderedBySupported) {
    const def = VARIANT_REGISTRY[v]
    if (!def) continue
    for (const vt of def.tasks) {
      if (vt.placement === "start") startTasks.push(vt)
      else endTasks.push(vt)
    }
  }

  const replacedCapabilities: string[] = []

  const allVariantTasks = [...startTasks, ...endTasks]
  for (const vt of allVariantTasks) {
    replacedCapabilities.push(...vt.capabilities.replaces)
  }

  const kept: VariantTask[] = []
  for (const vt of allVariantTasks) {
    const isReplaced = vt.capabilities.provides.some(p => replacedCapabilities.includes(p))
    const isReplacer = vt.capabilities.replaces.length > 0
    if (isReplaced && !isReplacer) continue
    kept.push(vt)
  }

  const keptStart = kept.filter(vt => vt.placement === "start")
  const keptEnd = kept.filter(vt => vt.placement === "end")

  const composedTasks: WorkflowTask[] = [...spec.spec.tasks]
  const startTaskDefs: { task: WorkflowTask; name: string }[] = []

  if (keptStart.length > 0) {
    let prevName: string | null = null
    for (const vt of keptStart) {
      const task: WorkflowTask = { ...vt.task, dependencies: [] }
      if (prevName) {
        task.dependencies = [prevName]
      }
      startTaskDefs.push({ task, name: vt.task.name })
      prevName = vt.task.name
    }
    const entryTask = composedTasks.find(t => t.name === spec.spec.run.entrypoint)
    if (entryTask && prevName) {
      entryTask.dependencies = [...(entryTask.dependencies ?? []), prevName]
    }
    composedTasks.unshift(...startTaskDefs.map(s => s.task))
  }

  if (keptEnd.length > 0) {
    const dependents = new Set<string>()
    for (const t of composedTasks) {
      for (const dep of t.dependencies ?? []) {
        dependents.add(dep)
      }
    }
    const leaves = composedTasks.filter(t => !dependents.has(t.name))
    const leafNames = leaves.map(t => t.name)

    let prevName: string | null = null
    for (const vt of keptEnd) {
      const task: WorkflowTask = { ...vt.task, dependencies: [] }
      if (prevName) {
        task.dependencies = [prevName]
      } else {
        task.dependencies = [...leafNames]
      }
      composedTasks.push(task)
      prevName = vt.task.name
    }
  }

  return { ...spec, spec: { ...spec.spec, tasks: composedTasks } }
}