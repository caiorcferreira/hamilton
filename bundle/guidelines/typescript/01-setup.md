# TypeScript Guidelines — 01: Setup

This document is the first in the TypeScript Guidelines series. It establishes the foundational setup every TypeScript project should follow: toolchain configuration, project structure conventions, build configuration, and pre-commit hook enforcement.

---

## Table of Contents

1. [Toolchain](#toolchain)
   - [Compiler — TypeScript & tsconfig](#compiler--typescript--tsconfig)
   - [Linter — ESLint with typescript-eslint](#linter--eslint-with-typescript-eslint)
   - [Formatter — Prettier](#formatter--prettier)
   - [Task Runner — package.json Scripts](#task-runner--packagejson-scripts)
2. [Directory & Project Structure Conventions](#directory--project-structure-conventions)
   - [Single-Package Project](#single-package-project)
   - [Monorepo Layout](#monorepo-layout)
   - [Naming Conventions](#naming-conventions)
3. [Build Configuration](#build-configuration)
   - [Embedding Version from package.json](#embedding-version-from-packagejson)
   - [tsup Configuration for Dual ESM + CJS Output](#tsup-configuration-for-dual-esm--cjs-output)
   - [Environment-Specific Builds](#environment-specific-builds)
4. [Pre-commit Hooks](#pre-commit-hooks)
   - [husky + lint-staged](#husky--lint-staged)
   - [commitlint (Optional but Recommended)](#commitlint-optional-but-recommended)

---

## Toolchain

A consistent, opinionated toolchain removes ambiguity and prevents configuration drift across the team. Every TypeScript project must pin its exact version of `typescript` in `devDependencies` and keep all tooling configuration files committed to the repository.

---

### Compiler — TypeScript & tsconfig

#### Installing and Pinning TypeScript

Always pin TypeScript to an exact version. Minor TypeScript releases can tighten type checking and break existing code; pinning protects against unexpected CI failures.

```bash
# Install TypeScript as a dev dependency, pinned to an exact version
npm install --save-dev --save-exact typescript@5.5.3
```

Your `package.json` should reflect an exact pin (no `^` or `~`):

```json
{
  "devDependencies": {
    "typescript": "5.5.3"
  }
}
```

> **⚠ Note:** Never install TypeScript globally with `-g`. Always resolve `tsc` from the local `node_modules/.bin/tsc` so every developer and CI runner uses the same version.

#### Using @tsconfig/bases

The [`@tsconfig`](https://github.com/tsconfig/bases) project provides well-maintained base configurations for common runtimes. Extend from these instead of writing everything from scratch.

```bash
# For a Node.js 22 project
npm install --save-dev @tsconfig/node22 @tsconfig/strictest
```

Available bases include:

| Package | Target |
|---|---|
| `@tsconfig/node22` | Node.js 22 LTS |
| `@tsconfig/node20` | Node.js 20 LTS |
| `@tsconfig/strictest` | Maximum strictness overlay |
| `@tsconfig/esm` | Pure ESM projects |
| `@tsconfig/bun` | Bun runtime |

#### Full Annotated tsconfig.json

The following `tsconfig.json` is the recommended starting point for a Node.js 22 project. Every option is annotated.

```jsonc
// tsconfig.json
{
  // Extend a well-maintained community base for the target runtime.
  // This sets lib, module, target, and moduleResolution appropriately.
  "extends": ["@tsconfig/node22/tsconfig.json", "@tsconfig/strictest/tsconfig.json"],

  "compilerOptions": {
    // ─── Output ────────────────────────────────────────────────────────────────
    // Where TypeScript emits compiled .js files.
    "outDir": "dist",

    // The root of your source files. TypeScript mirrors this structure in outDir.
    "rootDir": "src",

    // ─── Module Resolution ──────────────────────────────────────────────────────
    // "bundler" is the modern resolution algorithm; use "node16" or "nodenext"
    // when publishing to npm without a bundler step.
    "moduleResolution": "bundler",

    // Enable import of .json files as typed modules.
    "resolveJsonModule": true,

    // Ensures files are treated as proper ES modules (not scripts).
    "isolatedModules": true,

    // ─── Strictness ─────────────────────────────────────────────────────────────
    // Master switch: enables noImplicitAny, strictNullChecks, strictFunctionTypes,
    // strictBindCallApply, strictPropertyInitialization, noImplicitThis,
    // alwaysStrict, and useUnknownInCatchVariables.
    "strict": true,

    // Array index access returns T | undefined instead of T.
    // Prevents countless runtime "undefined is not an object" bugs.
    "noUncheckedIndexedAccess": true,

    // Differentiates between { prop?: string } (optional) and { prop: string | undefined }
    // (required but may be explicitly undefined). Prevents silent missing-key bugs.
    "exactOptionalPropertyTypes": true,

    // Catch variables in try/catch are typed as unknown instead of any.
    // Forces you to narrow the error before using it.
    "useUnknownInCatchVariables": true,

    // Class methods that override a parent method must use the `override` keyword.
    // Prevents accidental shadowing of base class methods.
    "noImplicitOverride": true,

    // Disallows unreachable code (dead branches after return/throw).
    "allowUnreachableCode": false,

    // Disallows unused labels (e.g., leftover loop labels).
    "allowUnusedLabels": false,

    // Report errors when a local variable or parameter is declared but never read.
    "noUnusedLocals": true,

    // Report errors when a function parameter is declared but never used.
    "noUnusedParameters": true,

    // Require an explicit return in all code paths of a function.
    "noImplicitReturns": true,

    // Prevent fall-through between non-empty switch-case clauses.
    "noFallthroughCasesInSwitch": true,

    // ─── Emit ───────────────────────────────────────────────────────────────────
    // Emit .d.ts declaration files alongside compiled output.
    "declaration": true,

    // Emit .d.ts.map files linking declarations back to source .ts files.
    // Enables "Go to definition" to navigate to the original TypeScript source.
    "declarationMap": true,

    // Emit .js.map source map files for runtime debugging.
    "sourceMap": true,

    // Do NOT emit if there are type errors. Prevents shipping broken builds.
    "noEmitOnError": true,

    // ─── Interoperability ────────────────────────────────────────────────────────
    // Allow default imports from CommonJS modules that don't declare a default export.
    // Required for many npm packages (e.g., import express from 'express').
    "esModuleInterop": true,

    // Ensure consistent casing for file names across operating systems.
    // Prevents issues where macOS (case-insensitive) accepts a file that Linux rejects.
    "forceConsistentCasingInFileNames": true,

    // ─── Path Aliases ────────────────────────────────────────────────────────────
    // Define import aliases to avoid brittle relative imports like ../../../../utils.
    // Note: these aliases only affect TypeScript; your bundler or Node must also be
    // configured to resolve them at runtime (e.g., via tsup define or module-alias).
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"],
      "@lib/*": ["src/lib/*"],
      "@types/*": ["src/types/*"]
    },

    // ─── Skipping Declaration Files ──────────────────────────────────────────────
    // Skip type checking of .d.ts files in node_modules.
    // Dramatically speeds up type checking; third-party types are assumed correct.
    "skipLibCheck": true
  },

  // Include all TypeScript files under src/ and any .d.ts in the project root.
  "include": ["src/**/*", "*.d.ts"],

  // Exclude compiled output and transient directories.
  "exclude": ["node_modules", "dist", "coverage", "**/*.test.ts", "**/*.spec.ts"]
}
```

> **⚠ Note:** `"exactOptionalPropertyTypes": true` is a breaking change if you spread or assign optional properties from one object type to another. Enable it on new projects; migrate existing projects incrementally with `// @ts-expect-error` suppressions while you fix call sites.

#### Separate tsconfig for Type-Checking Tests

Tests often use globals (`describe`, `it`, `expect`) that come from the test framework, and they should not be included in the production `outDir`. Create a separate config that extends the root:

```jsonc
// tsconfig.test.json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    // Do not emit; we only use this config for type checking.
    "noEmit": true,
    // Tests can reference test-framework globals.
    "types": ["node", "jest"]
  },
  // Override include to cover test files.
  "include": ["src/**/*", "**/__tests__/**/*", "**/*.test.ts", "**/*.spec.ts"]
}
```

---

### Linter — ESLint with typescript-eslint

ESLint with `typescript-eslint` provides both style enforcement and type-aware static analysis that the TypeScript compiler alone cannot catch (e.g., floating promises, unsafe `any` usage in expressions).

#### Installation

```bash
npm install --save-dev \
  eslint@9 \
  typescript-eslint \
  eslint-config-prettier
```

> **⚠ Note:** ESLint 9 uses the new **flat config** format (`eslint.config.mjs`). The legacy `.eslintrc.*` format is deprecated. All new projects must use flat config.

#### Complete eslint.config.mjs

```javascript
// eslint.config.mjs
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  // ── Global ignores ─────────────────────────────────────────────────────────
  {
    ignores: [
      "dist/**",
      "coverage/**",
      "node_modules/**",
      "*.js",          // Ignore plain JS files at root (config files, scripts)
      "*.mjs",         // But not this file itself — handled by tseslint.config()
    ],
  },

  // ── Base recommended rules ──────────────────────────────────────────────────
  // tseslint.configs.recommendedTypeChecked enables all recommended rules that
  // require type information from the TypeScript compiler.
  ...tseslint.configs.recommendedTypeChecked,

  // ── Stricter rules ──────────────────────────────────────────────────────────
  // Add the strictTypeChecked preset for maximum safety (catches more patterns
  // involving `any`, unsafe assignments, etc.).
  ...tseslint.configs.strictTypeChecked,

  // ── Stylistic rules ─────────────────────────────────────────────────────────
  ...tseslint.configs.stylisticTypeChecked,

  // ── Project-wide language options ───────────────────────────────────────────
  {
    languageOptions: {
      parserOptions: {
        // Point to the tsconfig that covers all linted files.
        // For monorepos, use projectService instead (see note below).
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ── Custom rule overrides ────────────────────────────────────────────────────
  {
    rules: {
      // Enforce explicit return types on exported functions.
      // Prevents accidental widening of a function's public contract.
      "@typescript-eslint/explicit-module-boundary-types": "error",

      // Disallow use of `any` type. Use `unknown` and narrow instead.
      "@typescript-eslint/no-explicit-any": "error",

      // Require Promises to be handled (awaited, .catch(), void operator).
      // Prevents silent swallowed async errors.
      "@typescript-eslint/no-floating-promises": "error",

      // Disallow awaiting non-Promise values (usually a mistake).
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            // Allow async callbacks in JSX event handlers and common patterns.
            attributes: false,
          },
        },
      ],

      // Allow `_`-prefixed variables to be unused (common convention).
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],

      // Prefer nullish coalescing (??) over logical OR (||) for defaults
      // when the left side might be 0 or "".
      "@typescript-eslint/prefer-nullish-coalescing": "error",

      // Prefer optional chaining (?.) over manual null checks.
      "@typescript-eslint/prefer-optional-chain": "error",

      // Require consistent use of type assertions (as T, not <T>).
      "@typescript-eslint/consistent-type-assertions": [
        "error",
        { assertionStyle: "as", objectLiteralTypeAssertions: "never" },
      ],

      // Enforce `import type` for type-only imports. Keeps runtime bundles clean.
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],

      // Enforce `export type` for type-only exports.
      "@typescript-eslint/consistent-type-exports": "error",

      // Disallow non-null assertions (!). Prefer explicit null checks.
      "@typescript-eslint/no-non-null-assertion": "error",

      // Standard ESLint: prefer `const` over `let` when variable is never reassigned.
      "prefer-const": "error",

      // Standard ESLint: disallow `var`.
      "no-var": "error",

      // Standard ESLint: require === and !== instead of == and !=.
      "eqeqeq": ["error", "always", { null: "ignore" }],
    },
  },

  // ── Test file overrides ──────────────────────────────────────────────────────
  {
    files: ["**/__tests__/**/*.ts", "**/*.test.ts", "**/*.spec.ts"],
    rules: {
      // Test files often assert on private members or use `any` for mocks.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      // Explicit return types are noise in test helpers.
      "@typescript-eslint/explicit-module-boundary-types": "off",
    },
  },

  // ── Disable formatting rules that Prettier handles ───────────────────────────
  // Must be last so it overrides all formatting rules set above.
  eslintConfigPrettier,
);
```

> **⚠ Note:** Type-aware rules require the TypeScript compiler to run during linting, which is slower than plain ESLint. For monorepos, replace `project: "./tsconfig.json"` with `projectService: true` in `languageOptions.parserOptions` to use TypeScript's project service for faster incremental builds.

---

### Formatter — Prettier

Prettier handles all whitespace and formatting concerns. ESLint handles logic and type concerns. Never overlap: `eslint-config-prettier` disables every ESLint rule that Prettier already manages.

#### Installation

```bash
npm install --save-dev prettier eslint-config-prettier
```

#### .prettierrc

```json
{
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "quoteProps": "as-needed",
  "jsxSingleQuote": false,
  "trailingComma": "all",
  "bracketSpacing": true,
  "bracketSameLine": false,
  "arrowParens": "always",
  "endOfLine": "lf",
  "embeddedLanguageFormatting": "auto"
}
```

#### .prettierignore

```gitignore
# .prettierignore
dist/
coverage/
node_modules/
*.min.js
*.min.css
CHANGELOG.md
pnpm-lock.yaml
package-lock.json
yarn.lock
```

> **⚠ Note:** Commit `.prettierrc` and `.prettierignore` to version control. Never rely on Prettier defaults; they can change between versions and cause unexpected diffs for teammates.

#### Verifying There Are No ESLint/Prettier Conflicts

After installing `eslint-config-prettier`, verify it is properly disabling conflicting rules:

```bash
# Print all rules that eslint-config-prettier disables.
# Confirm none of your custom rules appear in this list.
npx eslint-config-prettier eslint.config.mjs
```

---

### Task Runner — package.json Scripts

`package.json` scripts are the canonical task runner for TypeScript projects. They are simple, universally understood, and require no additional tooling. Avoid introducing Makefile, Taskfile, or Gulp unless the project has genuinely complex orchestration needs.

#### Complete scripts block

```jsonc
// package.json (scripts section)
{
  "scripts": {
    // ── Type checking ──────────────────────────────────────────────────────────
    // Run the TypeScript compiler without emitting output.
    // Use this in CI to confirm the project is type-safe.
    "typecheck": "tsc --noEmit",

    // Also typecheck test files using the test-specific tsconfig.
    "typecheck:test": "tsc --noEmit --project tsconfig.test.json",

    // ── Linting ────────────────────────────────────────────────────────────────
    // Lint all TypeScript source files. --max-warnings 0 fails on any warning.
    "lint": "eslint src --ext .ts,.tsx --max-warnings 0",

    // Automatically fix auto-fixable ESLint violations.
    "lint:fix": "eslint src --ext .ts,.tsx --fix",

    // ── Formatting ─────────────────────────────────────────────────────────────
    // Check formatting without modifying files (use in CI).
    "format:check": "prettier --check \"src/**/*.{ts,tsx,json,md}\"",

    // Reformat all source files in place (use locally).
    "format": "prettier --write \"src/**/*.{ts,tsx,json,md}\"",

    // ── Build ──────────────────────────────────────────────────────────────────
    // Production build using tsup (see Build Configuration section).
    "build": "tsup",

    // Development build with file watching — reruns tsup on source changes.
    "build:watch": "tsup --watch",

    // Build using tsc directly (no bundling); useful for library projects.
    "build:tsc": "tsc --project tsconfig.json",

    // ── Development execution ──────────────────────────────────────────────────
    // Run a TypeScript file directly using tsx (no compilation step).
    // tsx uses esbuild under the hood for near-instant startup.
    "dev": "tsx watch src/index.ts",

    // One-shot execution (useful for scripts and CLIs).
    "start:dev": "tsx src/index.ts",

    // ── Testing ────────────────────────────────────────────────────────────────
    "test": "jest --passWithNoTests",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage --coverageReporters=text --coverageReporters=lcov",
    "test:ci": "jest --ci --coverage --passWithNoTests",

    // ── Cleanup ────────────────────────────────────────────────────────────────
    // Remove all build artifacts and coverage reports.
    "clean": "rm -rf dist coverage",

    // Full clean including node_modules (use before reinstalling from scratch).
    "clean:all": "rm -rf dist coverage node_modules .cache",

    // ── Composite CI check ─────────────────────────────────────────────────────
    // Run all checks in sequence. Any failure stops the pipeline.
    "ci": "npm run typecheck && npm run lint && npm run format:check && npm run test:ci && npm run build"
  }
}
```

#### tsx vs ts-node

| Tool | Use Case | Speed | Notes |
|---|---|---|---|
| `tsx` | Local dev, scripts | Very fast (esbuild) | Does not type-check; just transpiles |
| `ts-node` | Legacy, REPL | Slower | Uses `tsc`; can be configured with `transpileOnly` |
| `ts-node --transpile-only` | Dev when ts-node required | Fast | Skips type checking like tsx |

**Recommendation:** Use `tsx` for all local development execution. It is the fastest option and has excellent ESM support.

```bash
npm install --save-dev tsx
```

> **⚠ Note:** Neither `tsx` nor `ts-node` performs type checking at runtime. Always run `npm run typecheck` separately in CI. Do not ship code that only passes because it was never type-checked.

---

## Directory & Project Structure Conventions

### Single-Package Project

A clear, predictable directory structure reduces the onboarding time for new contributors and prevents the common mistake of importing from `dist/` or from deeply nested relative paths.

```
my-project/
├── .husky/                    # Git hooks (managed by husky)
│   └── pre-commit
├── src/                       # All application source code
│   ├── index.ts               # Public entry point / barrel export
│   ├── lib/                   # Reusable library modules
│   │   ├── http-client.ts
│   │   └── logger.ts
│   ├── services/              # Business logic / use cases
│   │   ├── user-service.ts
│   │   └── payment-service.ts
│   ├── models/                # Domain models and interfaces
│   │   ├── user.ts
│   │   └── payment.ts
│   ├── types/                 # Shared TypeScript types and enums
│   │   ├── api.ts
│   │   └── common.ts
│   ├── utils/                 # Pure utility functions
│   │   ├── date.ts
│   │   └── string.ts
│   ├── config/                # Configuration loading and validation
│   │   └── env.ts
│   └── __tests__/             # Tests co-located at the src level
│       ├── user-service.test.ts
│       └── payment-service.test.ts
├── scripts/                   # One-off utility scripts (run with tsx)
│   └── seed-database.ts
├── docs/                      # Documentation, ADRs, API docs
│   └── architecture.md
├── dist/                      # Compiled output (gitignored)
├── coverage/                  # Jest coverage reports (gitignored)
├── .eslintignore              # (optional, legacy — use flat config ignores)
├── .gitignore
├── .prettierignore
├── .prettierrc
├── eslint.config.mjs
├── jest.config.ts
├── package.json
├── tsconfig.json
├── tsconfig.test.json
└── tsup.config.ts
```

#### Barrel Exports via index.ts

Each module folder should export its public surface through a top-level `index.ts`. This keeps internal implementations private and provides a stable import path.

```typescript
// src/services/index.ts
export { UserService } from "./user-service";
export { PaymentService } from "./payment-service";
// Do NOT export internal helpers like formatUserRecord — keep them private.
```

```typescript
// src/index.ts  — the package's main public API
export * from "./services";
export * from "./models";
export type * from "./types";
```

Consumers can then import from the package root:

```typescript
// Good — stable import from the public surface
import { UserService } from "@my-org/my-package";

// Avoid — brittle, exposes internal paths
import { UserService } from "@my-org/my-package/dist/services/user-service";
```

> **⚠ Note:** Do not create barrel exports (`index.ts`) for every folder automatically. Only create them for directories that have a genuine public API. Barrel files in deeply nested folders cause bundlers to include the entire sub-tree even when only one export is needed, increasing bundle size. Prefer direct imports for internal code.

---

### Monorepo Layout

For multi-package repositories, use a `packages/` directory. Each package is an independent npm package with its own `package.json`, `tsconfig.json`, and `src/` tree.

```
my-monorepo/
├── packages/
│   ├── core/                  # @my-org/core
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── api/                   # @my-org/api (depends on @my-org/core)
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── ui/                    # @my-org/ui (React component library)
│       ├── src/
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── apps/
│   └── web/                   # Next.js or Vite application
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── tsconfig.base.json         # Shared compiler options for all packages
├── package.json               # Workspace root (npm workspaces / pnpm workspaces)
└── .eslintrc.base.mjs         # Shared ESLint config (optional)
```

#### tsconfig.base.json (Monorepo Root)

```jsonc
// tsconfig.base.json
{
  // Shared strictness and compiler options for every package.
  // Each package extends this and adds its own rootDir/outDir.
  "extends": ["@tsconfig/node22/tsconfig.json", "@tsconfig/strictest/tsconfig.json"],
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "useUnknownInCatchVariables": true,
    "noImplicitOverride": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmitOnError": true,
    "skipLibCheck": true
  }
}
```

#### Per-Package tsconfig.json

```jsonc
// packages/core/tsconfig.json
{
  // Extend from the monorepo root base.
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    // Reference sibling packages as TypeScript project references.
    // This enables incremental builds: TypeScript only recompiles packages
    // whose source has changed.
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

```jsonc
// packages/api/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"],
  // TypeScript project references: declare that this package depends on core.
  // Run `tsc --build` from the root to build all packages in the correct order.
  "references": [
    { "path": "../core" }
  ]
}
```

#### Workspace Root package.json

```json
{
  "name": "my-monorepo",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "build": "tsc --build",
    "typecheck": "tsc --build --noEmit",
    "lint": "eslint packages apps --ext .ts,.tsx --max-warnings 0",
    "format:check": "prettier --check \"packages/**/src/**/*.ts\" \"apps/**/src/**/*.ts\"",
    "test": "jest --projects packages/*/jest.config.ts",
    "clean": "tsc --build --clean"
  },
  "devDependencies": {
    "typescript": "5.5.3",
    "@tsconfig/node22": "^14.1.0",
    "@tsconfig/strictest": "^2.0.5"
  }
}
```

---

### Naming Conventions

Consistent naming removes the cognitive overhead of "what case does this use?" across the codebase.

| Category | Convention | Example |
|---|---|---|
| Files | `kebab-case` | `user-service.ts`, `http-client.ts` |
| Directories | `kebab-case` | `src/user-service/`, `src/__tests__/` |
| Classes | `PascalCase` | `class UserService {}` |
| Interfaces | `PascalCase` (no `I` prefix) | `interface UserRepository {}` |
| Type aliases | `PascalCase` | `type UserId = string` |
| Enums | `PascalCase` (members `UPPER_SNAKE_CASE`) | `enum HttpStatus { OK = 200 }` |
| Functions | `camelCase` | `function getUserById() {}` |
| Variables | `camelCase` | `const userRecord = ...` |
| Constants (module-level) | `UPPER_SNAKE_CASE` | `const MAX_RETRIES = 3` |
| Generic type parameters | Single uppercase letter or `TPascalCase` | `<T>`, `<TValue>`, `<TKey>` |
| Test files | Same name as source + `.test.ts` | `user-service.test.ts` |
| React components | `PascalCase.tsx` | `UserCard.tsx` |

> **⚠ Note:** Do not prefix interfaces with `I` (e.g., `IUserService`). This is a legacy C# convention. TypeScript interfaces and type aliases are interchangeable in most contexts. Use the name that reads naturally: `UserService`, `UserRepository`, `Config`.

---

## Build Configuration

### Embedding Version from package.json

Including the package version in your compiled output is useful for API responses, logs, and CLI `--version` flags. There are two approaches.

#### Approach 1: resolveJsonModule (TypeScript native)

```jsonc
// tsconfig.json — ensure this is set:
{
  "compilerOptions": {
    "resolveJsonModule": true
  }
}
```

```typescript
// src/version.ts
import packageJson from "../package.json";

// TypeScript infers the exact literal type of version from package.json.
export const VERSION: string = packageJson.version;
export const APP_NAME: string = packageJson.name;
```

```typescript
// src/index.ts
import { VERSION } from "./version";

console.log(`Starting server v${VERSION}`);
```

> **⚠ Note:** When using `resolveJsonModule` with a bundler, ensure the bundler is not tree-shaking the version field or bundling the entire `package.json` (which may expose internal paths). Use `tsup`'s `define` option (below) for a safer approach in production builds.

#### Approach 2: tsup define (build-time injection)

This approach replaces `__VERSION__` at build time without bundling `package.json` into the output.

```typescript
// src/version.ts
// __VERSION__ is replaced at build time by tsup.
declare const __VERSION__: string;
export const VERSION = __VERSION__;
```

The `define` replacement is configured in `tsup.config.ts` (see next section).

---

### tsup Configuration for Dual ESM + CJS Output

`tsup` is the recommended build tool for TypeScript libraries. It wraps esbuild for fast compilation and adds TypeScript declaration file generation on top.

```bash
npm install --save-dev tsup
```

#### tsup.config.ts

```typescript
// tsup.config.ts
import { defineConfig } from "tsup";
import packageJson from "./package.json";

export default defineConfig((options) => ({
  // ── Entry Points ────────────────────────────────────────────────────────────
  // tsup resolves all exports from this entry and bundles them.
  entry: ["src/index.ts"],

  // ── Output Formats ──────────────────────────────────────────────────────────
  // Emit both ES Modules (.mjs) and CommonJS (.cjs) for maximum compatibility.
  // Libraries should ship both so consumers can use either format.
  format: ["esm", "cjs"],

  // ── TypeScript Declarations ─────────────────────────────────────────────────
  // Generate .d.ts files (required for TypeScript consumers).
  dts: true,

  // Generate .d.ts.map files for source navigation in IDEs.
  // Equivalent to declarationMap in tsconfig.
  // Note: tsup handles this via the dts option automatically when sourcemap is true.

  // ── Source Maps ─────────────────────────────────────────────────────────────
  // Emit .js.map source maps for runtime debugging.
  sourcemap: true,

  // ── Output Splitting ────────────────────────────────────────────────────────
  // Split output into multiple chunks (only applies to ESM).
  // Enables tree-shaking for consumers; each module gets its own chunk.
  splitting: true,

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  // Remove dist/ before each build to avoid stale files.
  clean: true,

  // ── Minification ────────────────────────────────────────────────────────────
  // Only minify in production builds (when NODE_ENV=production or --minify flag).
  // For libraries, minification is generally NOT recommended — it makes debugging
  // harder for consumers. Enable for applications.
  minify: options.watch !== true && process.env.NODE_ENV === "production",

  // ── External Dependencies ────────────────────────────────────────────────────
  // Do NOT bundle packages listed in dependencies/peerDependencies.
  // Only bundle devDependencies and files within the project.
  // This is the default behavior; listed here for clarity.
  noExternal: [],

  // ── Build-Time Constants ────────────────────────────────────────────────────
  // Replace identifiers at build time (similar to webpack DefinePlugin).
  define: {
    __VERSION__: JSON.stringify(packageJson.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },

  // ── TypeScript Config ────────────────────────────────────────────────────────
  // Point tsup to your tsconfig for path alias resolution.
  tsconfig: "./tsconfig.json",

  // ── Tree Shaking ─────────────────────────────────────────────────────────────
  // Ensure tsup passes --tree-shaking to esbuild.
  treeshake: true,

  // ── Target Environment ───────────────────────────────────────────────────────
  // Match the target runtime. "node22" generates modern JS without polyfills.
  target: "node22",

  // ── Banner ──────────────────────────────────────────────────────────────────
  // Optional: prepend a license comment to compiled output.
  banner: {
    js: `// ${packageJson.name} v${packageJson.version} — ${packageJson.license ?? "UNLICENSED"}`,
  },
}));
```

#### package.json exports field

After building with dual output, declare the `exports` map in `package.json` so Node.js and bundlers know which format to use:

```json
{
  "name": "@my-org/my-package",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      },
      "require": {
        "types": "./dist/index.d.cts",
        "default": "./dist/index.cjs"
      }
    }
  },
  "files": ["dist"],
  "sideEffects": false
}
```

> **⚠ Note:** The `"sideEffects": false` field tells bundlers this package is safe for tree-shaking. Only set this if your package has no module-level side effects (no global polyfills, no CSS imports, no auto-executing code at import time).

---

### Environment-Specific Builds

#### NODE_ENV Guards

Use `process.env.NODE_ENV` for runtime environment detection. TypeScript + esbuild (via tsup) can statically eliminate dead branches:

```typescript
// src/lib/logger.ts
const isDevelopment = process.env.NODE_ENV === "development";
const isProduction = process.env.NODE_ENV === "production";

export function createLogger(name: string) {
  return {
    debug(message: string, context?: Record<string, unknown>): void {
      // In production builds with define: { 'process.env.NODE_ENV': '"production"' },
      // esbuild eliminates this entire branch at compile time.
      if (isDevelopment) {
        console.debug(`[${name}] ${message}`, context ?? "");
      }
    },
    info(message: string, context?: Record<string, unknown>): void {
      console.info(`[${name}] ${message}`, context ?? "");
    },
    error(message: string, error?: unknown): void {
      console.error(`[${name}] ${message}`, error);
    },
  };
}
```

#### Injecting NODE_ENV at Build Time

In `tsup.config.ts`, statically replace `process.env.NODE_ENV` so esbuild can dead-code-eliminate development-only branches in production builds:

```typescript
// tsup.config.ts (additions to the define block)
define: {
  __VERSION__: JSON.stringify(packageJson.version),
  // Replace process.env.NODE_ENV with a literal string.
  // Dead branches (e.g., if (process.env.NODE_ENV === 'development'))
  // are eliminated from the production bundle.
  "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production"),
},
```

Then in `package.json` scripts:

```json
{
  "scripts": {
    "build": "NODE_ENV=production tsup",
    "build:dev": "NODE_ENV=development tsup"
  }
}
```

#### Separate Dev and Prod tsup Configs

For projects with significantly different dev/prod build requirements, use multiple config files:

```typescript
// tsup.config.dev.ts
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs"],         // Dev: CJS only for simplicity
  sourcemap: true,
  dts: false,              // Skip declarations in dev builds
  clean: false,            // Don't clean in watch mode
  watch: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("development"),
    __VERSION__: '"dev"',
  },
});
```

```typescript
// tsup.config.prod.ts
import { defineConfig } from "tsup";
import packageJson from "./package.json";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  sourcemap: true,
  dts: true,
  clean: true,
  splitting: true,
  treeshake: true,
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    __VERSION__: JSON.stringify(packageJson.version),
  },
});
```

```json
{
  "scripts": {
    "build": "tsup --config tsup.config.prod.ts",
    "build:dev": "tsup --config tsup.config.dev.ts"
  }
}
```

---

## Pre-commit Hooks

Pre-commit hooks are the last line of defense before bad code enters the repository. They run automatically on `git commit` and enforce formatting, linting, and type safety without requiring manual discipline.

### husky + lint-staged

`husky` manages Git hooks. `lint-staged` runs linters only against staged files, keeping hooks fast even in large repositories.

#### Installation

```bash
# Install husky and lint-staged
npm install --save-dev husky lint-staged

# Initialize husky — creates .husky/ directory and configures the Git hooks path
npx husky init
```

After `husky init`, a `.husky/pre-commit` file is created. Replace its contents:

```bash
# .husky/pre-commit
#!/bin/sh

# Run lint-staged on staged files (formatting + linting)
npx lint-staged

# Run TypeScript type checking on the whole project.
# lint-staged cannot run tsc per-file; it must check the entire project.
# --noEmit: only check types, don't emit .js files.
npx tsc --noEmit
```

Make the hook executable:

```bash
chmod +x .husky/pre-commit
```

> **⚠ Note:** `tsc --noEmit` checks the entire project on every commit, which may take 5–30 seconds depending on project size. For very large projects, consider running `tsc --noEmit` only in CI and keeping the pre-commit hook limited to lint-staged. Never skip the type check entirely.

#### lint-staged Configuration

Add the `lint-staged` configuration to `package.json`:

```json
{
  "lint-staged": {
    "*.{ts,tsx}": [
      "prettier --write",
      "eslint --fix --max-warnings 0"
    ],
    "*.{json,md,yml,yaml}": [
      "prettier --write"
    ]
  }
}
```

This configuration:
1. For TypeScript files: auto-formats with Prettier, then auto-fixes ESLint violations, then fails if any violations remain that cannot be auto-fixed (`--max-warnings 0`).
2. For JSON, Markdown, and YAML: auto-formats with Prettier only.

> **⚠ Note:** The order matters. Always run Prettier before ESLint. Prettier may reformat code that ESLint then re-validates, so running ESLint last ensures the final staged file passes all rules.

#### Verify the Hook Works

```bash
# Stage a file with a formatting issue
echo 'const x="bad formatting"' >> src/test-hook.ts
git add src/test-hook.ts

# Attempt to commit — the pre-commit hook should reject it
git commit -m "test: verify hook"
# Expected: Prettier rewrites the file, ESLint catches issues, commit is blocked.

# Clean up
git checkout -- src/test-hook.ts
```

#### Full package.json with All Hook Configuration

```json
{
  "name": "my-project",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "prepare": "husky",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src --ext .ts,.tsx --max-warnings 0",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "format:check": "prettier --check \"src/**/*.{ts,tsx,json,md}\"",
    "format": "prettier --write \"src/**/*.{ts,tsx,json,md}\"",
    "build": "tsup",
    "dev": "tsx watch src/index.ts",
    "test": "jest --passWithNoTests",
    "clean": "rm -rf dist coverage",
    "ci": "npm run typecheck && npm run lint && npm run format:check && npm run test:ci && npm run build"
  },
  "lint-staged": {
    "*.{ts,tsx}": [
      "prettier --write",
      "eslint --fix --max-warnings 0"
    ],
    "*.{json,md,yml,yaml}": [
      "prettier --write"
    ]
  },
  "devDependencies": {
    "@tsconfig/node22": "^14.1.0",
    "@tsconfig/strictest": "^2.0.5",
    "eslint": "^9.0.0",
    "eslint-config-prettier": "^9.1.0",
    "husky": "^9.1.0",
    "lint-staged": "^15.2.0",
    "prettier": "^3.3.0",
    "tsup": "^8.2.0",
    "tsx": "^4.16.0",
    "typescript": "5.5.3",
    "typescript-eslint": "^8.0.0"
  }
}
```

> **⚠ Note:** The `"prepare": "husky"` script runs automatically after `npm install`. This means anyone who clones the repository and runs `npm install` will automatically have the Git hooks configured — no extra steps required.

---

### commitlint (Optional but Recommended)

`commitlint` enforces a consistent commit message format. This is especially valuable in monorepos and open-source projects where commit messages are used to generate changelogs (via `semantic-release` or `conventional-changelog`).

#### Installation

```bash
npm install --save-dev @commitlint/cli @commitlint/config-conventional
```

#### commitlint.config.ts

```typescript
// commitlint.config.ts
import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  // Extends the conventional commits specification:
  // type(scope): description
  // Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
  extends: ["@commitlint/config-conventional"],

  rules: {
    // Limit header to 100 characters (consistent with Prettier printWidth).
    "header-max-length": [2, "always", 100],

    // Body lines must not exceed 120 characters.
    "body-max-line-length": [2, "always", 120],

    // Allowed commit types. Add project-specific types as needed.
    "type-enum": [
      2,
      "always",
      [
        "feat",      // A new feature
        "fix",       // A bug fix
        "docs",      // Documentation only changes
        "style",     // Formatting, missing semicolons; no logic change
        "refactor",  // Code change that is neither a feature nor a bug fix
        "perf",      // Performance improvements
        "test",      // Adding or correcting tests
        "build",     // Build system or external dependency changes
        "ci",        // CI configuration changes
        "chore",     // Other changes (e.g., updating .gitignore)
        "revert",    // Reverts a previous commit
      ],
    ],

    // Scope is optional but must be lowercase when provided.
    "scope-case": [2, "always", "lower-case"],

    // Subject must not end with a period.
    "subject-full-stop": [2, "never", "."],

    // Subject must start in lower case.
    "subject-case": [2, "always", "lower-case"],
  },
};

export default config;
```

#### Add the commit-msg Hook

```bash
# Add a commit-msg hook that runs commitlint
echo 'npx --no -- commitlint --edit "$1"' > .husky/commit-msg
chmod +x .husky/commit-msg
```

#### Valid Commit Message Examples

```
# Good
feat(auth): add OAuth2 PKCE flow
fix(api): handle null response from payment gateway
docs: add setup guide to README
chore: update typescript to 5.5.3
refactor(user-service): extract email validation to util function

# Bad — will be rejected by commitlint
Added new feature          # No type prefix
Feat: add new feature      # Type must be lowercase
feat: Added new feature.   # Subject must be lowercase; no trailing period
```

> **⚠ Note:** Adopting `commitlint` mid-project on a team requires buy-in. Announce the change, provide a cheat sheet of valid types, and add a `CONTRIBUTING.md` that explains the convention. The initial friction pays off when you need to generate a changelog or debug which commit introduced a regression.

---

## Summary

The setup described in this guide establishes the following guarantees for every TypeScript project:

| Guarantee | Enforced By |
|---|---|
| No type errors | `tsc --noEmit` in pre-commit hook and CI |
| No lint violations | ESLint with `typescript-eslint` (type-aware rules) |
| Consistent formatting | Prettier, enforced by lint-staged on every commit |
| No accidentally broken builds | `noEmitOnError: true` in tsconfig |
| No implicit `any` in catch blocks | `useUnknownInCatchVariables: true` |
| No accidental array out-of-bounds | `noUncheckedIndexedAccess: true` |
| No missing `override` keywords | `noImplicitOverride: true` |
| Consistent commit messages | commitlint + commit-msg hook |
| Dual ESM + CJS output | tsup with `format: ["esm", "cjs"]` |
| Version embedded in build | `define` in tsup or `resolveJsonModule` |

Proceed to **02-types-and-interfaces.md** for the next section of the TypeScript guidelines, covering type system best practices.
