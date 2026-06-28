# TypeScript Guidelines – 04: Unit Testing

> **Canonical test runner:** [Vitest](https://vitest.dev/) (v1.x+). Where behaviour differs, Jest alternatives are noted explicitly.

---

## Table of Contents

1. [Test File Conventions](#test-file-conventions)
2. [Test Naming Conventions](#test-naming-conventions)
3. [Parallel Test Safety](#parallel-test-safety)
4. [Mocking](#mocking)
5. [Assertion Patterns](#assertion-patterns)
6. [Async Testing](#async-testing)
7. [Coverage Targets](#coverage-targets)
8. [Table-Driven Tests](#table-driven-tests)
9. [Testing Pure Functions vs. Classes with Dependencies](#testing-pure-functions-vs-classes-with-dependencies)

---

## Test File Conventions

### Co-location vs. Separation

Two layouts are acceptable. Choose one per project and enforce it consistently.

**Option A — Co-located (preferred for most projects)**

Each test file lives next to the module it exercises. Refactoring moves the test automatically.

```
src/
  users/
    user-service.ts
    user-service.test.ts       ← unit test
    user-repository.ts
    user-repository.test.ts
  orders/
    order-service.ts
    order-service.test.ts
```

**Option B — `__tests__/` subdirectory**

Useful when the team wants a clear visual boundary or the tool chain expects it.

```
src/
  users/
    __tests__/
      user-service.test.ts
      user-repository.test.ts
    user-service.ts
    user-repository.ts
```

Either layout works with Vitest's default glob (`**/*.test.ts`). The `__tests__` variant requires no extra configuration.

### Vitest Configuration (`vitest.config.ts`)

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ── File discovery ──────────────────────────────────────────
    include: ['src/**/*.test.ts'],          // unit tests
    exclude: ['src/**/*.spec.ts',           // keep integration separate
               'node_modules/**',
               'dist/**'],

    // ── Environment ─────────────────────────────────────────────
    // 'node'  → server-side / CLI / library code  (default)
    // 'jsdom' → browser-targeted code or React components
    environment: 'node',

    // ── Globals ─────────────────────────────────────────────────
    // Enables describe/it/expect without explicit imports.
    // Add "types": ["vitest/globals"] to tsconfig for IDE support.
    globals: true,

    // ── Coverage ────────────────────────────────────────────────
    coverage: {
      provider: 'v8',                       // fastest; 'istanbul' for legacy
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts', 'src/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },

    // ── Timeouts ────────────────────────────────────────────────
    testTimeout: 5_000,                     // 5 s per test (raise only for I/O)
    hookTimeout: 10_000,

    // ── Reporters ───────────────────────────────────────────────
    reporters: ['verbose'],
  },
});
```

**tsconfig for globals:**

```jsonc
// tsconfig.json (or tsconfig.test.json)
{
  "compilerOptions": {
    "types": ["vitest/globals"]
  }
}
```

> **Jest alternative:** Replace `vitest/config` with `jest.config.ts` using `ts-jest` or `@swc/jest`. The `globals` option becomes `jest.globals` and coverage uses `--coverage --coverageProvider=v8`.

### Unit Test vs. Integration Test

| Concern | Unit Test | Integration Test |
|---|---|---|
| External I/O (DB, HTTP, FS) | Mocked / stubbed | Real (e.g. testcontainers) |
| Speed | < 100 ms per test | 1–30 s per test |
| File suffix | `*.test.ts` | `*.spec.ts` |
| Vitest config | `vitest.config.ts` | `vitest.integration.config.ts` |
| Isolation | Full — no shared process state | Per-suite DB transaction rollback |

**Rule:** A unit test that reaches a real database, filesystem, or network is a broken test. If it needs real I/O, promote it to an integration test and move it to `*.spec.ts`.

### Shared Test Utilities

```
tests/
  helpers/
    render-with-providers.tsx   ← React wrapper helpers
    create-test-server.ts       ← lightweight HTTP server factory
  fixtures/
    user.fixture.ts             ← typed factory functions
    product.fixture.ts
  mocks/
    prisma.mock.ts              ← shared Prisma client mock
    email-service.mock.ts
```

**Fixture factory example:**

```typescript
// tests/fixtures/user.fixture.ts
import type { User } from '../../src/users/user.types';

let _id = 1;

export function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: String(_id++),
    email: `user${_id}@example.com`,
    name: 'Test User',
    role: 'member',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}
```

---

## Test Naming Conventions

### File Names

| Suffix | Purpose |
|---|---|
| `*.test.ts` | Unit tests — isolated, mocked I/O |
| `*.spec.ts` | Integration / E2E — real or near-real I/O |

Pick one convention and enforce it with an ESLint rule or a CI check. Never mix suffixes in the same directory without a clear policy.

### `describe` Block Names

Name `describe` after the **unit under test** — the exported function name, class name, or module path.

```typescript
// ✅ Correct — names the exact unit
describe('UserService', () => { ... });
describe('formatCurrency', () => { ... });
describe('useAuth hook', () => { ... });

// ❌ Incorrect — too vague
describe('tests', () => { ... });
describe('user stuff', () => { ... });
describe('helpers', () => { ... });
```

### `it` / `test` Names

Follow the pattern: **`[subject] [condition] [expected outcome]`**

```
"[subject]   [condition]                     [expected outcome]"
 getUser      when the user id does not exist  returns null
 createOrder  when stock is insufficient       throws InsufficientStockError
 formatDate   given an ISO string              returns a localised DD/MM/YYYY string
```

```typescript
// ✅ Correct — readable as a sentence, specific
it('getUser returns null when user id does not exist', async () => { ... });
it('createOrder throws InsufficientStockError when stock is zero', async () => { ... });
it('formatDate returns "01/01/2024" given the ISO string "2024-01-01"', () => { ... });

// ❌ Incorrect — tells you nothing about the expected behaviour
it('works correctly', () => { ... });
it('test 1', () => { ... });
it('handles edge case', () => { ... });
it('should work', () => { ... });
```

> **Tip:** If you cannot complete the pattern, the unit itself may be doing too much. Consider splitting it.

### Nested `describe` — 3-Level Example

Use nesting to group by **method → scenario → edge case**.

```typescript
// user-service.test.ts
import { UserService } from './user-service';
import { buildUser } from '../../tests/fixtures/user.fixture';

describe('UserService', () => {
  let service: UserService;
  let mockRepo: ReturnType<typeof createMockUserRepository>;

  beforeEach(() => {
    mockRepo = createMockUserRepository();
    service = new UserService(mockRepo);
  });

  // ── Level 2: method ──────────────────────────────────────────
  describe('getUser', () => {

    // ── Level 3: scenario ────────────────────────────────────────
    describe('when the user exists', () => {
      it('getUser returns the user dto', async () => {
        const user = buildUser({ id: '42' });
        mockRepo.findById.mockResolvedValue(user);

        const result = await service.getUser('42');

        expect(result).toEqual({ id: '42', name: user.name, email: user.email });
      });

      it('getUser does not expose the passwordHash field', async () => {
        const user = buildUser({ id: '42' });
        mockRepo.findById.mockResolvedValue(user);

        const result = await service.getUser('42');

        expect(result).not.toHaveProperty('passwordHash');
      });
    });

    describe('when the user does not exist', () => {
      it('getUser returns null when user id does not exist', async () => {
        mockRepo.findById.mockResolvedValue(null);

        const result = await service.getUser('nonexistent');

        expect(result).toBeNull();
      });
    });

    describe('when the repository throws', () => {
      it('getUser propagates repository errors', async () => {
        mockRepo.findById.mockRejectedValue(new Error('DB connection lost'));

        await expect(service.getUser('42')).rejects.toThrow('DB connection lost');
      });
    });
  });

  describe('deleteUser', () => {
    describe('when the user exists', () => {
      it('deleteUser calls repository.delete with the correct id', async () => {
        mockRepo.findById.mockResolvedValue(buildUser({ id: '7' }));
        mockRepo.delete.mockResolvedValue(undefined);

        await service.deleteUser('7');

        expect(mockRepo.delete).toHaveBeenCalledOnce();
        expect(mockRepo.delete).toHaveBeenCalledWith('7');
      });
    });

    describe('when the user does not exist', () => {
      it('deleteUser throws NotFoundError when user does not exist', async () => {
        mockRepo.findById.mockResolvedValue(null);

        await expect(service.deleteUser('999')).rejects.toThrow('NotFoundError');
      });
    });
  });
});
```

### Vitest Test Modifiers

```typescript
// Run only this test during development (remove before committing)
it.only('focuses on a single case', () => { ... });

// Skip temporarily (always add a TODO comment explaining why)
it.skip('skipped because feature X is not yet implemented', () => { ... });

// Placeholder — marks a test you plan to write
it.todo('createUser sends a welcome email');

// Benchmark (Vitest-specific)
import { bench } from 'vitest';
bench('serialise 10k records', () => {
  JSON.stringify(records);
});
```

---

## Parallel Test Safety

### How Vitest Parallelises Work

- **Within a file:** tests run **sequentially** in declaration order.
- **Across files:** each file runs in its own **worker thread** in parallel.

This means shared mutable module-level state leaks across tests in the same file but **not** across files.

### Never Share Mutable State

```typescript
// ❌ Incorrect — shared mutable counter leaks across tests
let callCount = 0;

describe('Counter', () => {
  it('increments', () => {
    callCount++;
    expect(callCount).toBe(1); // passes in isolation, fails after other tests
  });
});

// ✅ Correct — reset in beforeEach
describe('Counter', () => {
  let callCount: number;

  beforeEach(() => {
    callCount = 0;          // fresh state for every test
  });

  it('Counter starts at zero', () => {
    expect(callCount).toBe(0);
  });

  it('Counter increments by one', () => {
    callCount++;
    expect(callCount).toBe(1);
  });
});
```

### Resetting State with `beforeEach` / `afterEach`

```typescript
import { vi, beforeEach, afterEach } from 'vitest';

describe('EmailService', () => {
  beforeEach(() => {
    // Reset all mocks before each test so spy call counts don't accumulate
    vi.resetAllMocks();
  });

  afterEach(() => {
    // Restore any spies created with vi.spyOn so other test files are unaffected
    vi.restoreAllMocks();
  });

  it('EmailService.send calls the transport once', async () => {
    const transportSpy = vi.spyOn(transport, 'send').mockResolvedValue(undefined);

    await emailService.send({ to: 'a@b.com', subject: 'Hi', body: 'Hello' });

    expect(transportSpy).toHaveBeenCalledOnce();
  });
});
```

> **`vi.resetAllMocks()` vs `vi.restoreAllMocks()`**
> - `resetAllMocks` — clears call history and return values; leaves the mock in place.
> - `restoreAllMocks` — additionally replaces the spy with the original implementation. Required when using `vi.spyOn` on real modules.

### `vi.mock` Hoisting Rules

Vitest (and Jest) **hoist** `vi.mock(...)` calls to the top of the file at compile time, before any imports. This means:

```typescript
// ✅ Correct — vi.mock is at the top; the mock is applied before the import resolves
import { vi } from 'vitest';

vi.mock('./email-transport', () => ({
  sendEmail: vi.fn(),
}));

import { sendEmail } from './email-transport'; // already mocked

// ❌ Incorrect — placing vi.mock inside a describe/it block does NOT work as expected
describe('broken', () => {
  vi.mock('./email-transport'); // hoisted, but the factory runs before the describe body
});
```

**Avoid cross-test pollution from `vi.mock`:**

```typescript
// The module mock is shared across all tests in the file.
// Use mockReset or mockReturnValue per-test to vary behaviour.

vi.mock('./config-loader', () => ({ loadConfig: vi.fn() }));

import { loadConfig } from './config-loader';

describe('AppBootstrap', () => {
  beforeEach(() => {
    vi.mocked(loadConfig).mockReset();
  });

  it('AppBootstrap starts when config loads successfully', async () => {
    vi.mocked(loadConfig).mockResolvedValue({ port: 3000 });
    // ...
  });

  it('AppBootstrap throws when config is missing', async () => {
    vi.mocked(loadConfig).mockRejectedValue(new Error('Config not found'));
    // ...
  });
});
```

### `beforeAll` / `afterAll` — Correct Usage

Use these for **expensive, immutable** shared resources, never for mutable state.

```typescript
// ✅ Correct — server starts once, tests are independent
describe('HealthCheck', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await TestServer.start();    // expensive — start once
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /health returns 200', async () => {
    const res = await fetch(`${server.url}/health`);
    expect(res.status).toBe(200);
  });
});

// ❌ Incorrect — shared mutable user object causes test ordering dependencies
describe('UserFlow', () => {
  let user: User;

  beforeAll(async () => {
    user = await userService.create({ email: 'test@test.com' });
  });

  it('updates user email', async () => {
    user.email = 'new@test.com';    // mutates shared state — breaks test isolation
    await userService.save(user);
    // ...
  });
});
```

### Deterministic Tests

**Fixed dates:**

```typescript
describe('BillingService', () => {
  beforeEach(() => {
    // Pin the system clock so date-based logic is deterministic
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();             // always restore after each test
  });

  it('BillingService generates an invoice dated today', () => {
    const invoice = billingService.generateInvoice(order);
    expect(invoice.date).toEqual(new Date('2024-06-15T12:00:00Z'));
  });
});
```

**Fixed random data:**

```typescript
import seedrandom from 'seedrandom';

beforeEach(() => {
  // Replace Math.random with a seeded PRNG so "random" output is reproducible
  const rng = seedrandom('fixed-seed-42');
  vi.spyOn(Math, 'random').mockImplementation(() => rng());
});

afterEach(() => {
  vi.restoreAllMocks();
});
```

---

## Mocking

### `vi.mock` — Mock an Entire Module

```typescript
// order-service.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';

// 1. Declare the mock at the top (hoisted automatically)
vi.mock('../payment-gateway', () => ({
  chargeCard: vi.fn(),
  refundCard: vi.fn(),
}));

// 2. Import the mocked module — safe to use vi.mocked() for type safety
import { chargeCard } from '../payment-gateway';
import { OrderService } from './order-service';

describe('OrderService', () => {
  let service: OrderService;

  beforeEach(() => {
    vi.mocked(chargeCard).mockReset();
    service = new OrderService();
  });

  it('OrderService.placeOrder charges the card once', async () => {
    vi.mocked(chargeCard).mockResolvedValue({ transactionId: 'txn_123' });

    await service.placeOrder({ amount: 99_00, cardToken: 'tok_test' });

    expect(chargeCard).toHaveBeenCalledOnce();
    expect(chargeCard).toHaveBeenCalledWith({ amount: 99_00, cardToken: 'tok_test' });
  });
});
```

### `vi.fn()` — Standalone Mock Function

```typescript
// Create a typed mock function from scratch
const mockSendEmail = vi.fn<[EmailPayload], Promise<void>>();

// Configure return values
mockSendEmail.mockResolvedValue(undefined);                     // always resolves
mockSendEmail.mockResolvedValueOnce(undefined);                 // resolves once, then uses default
mockSendEmail.mockRejectedValue(new Error('SMTP unavailable')); // always rejects

// Inspect calls
expect(mockSendEmail).toHaveBeenCalledTimes(1);
expect(mockSendEmail).toHaveBeenCalledWith(
  expect.objectContaining({ to: 'user@example.com' })
);

// Access raw call arguments
const [[firstCallArg]] = mockSendEmail.mock.calls;
expect(firstCallArg.subject).toBe('Welcome!');
```

### `vi.spyOn` — Spy on a Real Method

```typescript
import { logger } from '../utils/logger';

describe('ErrorHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks(); // put logger.error back to its real implementation
  });

  it('ErrorHandler logs the error message', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

    errorHandler(new Error('Oops'));

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Oops'));
  });
});
```

### Mocking a Class

```typescript
// Approach 1: Mock the module that exports the class
vi.mock('./stripe-client', () => {
  const StripeClient = vi.fn();
  StripeClient.prototype.charge = vi.fn().mockResolvedValue({ id: 'ch_1' });
  StripeClient.prototype.refund = vi.fn().mockResolvedValue({ id: 're_1' });
  return { StripeClient };
});

// Approach 2: Manual mock factory (preferred when class has complex types)
function createMockStripeClient(): jest.Mocked<StripeClient> {
  return {
    charge: vi.fn(),
    refund: vi.fn(),
  } as unknown as jest.Mocked<StripeClient>;
}
```

### Mocking a Specific Method on a Real Object

```typescript
const realFs = await import('node:fs/promises');

// Only mock readFile; all other methods remain real
const readFileSpy = vi
  .spyOn(realFs, 'readFile')
  .mockResolvedValue(Buffer.from('{"version": 1}'));

// ... test code ...

vi.restoreAllMocks(); // restore readFile to the real implementation
```

### Helper: `createMock<T>` Utility

For dependency-injected interfaces, a typed factory avoids `as unknown as T` casts everywhere:

```typescript
// tests/helpers/create-mock.ts
import { vi } from 'vitest';

type DeepMock<T> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? ReturnType<typeof vi.fn<A, R>>
    : T[K];
};

export function createMock<T>(overrides: Partial<DeepMock<T>> = {}): DeepMock<T> {
  return new Proxy(overrides as DeepMock<T>, {
    get(target, prop) {
      if (!(prop in target)) {
        (target as Record<string | symbol, unknown>)[prop] = vi.fn();
      }
      return (target as Record<string | symbol, unknown>)[prop];
    },
  });
}

// Usage
const mockRepo = createMock<UserRepository>();
mockRepo.findById.mockResolvedValue(buildUser());
```

---

## Assertion Patterns

### Reference Table

| Assertion | Use when |
|---|---|
| `toBe(x)` | Primitive equality (`===`). Do NOT use for objects. |
| `toEqual(x)` | Deep equality — ignores `undefined` properties. |
| `toStrictEqual(x)` | Deep equality — distinguishes `undefined` from absent keys; checks class instances. |
| `toBeTruthy()` | Value is truthy (not `null`, `undefined`, `0`, `''`, `false`). |
| `toBeFalsy()` | Value is falsy. |
| `toBeNull()` | Exactly `null`. |
| `toBeUndefined()` | Exactly `undefined`. |
| `toBeInstanceOf(Class)` | Value is an instance of Class. |
| `toContain(item)` | Array or string contains item. |
| `toHaveLength(n)` | Array or string has length n. |
| `toHaveProperty('a.b', v)` | Object has nested property with value. |
| `toThrow(msg?)` | Synchronous function throws (wrap in `() =>`). |
| `toMatchSnapshot()` | Output matches a stored snapshot (UI, serialised config). |
| `toMatchInlineSnapshot()` | Inline snapshot — kept in the test file for small outputs. |

### Examples

```typescript
// toBe — primitives only
expect(add(2, 3)).toBe(5);
expect(typeof result).toBe('string');

// toEqual — plain objects (undefined fields ignored)
expect(result).toEqual({ id: '1', name: 'Alice' });

// toStrictEqual — class instances or when undefined matters
expect(new Date('2024-01-01')).toStrictEqual(new Date('2024-01-01'));
expect({ a: undefined }).not.toEqual({});          // toEqual: passes (!)
expect({ a: undefined }).not.toStrictEqual({});    // toStrictEqual: passes ✅

// toThrow — must wrap the call
expect(() => divide(1, 0)).toThrow('Division by zero');
expect(() => divide(1, 0)).toThrow(DivisionError);

// toMatchSnapshot — stable serialisable output
it('formatReport returns the expected markdown', () => {
  const output = formatReport(data);
  expect(output).toMatchSnapshot();
});

// toMatchInlineSnapshot — small, self-contained
it('serializeUser produces compact JSON', () => {
  expect(serializeUser({ id: '1', name: 'Alice' })).toMatchInlineSnapshot(`
    "{"id":"1","name":"Alice"}"
  `);
});
```

---

## Async Testing

### Promises — `resolves` / `rejects`

Always `await` the assertion to ensure the test actually waits for the promise.

```typescript
// ✅ Correct — await the entire assertion chain
it('fetchUser resolves with user data when id is valid', async () => {
  await expect(fetchUser('42')).resolves.toEqual({
    id: '42',
    name: 'Alice',
  });
});

it('fetchUser rejects with NotFoundError when id is missing', async () => {
  await expect(fetchUser('')).rejects.toThrow('NotFoundError');
  await expect(fetchUser('')).rejects.toBeInstanceOf(NotFoundError);
});

// ❌ Incorrect — without await, the test passes even if the promise rejects
it('broken async test', () => {
  expect(fetchUser('42')).resolves.toEqual({ id: '42' }); // missing await!
});
```

### `async / await` Style

```typescript
it('createUser saves and returns the new user', async () => {
  mockRepo.save.mockResolvedValue(buildUser({ id: 'new-1' }));

  const result = await userService.createUser({ name: 'Bob', email: 'bob@test.com' });

  expect(result.id).toBe('new-1');
  expect(mockRepo.save).toHaveBeenCalledOnce();
});
```

### Testing Callbacks with `vi.fn()` and `done`

For callback-style APIs (legacy or Node streams) use a Promise wrapper:

```typescript
it('EventEmitter emits "ready" after init', () =>
  new Promise<void>((resolve, reject) => {
    const emitter = new MyEmitter();

    emitter.on('ready', () => resolve());
    emitter.on('error', reject);

    emitter.init();
  })
);
```

### Timers and Debounce

```typescript
it('debounceSearch only calls search once after 300 ms of inactivity', async () => {
  vi.useFakeTimers();
  const search = vi.fn();
  const debounced = debounce(search, 300);

  debounced('a');
  debounced('ab');
  debounced('abc');

  // no calls yet
  expect(search).not.toHaveBeenCalled();

  vi.advanceTimersByTime(300);

  expect(search).toHaveBeenCalledOnce();
  expect(search).toHaveBeenCalledWith('abc');

  vi.useRealTimers();
});
```

---

## Coverage Targets

### Thresholds

| Layer | Line Coverage Target | Rationale |
|---|---|---|
| Critical business logic (payments, auth, billing) | **100%** | Bugs here have financial / security impact |
| Domain services | **90%** | Core application behaviour |
| General application code | **80%** | Team-wide baseline |
| Infrastructure / adapters | **70%** | Difficult to test exhaustively |
| Generated code, migrations | Excluded | Not hand-written |

### Vitest Coverage Configuration

```typescript
// vitest.config.ts
coverage: {
  provider: 'v8',
  reporter: ['text', 'lcov', 'html'],
  include: ['src/**/*.ts'],
  exclude: [
    'src/**/*.test.ts',
    'src/**/*.spec.ts',
    'src/**/*.d.ts',
    'src/**/index.ts',        // barrel files — no logic
    'src/migrations/**',
    'src/generated/**',
  ],
  thresholds: {
    lines: 80,
    functions: 80,
    branches: 75,
    statements: 80,
    // Per-file overrides for critical modules
    'src/billing/**': {
      lines: 100,
      functions: 100,
      branches: 100,
    },
  },
},
```

**Run coverage locally:**

```bash
# Vitest
npx vitest run --coverage

# Jest
npx jest --coverage --coverageProvider=v8
```

**CI enforcement:** Vitest will exit with a non-zero code if any threshold is not met — use this in CI to fail the build.

### Coverage Is a Metric, Not a Goal

> High coverage ≠ good tests. A test that calls every line without asserting anything gives 100% coverage and zero confidence. Write tests that verify **behaviour**, not tests that chase coverage numbers.

---

## Table-Driven Tests

Use `it.each` to express the same assertion over many input/output pairs without duplicating code.

### Typed Array Syntax (preferred)

```typescript
import { describe, it, expect } from 'vitest';
import { formatCurrency } from './format-currency';

interface FormatCurrencyCase {
  description: string;
  amount: number;
  currency: string;
  locale: string;
  expected: string;
}

const cases: FormatCurrencyCase[] = [
  {
    description: 'formats USD in en-US locale',
    amount: 1000,
    currency: 'USD',
    locale: 'en-US',
    expected: '$1,000.00',
  },
  {
    description: 'formats EUR in de-DE locale',
    amount: 1000,
    currency: 'EUR',
    locale: 'de-DE',
    expected: '1.000,00 €',
  },
  {
    description: 'formats zero correctly',
    amount: 0,
    currency: 'GBP',
    locale: 'en-GB',
    expected: '£0.00',
  },
  {
    description: 'formats negative amounts',
    amount: -250,
    currency: 'USD',
    locale: 'en-US',
    expected: '-$250.00',
  },
];

describe('formatCurrency', () => {
  it.each(cases)(
    'formatCurrency $description',
    ({ amount, currency, locale, expected }) => {
      const result = formatCurrency(amount, { currency, locale });
      expect(result).toBe(expected);
    }
  );
});
```

### Template Literal Syntax (compact)

```typescript
describe('add', () => {
  it.each([
    [1, 2, 3],
    [0, 0, 0],
    [-1, 1, 0],
    [Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER + 1],
  ])('add(%i, %i) returns %i', (a, b, expected) => {
    expect(add(a, b)).toBe(expected);
  });
});
```

### Table with Error Cases

```typescript
interface ValidationCase {
  description: string;
  input: string;
  shouldThrow: boolean;
  errorMessage?: string;
}

const validationCases: ValidationCase[] = [
  { description: 'valid email', input: 'user@example.com', shouldThrow: false },
  { description: 'missing @', input: 'notanemail', shouldThrow: true, errorMessage: 'Invalid email' },
  { description: 'empty string', input: '', shouldThrow: true, errorMessage: 'Email is required' },
  { description: 'local part too long', input: `${'a'.repeat(65)}@b.com`, shouldThrow: true, errorMessage: 'Invalid email' },
];

describe('validateEmail', () => {
  it.each(validationCases)(
    'validateEmail $description',
    ({ input, shouldThrow, errorMessage }) => {
      if (shouldThrow) {
        expect(() => validateEmail(input)).toThrow(errorMessage);
      } else {
        expect(() => validateEmail(input)).not.toThrow();
      }
    }
  );
});
```

---

## Testing Pure Functions vs. Classes with Dependencies

### Pure Functions

Pure functions are the easiest to test: no mocks needed, just inputs and outputs.

```typescript
// src/utils/slug.ts
export function toSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// src/utils/slug.test.ts
describe('toSlug', () => {
  it.each([
    ['Hello World', 'hello-world'],
    ['  Leading spaces  ', 'leading-spaces'],
    ['Special! @#Chars$', 'special-chars'],
    ['multiple---dashes', 'multiple-dashes'],
    ['', ''],
  ])('toSlug converts %s to %s', (input, expected) => {
    expect(toSlug(input)).toBe(expected);
  });
});
```

### Classes with Constructor-Injected Dependencies

Inject mocks via the constructor — the cleanest pattern for testability.

```typescript
// src/notifications/notification-service.ts
export class NotificationService {
  constructor(
    private readonly emailClient: EmailClient,
    private readonly smsClient: SmsClient,
    private readonly logger: Logger
  ) {}

  async notifyUser(userId: string, message: string): Promise<void> {
    const user = await this.emailClient.getUser(userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    await this.emailClient.send({ to: user.email, body: message });

    if (user.phoneNumber) {
      await this.smsClient.send({ to: user.phoneNumber, body: message });
    }

    this.logger.info(`Notified user ${userId}`);
  }
}

// src/notifications/notification-service.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { NotificationService } from './notification-service';
import { NotFoundError } from '../errors';
import { buildUser } from '../../tests/fixtures/user.fixture';

// Typed mock factories — no casting required
function createMockEmailClient() {
  return {
    getUser: vi.fn<[string], Promise<User | null>>(),
    send: vi.fn<[EmailPayload], Promise<void>>(),
  };
}

function createMockSmsClient() {
  return {
    send: vi.fn<[SmsPayload], Promise<void>>(),
  };
}

function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

describe('NotificationService', () => {
  let service: NotificationService;
  let emailClient: ReturnType<typeof createMockEmailClient>;
  let smsClient: ReturnType<typeof createMockSmsClient>;
  let logger: ReturnType<typeof createMockLogger>;

  beforeEach(() => {
    emailClient = createMockEmailClient();
    smsClient = createMockSmsClient();
    logger = createMockLogger();
    service = new NotificationService(emailClient, smsClient, logger);
  });

  describe('notifyUser', () => {
    describe('when the user exists and has a phone number', () => {
      it('notifyUser sends email and SMS', async () => {
        const user = buildUser({ id: '1', phoneNumber: '+447700900000' });
        emailClient.getUser.mockResolvedValue(user);
        emailClient.send.mockResolvedValue(undefined);
        smsClient.send.mockResolvedValue(undefined);

        await service.notifyUser('1', 'Hello!');

        expect(emailClient.send).toHaveBeenCalledOnce();
        expect(smsClient.send).toHaveBeenCalledOnce();
        expect(logger.info).toHaveBeenCalledWith('Notified user 1');
      });
    });

    describe('when the user has no phone number', () => {
      it('notifyUser sends email only', async () => {
        const user = buildUser({ id: '2', phoneNumber: undefined });
        emailClient.getUser.mockResolvedValue(user);
        emailClient.send.mockResolvedValue(undefined);

        await service.notifyUser('2', 'Hello!');

        expect(emailClient.send).toHaveBeenCalledOnce();
        expect(smsClient.send).not.toHaveBeenCalled();
      });
    });

    describe('when the user does not exist', () => {
      it('notifyUser throws NotFoundError', async () => {
        emailClient.getUser.mockResolvedValue(null);

        await expect(service.notifyUser('missing', 'Hi')).rejects.toThrow(NotFoundError);
        expect(emailClient.send).not.toHaveBeenCalled();
        expect(smsClient.send).not.toHaveBeenCalled();
      });
    });

    describe('when the email client throws', () => {
      it('notifyUser propagates the error and does not call SMS', async () => {
        const user = buildUser({ id: '3', phoneNumber: '+1234567890' });
        emailClient.getUser.mockResolvedValue(user);
        emailClient.send.mockRejectedValue(new Error('SMTP timeout'));

        await expect(service.notifyUser('3', 'Hello!')).rejects.toThrow('SMTP timeout');
        expect(smsClient.send).not.toHaveBeenCalled();
      });
    });
  });
});
```

### Key Principles for Testable Class Design

```typescript
// ✅ Correct — dependency injection; easy to mock
class PaymentService {
  constructor(private readonly stripe: StripeClient) {}
}
const service = new PaymentService(mockStripe);

// ❌ Incorrect — hard-coded dependency; impossible to mock without module-level hacks
class PaymentService {
  private stripe = new StripeClient(process.env.STRIPE_KEY!);
}
```

---

## Quick-Reference Checklist

Before merging a test file, verify:

- [ ] Test file co-located with source or in `__tests__/` (consistent with project convention)
- [ ] `describe` block names the unit under test exactly
- [ ] Every `it` name follows `[subject] [condition] [expected outcome]`
- [ ] No generic names (`"works"`, `"test 1"`, `"handles it"`)
- [ ] All mocks are reset in `beforeEach` (`vi.resetAllMocks()`)
- [ ] All spies are restored in `afterEach` (`vi.restoreAllMocks()`)
- [ ] No mutable state shared between `it` blocks without a `beforeEach` reset
- [ ] `vi.setSystemTime` paired with `vi.useRealTimers()` in `afterEach`
- [ ] Async tests all `await` their assertion chain
- [ ] Coverage thresholds configured and CI enforced
- [ ] Table-driven tests used where the same assertion runs over many inputs
- [ ] No `.only` left in committed code

---

*This document is part of the TypeScript Guidelines series. See also:*
- *01 – Project Structure & Module Organisation*
- *02 – TypeScript Configuration & Strict Mode*
- *03 – Error Handling*
- *05 – Integration & E2E Testing*
