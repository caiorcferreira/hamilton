import { Data } from "effect"

import type { AgentManifest, WorkflowSpec, WorkflowTask, VariantTask } from "../types.js"

export class UnsupportedVariantError extends Data.TaggedError("UnsupportedVariantError")<{
  variant: string
  supported: string[]
}> {}

interface VariantDefinition {
  tasks: VariantTask[]
}

export const VARIANT_REGISTRY: Record<string, VariantDefinition> = {
  branchout: {
    tasks: [
      {
        placement: "start",
        capabilities: { provides: ["workspace-created"], replaces: [] },
        task: {
          name: "create-branch",
          agent: {
            executorRef: "setup",
            prompt: {
              content: "Run the following commands:\n1. cd {{tasks.plan.outputs.repo}}\n2. git checkout -b {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done"
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
        capabilities: { provides: ["workspace-created"], replaces: ["workspace-created"] },
        task: {
          name: "create-worktree",
          agent: {
            executorRef: "setup",
            prompt: {
              content: "Create an isolated git worktree.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nDeterministic activity: createGitWorktree\n\nReply with STATUS: done, WORKTREE_PATH: <path>, ORIGINAL_BRANCH: <branch>"
            }
          }
        }
      },
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "cleanup-worktree",
          agent: {
            executorRef: "setup",
            prompt: {
              content: "Clean up the worktree.\n\nREPO: {{tasks.plan.outputs.repo}}\n\nDeterministic activity: cleanupGitWorktree\n\nReply with STATUS: done"
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
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "finalize-merge",
          agent: {
            executorRef: "merger",
            prompt: {
              content: "Finalize by squashing changes and merging.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done"
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
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "create-pr",
          agent: {
            executorRef: "developer",
            prompt: {
              content: "Create a pull request.\n\nREPO: {{tasks.plan.outputs.repo}}\nBRANCH: {{tasks.plan.outputs.branch}}\n\nReply with STATUS: done, PR: <url>"
            }
          }
        }
      },
      {
        placement: "end",
        capabilities: { provides: [], replaces: [] },
        task: {
          name: "review",
          agent: {
            executorRef: "reviewer",
            prompt: {
              content: "Review the PR.\n\nPR: {{pr}}\n\nReply with STATUS: done, DECISION: approved"
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