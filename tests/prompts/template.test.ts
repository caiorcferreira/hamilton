import { describe, it, expect } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { Effect, Exit } from "effect"
import { resolveTemplate, TemplateOptions } from "../../src/prompts/template.js"

const lenient: TemplateOptions = { strict: false }
const strict: TemplateOptions = { strict: true }

describe("resolveTemplate", () => {
  it("replaces {{name}} with context value", () => {
    expect(resolveTemplate("Hello {{name}}!", { name: "world" }, lenient)).toBe("Hello world!")
  })

  it("replaces multiple variables", () => {
    expect(resolveTemplate("{{a}} and {{b}}", { a: "1", b: "2" }, lenient)).toBe("1 and 2")
  })

  it("resolves dotted paths via inputs namespace", () => {
    const ctx = {
      inputs: {
        tasks: { setup: { outputs: { repo: "/tmp/repo", branch: "feat/x" } } },
        cwd: "/home/project",
        parameters: { current_task: { title: "Add login" } }
      }
    }
    expect(resolveTemplate("REPO: {{inputs.tasks.setup.outputs.repo}}", ctx, lenient)).toBe("REPO: /tmp/repo")
    expect(resolveTemplate("BRANCH: {{inputs.tasks.setup.outputs.branch}}", ctx, lenient)).toBe("BRANCH: feat/x")
    expect(resolveTemplate("DIR: {{inputs.cwd}}", ctx, lenient)).toBe("DIR: /home/project")
  })

  it("resolves dotted paths on top-level context (no inputs prefix)", () => {
    const ctx = {
      tasks: { setup: { outputs: { repo: "/tmp/repo" } } }
    }
    expect(resolveTemplate("REPO: {{tasks.setup.outputs.repo}}", ctx, lenient)).toBe("REPO: /tmp/repo")
  })

  it("stringifies non-string values as JSON", () => {
    expect(resolveTemplate("Items: {{items}}", { items: [1, 2, 3] }, lenient)).toBe("Items: [1,2,3]")
    expect(resolveTemplate("Context: {{ctx}}", { ctx: { a: 1 } }, lenient)).toBe('Context: {"a":1}')
  })

  it("writes true/false/0 as-is (not via JSON.stringify)", () => {
    expect(resolveTemplate("Bool: {{flag}}, Zero: {{num}}", { flag: true, num: 0 }, lenient)).toBe("Bool: true, Zero: 0")
  })

  it("writes null/undefined as empty string", () => {
    expect(resolveTemplate("X{{missing}}Y", {}, lenient)).toBe("XY")
  })

  it("renders missing variables as empty string in lenient mode", () => {
    expect(resolveTemplate("Hello {{name}}!", {}, lenient)).toBe("Hello !")
  })

  it("passes through text with no placeholders unchanged", () => {
    expect(resolveTemplate("plain text", { name: "x" }, lenient)).toBe("plain text")
  })

  describe("conditionals", () => {
    it("renders {{#if}} block when value is truthy", () => {
      expect(resolveTemplate("{{#if active}}YES{{/if}}", { active: true }, lenient)).toBe("YES")
    })

    it("skips {{#if}} block when value is falsy", () => {
      expect(resolveTemplate("{{#if active}}YES{{/if}}", { active: false }, lenient)).toBe("")
    })

    it("renders {{#if}}...{{else}}...{{/if}} truthy branch", () => {
      expect(resolveTemplate("{{#if flag}}YES{{else}}NO{{/if}}", { flag: true }, lenient)).toBe("YES")
    })

    it("renders {{#if}}...{{else}}...{{/if}} falsy branch", () => {
      expect(resolveTemplate("{{#if flag}}YES{{else}}NO{{/if}}", { flag: false }, lenient)).toBe("NO")
    })

    it("treats non-empty string as truthy", () => {
      expect(resolveTemplate("{{#if name}}has name{{/if}}", { name: "Alice" }, lenient)).toBe("has name")
    })

    it("treats empty string as falsy", () => {
      expect(resolveTemplate("{{#if name}}has name{{/if}}", { name: "" }, lenient)).toBe("")
    })

    it("treats non-empty array as truthy", () => {
      expect(resolveTemplate("{{#if items}}has items{{/if}}", { items: [1] }, lenient)).toBe("has items")
    })

    it("treats empty array as falsy", () => {
      expect(resolveTemplate("{{#if items}}has items{{/if}}", { items: [] }, lenient)).toBe("")
    })

    it("treats 0 as falsy", () => {
      expect(resolveTemplate("{{#if count}}nonzero{{/if}}", { count: 0 }, lenient)).toBe("")
    })

    it("{{#unless}} renders when falsy", () => {
      expect(resolveTemplate("{{#unless done}}pending{{/unless}}", { done: false }, lenient)).toBe("pending")
    })

    it("{{#unless}} skips when truthy", () => {
      expect(resolveTemplate("{{#unless done}}pending{{/unless}}", { done: true }, lenient)).toBe("")
    })

    it("nested conditionals", () => {
      const t = "{{#if outer}}{{#if inner}}both{{/if}}{{/if}}"
      expect(resolveTemplate(t, { outer: true, inner: true }, lenient)).toBe("both")
      expect(resolveTemplate(t, { outer: true, inner: false }, lenient)).toBe("")
      expect(resolveTemplate(t, { outer: false, inner: true }, lenient)).toBe("")
    })

    it("conditionals with dotted path values from inputs", () => {
      const ctx = { inputs: { tasks: { verify: { outputs: { passed: true } } } } }
      expect(resolveTemplate("{{#if inputs.tasks.verify.outputs.passed}}OK{{/if}}", ctx, lenient)).toBe("OK")
    })
  })

  describe("loops", () => {
    it("{{#each}} iterates over array", () => {
      const ctx = { items: ["a", "b", "c"] }
      expect(resolveTemplate("{{#each items}}{{this}},{{/each}}", ctx, lenient)).toBe("a,b,c,")
    })

    it("{{#each}} with object access in body", () => {
      const ctx = { stories: [{ id: "1", title: "A" }, { id: "2", title: "B" }] }
      expect(resolveTemplate("{{#each stories}}{{id}}:{{title}};{{/each}}", ctx, lenient)).toBe("1:A;2:B;")
    })

    it("{{#each}} with @index", () => {
      const ctx = { items: ["x", "y"] }
      expect(resolveTemplate("{{#each items}}{{@index}}:{{this}};{{/each}}", ctx, lenient)).toBe("0:x;1:y;")
    })

    it("{{#each}} with @first and @last", () => {
      const ctx = { items: ["a", "b", "c"] }
      const t = "{{#each items}}{{#if @first}}START:{{/if}}{{this}}{{#unless @last}};{{/unless}}{{/each}}"
      expect(resolveTemplate(t, ctx, lenient)).toBe("START:a;b;c")
    })

    it("{{#each}} over empty array produces empty output", () => {
      expect(resolveTemplate("{{#each items}}x{{/each}}", { items: [] }, lenient)).toBe("")
    })

    it("{{#each}} over inputs.tasks via dotted path", () => {
      const ctx = {
        inputs: {
          tasks: {
            plan: { outputs: { tasks: [{ title: "A" }, { title: "B" }] } }
          }
        }
      }
      expect(resolveTemplate("{{#each inputs.tasks.plan.outputs.tasks}}- {{title}}\n{{/each}}", ctx, lenient)).toBe("- A\n- B\n")
    })

    it("{{#each}} over non-array produces empty output (lenient)", () => {
      expect(resolveTemplate("{{#each notAnArray}}x{{/each}}", {}, lenient)).toBe("")
    })
  })

  describe("strict mode", () => {
    it("throws MissingVariableError when variable is missing", () => {
      try {
        resolveTemplate("Hello {{name}}!", {}, strict)
        expect.unreachable("Should have thrown")
      } catch (e: any) {
        expect(e._tag).toBe("MissingVariableError")
        expect(e.variable).toBe("name")
      }
    })

    it("throws MissingVariableError for missing variable in {{#if}} condition", () => {
      try {
        resolveTemplate("{{#if inputs.ready}}OK{{/if}}", {}, strict)
        expect.unreachable("Should have thrown")
      } catch (e: any) {
        expect(e._tag).toBe("MissingVariableError")
      }
    })

    it("throws MissingVariableError for missing variable in {{#each}} expression", () => {
      try {
        resolveTemplate("{{#each items}}x{{/each}}", {}, strict)
        expect.unreachable("Should have thrown")
      } catch (e: any) {
        expect(e._tag).toBe("MissingVariableError")
      }
    })

    it("renders missing variables as empty string in lenient mode (dotted path)", () => {
      expect(resolveTemplate("MISSING: {{tasks.nonexistent.field}}", {}, lenient)).toBe("MISSING: ")
    })
  })

  describe("syntax errors", () => {
    it("throws TemplateSyntaxError for unclosed if", () => {
      expect(() => resolveTemplate("{{#if x}}open", {}, lenient)).toThrow()
    })

    it("throws TemplateSyntaxError for unclosed each", () => {
      expect(() => resolveTemplate("{{#each items}}open", {}, lenient)).toThrow()
    })
  })

  describe("resolveFileTemplate", () => {
    it("reads .hbs file and resolves placeholders", async () => {
      const tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-template-test-"))
      const filePath = Path.join(tmp, "greet.hbs")
      Fs.writeFileSync(filePath, "Hello {{name}}!")
      try {
        const { resolveFileTemplate } = await import("../../src/prompts/template.js")
        const result = await Effect.runPromise(resolveFileTemplate(filePath, { name: "world" }, lenient))
        expect(result).toBe("Hello world!")
      } finally {
        Fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it("reads .md file and resolves placeholders", async () => {
      const tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-template-test-"))
      const filePath = Path.join(tmp, "prompt.md")
      Fs.writeFileSync(filePath, "# Task\nFix {{repo}}")
      try {
        const { resolveFileTemplate } = await import("../../src/prompts/template.js")
        const result = await Effect.runPromise(resolveFileTemplate(filePath, { repo: "foo" }, lenient))
        expect(result).toBe("# Task\nFix foo")
      } finally {
        Fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it("fails with TemplateFileError for missing file", async () => {
      const { resolveFileTemplate } = await import("../../src/prompts/template.js")
      const result = await Effect.runPromiseExit(resolveFileTemplate("/nonexistent/path.hbs", {}, lenient))
      expect(Exit.isFailure(result)).toBe(true)
    })
  })
})