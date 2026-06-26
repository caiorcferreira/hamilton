import { describe, it, expect } from "vitest"
import * as Fs from "node:fs"
import * as Os from "node:os"
import * as Path from "node:path"
import { Cause, Chunk, Effect, Exit, Option } from "effect"
import { Template, type TemplateOptions } from "../../src/prompts/template.js"

const lenient: TemplateOptions = { strict: false }
const strict: TemplateOptions = { strict: true }

describe("resolveTemplate", () => {
  it("replaces {{name}} with context value", () => {
    expect(Effect.runSync(
      Template.make("Hello {{name}}!", lenient).setVar("name", "world").render()
    )).toBe("Hello world!")
  })

  it("replaces multiple variables", () => {
    expect(Effect.runSync(
      Template.make("{{a}} and {{b}}", lenient).setVar("a", "1").setVar("b", "2").render()
    )).toBe("1 and 2")
  })

  it("resolves dotted paths via inputs namespace", () => {
    const inputsVal = {
      tasks: { setup: { outputs: { repo: "/tmp/repo", branch: "feat/x" } } },
      cwd: "/home/project",
      parameters: { current_task: { title: "Add login" } }
    }
    expect(Effect.runSync(
      Template.make("REPO: {{inputs.tasks.setup.outputs.repo}}", lenient).setVar("inputs", inputsVal).render()
    )).toBe("REPO: /tmp/repo")
    expect(Effect.runSync(
      Template.make("BRANCH: {{inputs.tasks.setup.outputs.branch}}", lenient).setVar("inputs", inputsVal).render()
    )).toBe("BRANCH: feat/x")
    expect(Effect.runSync(
      Template.make("DIR: {{inputs.cwd}}", lenient).setVar("inputs", inputsVal).render()
    )).toBe("DIR: /home/project")
  })

  it("resolves dotted paths on top-level context (no inputs prefix)", () => {
    expect(Effect.runSync(
      Template.make("REPO: {{tasks.setup.outputs.repo}}", lenient)
        .setVar("tasks", { setup: { outputs: { repo: "/tmp/repo" } } })
        .render()
    )).toBe("REPO: /tmp/repo")
  })

  it("stringifies non-string values as JSON", () => {
    expect(Effect.runSync(
      Template.make("Items: {{items}}", lenient).setVar("items", [1, 2, 3]).render()
    )).toBe("Items: [1,2,3]")
    expect(Effect.runSync(
      Template.make("Context: {{ctx}}", lenient).setVar("ctx", { a: 1 }).render()
    )).toBe('Context: {"a":1}')
  })

  it("writes true/false/0 as-is (not via JSON.stringify)", () => {
    expect(Effect.runSync(
      Template.make("Bool: {{flag}}, Zero: {{num}}", lenient)
        .setVar("flag", true)
        .setVar("num", 0)
        .render()
    )).toBe("Bool: true, Zero: 0")
  })

  it("writes null/undefined as empty string", () => {
    expect(Effect.runSync(Template.make("X{{missing}}Y", lenient).render())).toBe("XY")
  })

  it("renders missing variables as empty string in lenient mode", () => {
    expect(Effect.runSync(Template.make("Hello {{name}}!", lenient).render())).toBe("Hello !")
  })

  it("passes through text with no placeholders unchanged", () => {
    expect(Effect.runSync(
      Template.make("plain text", lenient).setVar("name", "x").render()
    )).toBe("plain text")
  })

  describe("conditionals", () => {
    it("renders {{#if}} block when value is truthy", () => {
      expect(Effect.runSync(
        Template.make("{{#if active}}YES{{/if}}", lenient).setVar("active", true).render()
      )).toBe("YES")
    })

    it("skips {{#if}} block when value is falsy", () => {
      expect(Effect.runSync(
        Template.make("{{#if active}}YES{{/if}}", lenient).setVar("active", false).render()
      )).toBe("")
    })

    it("renders {{#if}}...{{else}}...{{/if}} truthy branch", () => {
      expect(Effect.runSync(
        Template.make("{{#if flag}}YES{{else}}NO{{/if}}", lenient).setVar("flag", true).render()
      )).toBe("YES")
    })

    it("renders {{#if}}...{{else}}...{{/if}} falsy branch", () => {
      expect(Effect.runSync(
        Template.make("{{#if flag}}YES{{else}}NO{{/if}}", lenient).setVar("flag", false).render()
      )).toBe("NO")
    })

    it("treats non-empty string as truthy", () => {
      expect(Effect.runSync(
        Template.make("{{#if name}}has name{{/if}}", lenient).setVar("name", "Alice").render()
      )).toBe("has name")
    })

    it("treats empty string as falsy", () => {
      expect(Effect.runSync(
        Template.make("{{#if name}}has name{{/if}}", lenient).setVar("name", "").render()
      )).toBe("")
    })

    it("treats non-empty array as truthy", () => {
      expect(Effect.runSync(
        Template.make("{{#if items}}has items{{/if}}", lenient).setVar("items", [1]).render()
      )).toBe("has items")
    })

    it("treats empty array as falsy", () => {
      expect(Effect.runSync(
        Template.make("{{#if items}}has items{{/if}}", lenient).setVar("items", []).render()
      )).toBe("")
    })

    it("treats 0 as falsy", () => {
      expect(Effect.runSync(
        Template.make("{{#if count}}nonzero{{/if}}", lenient).setVar("count", 0).render()
      )).toBe("")
    })

    it("{{#unless}} renders when falsy", () => {
      expect(Effect.runSync(
        Template.make("{{#unless done}}pending{{/unless}}", lenient).setVar("done", false).render()
      )).toBe("pending")
    })

    it("{{#unless}} skips when truthy", () => {
      expect(Effect.runSync(
        Template.make("{{#unless done}}pending{{/unless}}", lenient).setVar("done", true).render()
      )).toBe("")
    })

    it("nested conditionals", () => {
      const t = "{{#if outer}}{{#if inner}}both{{/if}}{{/if}}"
      expect(Effect.runSync(
        Template.make(t, lenient).setVar("outer", true).setVar("inner", true).render()
      )).toBe("both")
      expect(Effect.runSync(
        Template.make(t, lenient).setVar("outer", true).setVar("inner", false).render()
      )).toBe("")
      expect(Effect.runSync(
        Template.make(t, lenient).setVar("outer", false).setVar("inner", true).render()
      )).toBe("")
    })

    it("conditionals with dotted path values from inputs", () => {
      expect(Effect.runSync(
        Template.make("{{#if inputs.tasks.verify.outputs.passed}}OK{{/if}}", lenient)
          .setVar("inputs", { tasks: { verify: { outputs: { passed: true } } } })
          .render()
      )).toBe("OK")
    })
  })

  describe("loops", () => {
    it("{{#each}} iterates over array", () => {
      expect(Effect.runSync(
        Template.make("{{#each items}}{{this}},{{/each}}", lenient)
          .setVar("items", ["a", "b", "c"])
          .render()
      )).toBe("a,b,c,")
    })

    it("{{#each}} with object access in body", () => {
      expect(Effect.runSync(
        Template.make("{{#each stories}}{{id}}:{{title}};{{/each}}", lenient)
          .setVar("stories", [{ id: "1", title: "A" }, { id: "2", title: "B" }])
          .render()
      )).toBe("1:A;2:B;")
    })

    it("{{#each}} with @index", () => {
      expect(Effect.runSync(
        Template.make("{{#each items}}{{@index}}:{{this}};{{/each}}", lenient)
          .setVar("items", ["x", "y"])
          .render()
      )).toBe("0:x;1:y;")
    })

    it("{{#each}} with @first and @last", () => {
      const t = "{{#each items}}{{#if @first}}START:{{/if}}{{this}}{{#unless @last}};{{/unless}}{{/each}}"
      expect(Effect.runSync(
        Template.make(t, lenient).setVar("items", ["a", "b", "c"]).render()
      )).toBe("START:a;b;c")
    })

    it("{{#each}} over empty array produces empty output", () => {
      expect(Effect.runSync(
        Template.make("{{#each items}}x{{/each}}", lenient).setVar("items", []).render()
      )).toBe("")
    })

    it("{{#each}} over inputs.tasks via dotted path", () => {
      expect(Effect.runSync(
        Template.make("{{#each inputs.tasks.plan.outputs.tasks}}- {{title}}\n{{/each}}", lenient)
          .setVar("inputs", {
            tasks: {
              plan: { outputs: { tasks: [{ title: "A" }, { title: "B" }] } }
            }
          })
          .render()
      )).toBe("- A\n- B\n")
    })

    it("{{#each}} over non-array produces empty output (lenient)", () => {
      expect(Effect.runSync(
        Template.make("{{#each notAnArray}}x{{/each}}", lenient).render()
      )).toBe("")
    })
  })

  describe("strict mode", () => {
    it("throws MissingVariableError when variable is missing", () => {
      const exit = Effect.runSyncExit(Template.make("Hello {{name}}!", strict).render())
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const causeOpt = Exit.causeOption(exit)
        expect(Option.isSome(causeOpt)).toBe(true)
        if (Option.isSome(causeOpt)) {
          const failures = Cause.failures(causeOpt.value)
          const errors = Chunk.toArray(failures)
          expect(errors[0]._tag).toBe("MissingVariableError")
          expect((errors[0] as any).variable).toBe("name")
        }
      }
    })

    it("throws MissingVariableError for missing variable in {{#if}} condition", () => {
      const exit = Effect.runSyncExit(Template.make("{{#if inputs.ready}}OK{{/if}}", strict).render())
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const causeOpt = Exit.causeOption(exit)
        expect(Option.isSome(causeOpt)).toBe(true)
        if (Option.isSome(causeOpt)) {
          const failures = Cause.failures(causeOpt.value)
          const errors = Chunk.toArray(failures)
          expect(errors[0]._tag).toBe("MissingVariableError")
        }
      }
    })

    it("throws MissingVariableError for missing variable in {{#each}} expression", () => {
      const exit = Effect.runSyncExit(Template.make("{{#each items}}x{{/each}}", strict).render())
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const causeOpt = Exit.causeOption(exit)
        expect(Option.isSome(causeOpt)).toBe(true)
        if (Option.isSome(causeOpt)) {
          const failures = Cause.failures(causeOpt.value)
          const errors = Chunk.toArray(failures)
          expect(errors[0]._tag).toBe("MissingVariableError")
        }
      }
    })

    it("renders missing variables as empty string in lenient mode (dotted path)", () => {
      expect(Effect.runSync(
        Template.make("MISSING: {{tasks.nonexistent.field}}", lenient).render()
      )).toBe("MISSING: ")
    })
  })

  describe("syntax errors", () => {
    it("throws TemplateSyntaxError for unclosed if", () => {
      expect(() => Effect.runSync(
        Template.make("{{#if x}}open", lenient).render()
      )).toThrow()
    })

    it("throws TemplateSyntaxError for unclosed each", () => {
      expect(() => Effect.runSync(
        Template.make("{{#each items}}open", lenient).render()
      )).toThrow()
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
      const result = await Effect.runPromiseExit(Template.fromFile("/nonexistent/path.hbs", lenient))
      expect(Exit.isFailure(result)).toBe(true)
    })
  })
})