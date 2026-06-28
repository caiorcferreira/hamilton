import type { LLMClient } from "./llm-client.js"
import { readDefaults, parseModelString } from "../agent/model-resolution.js"
import { piAgentDir } from "../executors/pi/paths.js"
import type { MemoryReader, MemoryAtom, MemoryFilters } from "../memory/store.js"

export interface Curator {
  suggestMemoryFilters(taskPrompt: string, files: string[]): Promise<MemoryFilters>
  findRelevantAtoms(reader: MemoryReader, filePath: string, tags: string[]): Promise<MemoryAtom[]>
}

export function createCurator(llmClient: LLMClient): Curator {
  return {
    async suggestMemoryFilters(taskPrompt, files) {
      const systemPrompt = `You are a task context analyzer. Given a task prompt and file list, return a JSON object with:
- tags: string[] — relevant context tags (e.g. "testing", "refactor", "database", "ci")
- languages: string[] — programming language tags (e.g. "lang:typescript", "lang:python")
- filePaths: string[] — the most relevant file paths for context

Detect languages from file extensions:
- .ts/.tsx → "lang:typescript"
- .js/.jsx → "lang:javascript"
- .py → "lang:python"
- .rs → "lang:rust"
- .go → "lang:go"
- .java → "lang:java"

Return ONLY the JSON object, no other text.`

      const userPrompt = `Task prompt: ${taskPrompt}\n\nFiles: ${files.join(", ") || "none"}`

      try {
        const defaults = readDefaults(piAgentDir())
        const [provider, modelId] = parseModelString("default", defaults)
        const response = await llmClient.complete(provider, modelId, [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ] as any)

        let text: string
        if (typeof response === "string") {
          text = response
        } else if (Array.isArray((response as any).content)) {
          text = (response as any).content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text)
            .join("")
        } else if (typeof (response as any).content === "string") {
          text = (response as any).content
        } else {
          text = JSON.stringify(response)
        }

        const jsonMatch = text.match(/\{[\s\S]*\}/)
        if (!jsonMatch) throw new Error("No JSON found in response")

        const parsed = JSON.parse(jsonMatch[0])
        return {
          tags: parsed.tags ?? [],
          languages: parsed.languages ?? [],
          filePaths: parsed.filePaths ?? [],
        }
      } catch {
        return { tags: [], languages: [], filePaths: [] }
      }
    },

    async findRelevantAtoms(reader, filePath, tags) {
      return reader.retrieveRelevant(
        { tags, languages: [], filePaths: [filePath] },
        5
      )
    },
  }
}