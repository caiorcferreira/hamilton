import { describe, it, expect } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { Effect, Exit, Cause } from "effect"
import { Template, type TemplateOptions } from "../../src/prompts/template.js"

const lenient: TemplateOptions = { strict: false }
const strict: TemplateOptions = { strict: true }

const render = (t: string, ctx: Record<string, unknown>, opts: TemplateOptions): string =>
  Effect.runSync(Template.make(t, opts).setVar("inputs", ctx).render())

describe("resolveTemplate", () => {
  it("replaces {{name}} with context value", () => {
    const result = Effect.runSync(Template.make("Hello {{name}}!", lenient).setVar("name", "world").render())
    expect(result).toBe("Hello world!")
  })

  it("replaces multiple variables", () => {
    const result = Effect.runSync(Template.make("{{a}} and {{b}}", lenient).setVar("a", "1").setVar("b", "2").render())
    expect(result).toBe("1 and 2")
  })

  it("resolves dotted paths via inputs namespace", () => {
    const ctx = {
      tasks: { setup: { outputs: { repo: "/tmp/repo", branch: "feat/x" } } },
      cwd: "/home/project",
      parameters: { current_task: { title: "Add login" } }
    }
    expect(render("REPO: {{inputs.tasks.setup.outputs.repo}}", ctx, lenient)).toBe("REPO: /tmp/repo")
    expect(render("BRANCH: {{inputs.tasks.setup.outputs.branch}}", ctx, lenient)).toBe("BRANCH: feat/x")
    expect(render("DIR: {{inputs.cwd}}", ctx, lenient)).toBe("DIR: /home/project")
  })

  it("resolves dotted paths on top-level context (no inputs prefix)", () => {
    const ctx = {
      tasks: { setup: { outputs: { repo: "/tmp/repo" } } }
    }
    const result = Effect.runSync(Template.make("REPO: {{tasks.setup.outputs.repo}}", lenient).setVar("tasks", ctx.tasks).render())
    expect(result).toBe("REPO: /tmp/repo")
  })

  it("stringifies non-string values as JSON", () => {
    const result = Effect.runSync(Template.make("Items: {{items}}", lenient).setVar("items", [1, 2, 3]).render())
    expect(result).toBe("Items: [1,2,3]")
    const result2 = Effect.runSync(Template.make("Context: {{ctx}}", lenient).setVar("ctx", { a: 1 }).render())
    expect(result2).toBe('Context: {"a":1}')
  })

  it("writes true/false/0 as-is (not via JSON.stringify)", () => {
    const result = Effect.runSync(Template.make("Bool: {{flag}}, Zero: {{num}}", lenient).setVar("flag", true).setVar("num", 0).render())
    expect(result).toBe("Bool: true, Zero: 0")
  })

  it("writes null/undefined as empty string", () => {
    const result = Effect.runSync(Template.make("X{{missing}}Y", lenient).render())
    expect(result).toBe("XY")
  })

  it("renders missing variables as empty string in lenient mode", () => {
    const result = Effect.runSync(Template.make("Hello {{name}}!", lenient).render())
    expect(result).toBe("Hello !")
  })

  it("passes through text with no placeholders unchanged", () => {
    const result = Effect.runSync(Template.make("plain text", lenient).render())
    expect(result).toBe("plain text")
  })

  describe("conditionals", () => {
    it("renders {{#if}} block when value is truthy", () => {
      const result = Effect.runSync(Template.make("{{#if active}}YES{{/if}}", lenient).setVar("active", true).render())
      expect(result).toBe("YES")
    })

    it("skips {{#if}} block when value is falsy", () => {
      const result = Effect.runSync(Template.make("{{#if active}}YES{{/if}}", lenient).setVar("active", false).render())
      expect(result).toBe("")
    })

    it("renders {{#if}}...{{else}}...{{/if}} truthy branch", () => {
      const result = Effect.runSync(Template.make("{{#if flag}}YES{{else}}NO{{/if}}", lenient).setVar("flag", true).render())
      expect(result).toBe("YES")
    })

    it("renders {{#if}}...{{else}}...{{/if}} falsy branch", () => {
      const result = Effect.runSync(Template.make("{{#if flag}}YES{{else}}NO{{/if}}", lenient).setVar("flag", false).render())
      expect(result).toBe("NO")
    })

    it("treats non-empty string as truthy", () => {
      const result = Effect.runSync(Template.make("{{#if name}}has name{{/if}}", lenient).setVar("name", "Alice").render())
      expect(result).toBe("has name")
    })

    it("treats empty string as falsy", () => {
      const result = Effect.runSync(Template.make("{{#if name}}has name{{/if}}", lenient).setVar("name", "").render())
      expect(result).toBe("")
    })

    it("treats non-empty array as truthy", () => {
      const result = Effect.runSync(Template.make("{{#if items}}has items{{/if}}", lenient).setVar("items", [1]).render())
      expect(result).toBe("has items")
    })

    it("treats empty array as falsy", () => {
      const result = Effect.runSync(Template.make("{{#if items}}has items{{/if}}", lenient).setVar("items", []).render())
      expect(result).toBe("")
    })

    it("treats 0 as falsy", () => {
      const result = Effect.runSync(Template.make("{{#if count}}nonzero{{/if}}", lenient).setVar("count", 0).render())
      expect(result).toBe("")
    })

    it("{{#unless}} renders when falsy", () => {
      const result = Effect.runSync(Template.make("{{#unless done}}pending{{/unless}}", lenient).setVar("done", false).render())
      expect(result).toBe("pending")
    })

    it("{{#unless}} skips when truthy", () => {
      const result = Effect.runSync(Template.make("{{#unless done}}pending{{/unless}}", lenient).setVar("done", true).render())
      expect(result).toBe("")
    })

    it("nested conditionals", () => {
      const t = "{{#if outer}}{{#if inner}}both{{/if}}{{/if}}"
      const tmpl = Template.make(t, lenient)
      expect(Effect.runSync(tmpl.setVar("outer", true).setVar("inner", true).render())).toBe("both")
      expect(Effect.runSync(tmpl.setVar("outer", true).setVar("inner", false).render())).toBe("")
      expect(Effect.runSync(tmpl.setVar("outer", false).setVar("inner", true).render())).toBe("")
    })

    it("conditionals with dotted path values from inputs", () => {
      const ctx = { tasks: { verify: { outputs: { passed: true } } } }
      const result = render("{{#if inputs.tasks.verify.outputs.passed}}OK{{/if}}", ctx, lenient)
      expect(result).toBe("OK")
    })
  })

  describe("loops", () => {
    it("{{#each}} iterates over array", () => {
      const result = Effect.runSync(Template.make("{{#each items}}{{this}},{{/each}}", lenient).setVar("items", ["a", "b", "c"]).render())
      expect(result).toBe("a,b,c,")
    })

    it("{{#each}} with object access in body", () => {
      const result = Effect.runSync(Template.make("{{#each stories}}{{id}}:{{title}};{{/each}}", lenient).setVar("stories", [{ id: "1", title: "A" }, { id: "2", title: "B" }]).render())
      expect(result).toBe("1:A;2:B;")
    })

    it("{{#each}} with @index", () => {
      const result = Effect.runSync(Template.make("{{#each items}}{{@index}}:{{this}};{{/each}}", lenient).setVar("items", ["x", "y"]).render())
      expect(result).toBe("0:x;1:y;")
    })

    it("{{#each}} with @first and @last", () => {
      const t = "{{#each items}}{{#if @first}}START:{{/if}}{{this}}{{#unless @last}};{{/unless}}{{/each}}"
      const result = Effect.runSync(Template.make(t, lenient).setVar("items", ["a", "b", "c"]).render())
      expect(result).toBe("START:a;b;c")
    })

    it("{{#each}} over empty array produces empty output", () => {
      const result = Effect.runSync(Template.make("{{#each items}}x{{/each}}", lenient).setVar("items", []).render())
      expect(result).toBe("")
    })

    it("{{#each}} over inputs.tasks via dotted path", () => {
      const ctx = {
        tasks: {
          plan: { outputs: { tasks: [{ title: "A" }, { title: "B" }] } }
        }
      }
      const result = render("{{#each inputs.tasks.plan.outputs.tasks}}- {{title}}\n{{/each}}", ctx, lenient)
      expect(result).toBe("- A\n- B\n")
    })

    it("{{#each}} over non-array produces empty output (lenient)", () => {
      const result = Effect.runSync(Template.make("{{#each notAnArray}}x{{/each}}", lenient).render())
      expect(result).toBe("")
    })
  })

  describe("strict mode", () => {
    it("throws MissingVariableError when variable is missing", () => {
      const exit = Effect.runSyncExit(Template.make("Hello {{name}}!", strict).render())
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const failures = Cause.failures(exit.cause)
        const arr = Array.from(failures)
        const err = arr[0] as { _tag: string; variable: string }
        expect(err._tag).toBe("MissingVariableError")
        expect(err.variable).toBe("name")
      }
    })

    it("throws MissingVariableError for missing variable in {{#if}} condition", () => {
      const exit = Effect.runSyncExit(Template.make("{{#if inputs.ready}}OK{{/if}}", strict).render())
      expect(Exit.isFailure(exit)).toBe(true)
    })

    it("throws MissingVariableError for missing variable in {{#each}} expression", () => {
      const exit = Effect.runSyncExit(Template.make("{{#each items}}x{{/each}}", strict).render())
      expect(Exit.isFailure(exit)).toBe(true)
    })

    it("renders missing variables as empty string in lenient mode (dotted path)", () => {
      const result = Effect.runSync(Template.make("MISSING: {{tasks.nonexistent.field}}", lenient).render())
      expect(result).toBe("MISSING: ")
    })
  })

  describe("syntax errors", () => {
    it("throws TemplateSyntaxError for unclosed if", () => {
      expect(() => Effect.runSync(Template.make("{{#if x}}open", lenient).render())).toThrow()
    })

    it("throws TemplateSyntaxError for unclosed each", () => {
      expect(() => Effect.runSync(Template.make("{{#each items}}open", lenient).render())).toThrow()
    })
  })

  describe("resolveFileTemplate", () => {
    it("reads .hbs file and resolves placeholders", async () => {
      const tmp = Fs.mkdtempSync(Path.join(Os.tmpdir(), "hamilton-template-test-"))
      const filePath = Path.join(tmp, "greet.hbs")
      Fs.writeFileSync(filePath, "Hello {{name}}!")
      try {
        const template = await Effect.runPromise(Template.fromFile(filePath, lenient))
        const result = Effect.runSync(template.setVar("name", "world").render())
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
        const template = await Effect.runPromise(Template.fromFile(filePath, lenient))
        const result = Effect.runSync(template.setVar("repo", "foo").render())
        expect(result).toBe("# Task\nFix foo")
      } finally {
        Fs.rmSync(tmp, { recursive: true, force: true })
      }
    })

    it("fails with TemplateFileError for missing file", async () => {
      const result = await Effect.runPromiseExit(Template.fromFile("/nonexistent/path.hbs"))
      expect(Exit.isFailure(result)).toBe(true)
    })
  })
})
