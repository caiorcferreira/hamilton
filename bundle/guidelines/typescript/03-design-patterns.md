# TypeScript Guidelines – 03 Design Patterns

This document covers the most important design patterns used in modern TypeScript codebases. Each section follows a consistent structure: **motivation → type/interface definition → implementation → usage example → testing note**.

---

## Table of Contents

1. [Decorator Pattern](#decorator-pattern)
2. [Chain of Responsibility](#chain-of-responsibility)
3. [Strategy Pattern](#strategy-pattern)
4. [Functional Design Patterns](#functional-design-patterns)

---

## Decorator Pattern

### Motivation

The Decorator pattern attaches new responsibilities to an object dynamically. In TypeScript, this manifests in three distinct flavours that address different contexts:

1. **Classical OOP decorator** – a class that wraps another class implementing the same interface.
2. **TypeScript 5.x language decorators** – metadata annotations on classes, methods, and properties.
3. **Functional higher-order functions (HOF)** – composable wrappers around plain functions.

Choose the right flavour for the right context. Mixing them in a single codebase leads to confusion.

---

### Classical OOP Decorator (Class-Based Wrapper)

Define a shared interface, then build concrete and decorator implementations around it.

```typescript
// ── Shared interface ──────────────────────────────────────────────────────────
interface DataService {
  fetchUser(id: string): Promise<User>;
  saveUser(user: User): Promise<void>;
}

interface User {
  id: string;
  name: string;
  email: string;
}

// ── Concrete implementation ───────────────────────────────────────────────────
class UserDataService implements DataService {
  async fetchUser(id: string): Promise<User> {
    // Actual DB/API call
    return { id, name: 'Alice', email: 'alice@example.com' };
  }

  async saveUser(user: User): Promise<void> {
    // Actual persistence logic
    console.log(`Saving user ${user.id}`);
  }
}

// ── Logger decorator ──────────────────────────────────────────────────────────
class LoggerDataService implements DataService {
  constructor(private readonly inner: DataService) {}

  async fetchUser(id: string): Promise<User> {
    console.log(`[LOG] fetchUser called with id=${id}`);
    const start = Date.now();
    try {
      const result = await this.inner.fetchUser(id);
      console.log(`[LOG] fetchUser completed in ${Date.now() - start}ms`);
      return result;
    } catch (err) {
      console.error(`[LOG] fetchUser failed:`, err);
      throw err;
    }
  }

  async saveUser(user: User): Promise<void> {
    console.log(`[LOG] saveUser called for user=${user.id}`);
    await this.inner.saveUser(user);
    console.log(`[LOG] saveUser completed`);
  }
}

// ── Usage ─────────────────────────────────────────────────────────────────────
const service: DataService = new LoggerDataService(new UserDataService());
await service.fetchUser('42');
```

> **Key rule:** The decorator must implement the **same interface** as the wrapped class, ensuring full substitutability (Liskov Substitution Principle).

---

### TypeScript 5.x Decorator Syntax

TypeScript ships two decorator systems. Understanding both prevents painful migration surprises.

#### `experimentalDecorators` (legacy, Stage-1 proposal)

```json
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

```typescript
// Legacy method decorator (TypeScript < 5 style)
function Log(
  target: Object,
  propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const original = descriptor.value as (...args: unknown[]) => unknown;
  descriptor.value = function (...args: unknown[]) {
    console.log(`Calling ${propertyKey} with`, args);
    const result = original.apply(this, args);
    console.log(`${propertyKey} returned`, result);
    return result;
  };
  return descriptor;
}

class ReportService {
  @Log
  generate(reportId: string): string {
    return `Report-${reportId}`;
  }
}
```

#### Standard Decorators (Stage-3, TypeScript 5.0+)

```json
// tsconfig.json — no experimentalDecorators needed
{
  "compilerOptions": {
    "target": "ES2022"
  }
}
```

```typescript
// Standard method decorator (TypeScript 5.x)
function log<This, Args extends unknown[], Return>(
  target: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, typeof target>
): (this: This, ...args: Args) => Return {
  const methodName = String(context.name);
  return function (this: This, ...args: Args): Return {
    console.log(`[${methodName}] called with`, args);
    const result = target.call(this, ...args);
    console.log(`[${methodName}] returned`, result);
    return result;
  };
}

class AnalyticsService {
  @log
  trackEvent(event: string, payload: Record<string, unknown>): void {
    // implementation
  }
}
```

#### When to Use Which

| Scenario | Recommendation |
|---|---|
| NestJS, TypeORM, Angular, Inversify | `experimentalDecorators: true` – these frameworks depend on metadata reflection |
| New standalone library / application | Stage-3 standard decorators (no flag needed in TS 5+) |
| Pure business logic transformations | Functional HOF decorators (no decorator syntax at all) |
| Metadata-heavy DI containers | `experimentalDecorators` + `reflect-metadata` |

---

### Functional Higher-Order Function Decorators

HOF decorators wrap plain functions and return enhanced functions with the same signature. They compose cleanly without classes.

```typescript
// ── Type alias for async functions ────────────────────────────────────────────
type AsyncFn<TArgs extends unknown[], TReturn> = (...args: TArgs) => Promise<TReturn>;

// ── withLogging ───────────────────────────────────────────────────────────────
function withLogging<TArgs extends unknown[], TReturn>(
  fn: AsyncFn<TArgs, TReturn>,
  label?: string
): AsyncFn<TArgs, TReturn> {
  const name = label ?? fn.name ?? 'anonymous';
  return async (...args: TArgs): Promise<TReturn> => {
    console.log(`[${name}] called with`, args);
    const start = Date.now();
    const result = await fn(...args);
    console.log(`[${name}] completed in ${Date.now() - start}ms`);
    return result;
  };
}

// ── withRetry ─────────────────────────────────────────────────────────────────
function withRetry<TArgs extends unknown[], TReturn>(
  maxAttempts: number,
  delayMs = 200
): (fn: AsyncFn<TArgs, TReturn>) => AsyncFn<TArgs, TReturn> {
  return (fn) => async (...args: TArgs): Promise<TReturn> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn(...args);
      } catch (err) {
        lastError = err;
        console.warn(`Attempt ${attempt}/${maxAttempts} failed, retrying in ${delayMs}ms`);
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, delayMs * attempt));
        }
      }
    }
    throw lastError;
  };
}

// ── withCache ─────────────────────────────────────────────────────────────────
function withCache<TArgs extends unknown[], TReturn>(
  ttlSeconds: number
): (fn: AsyncFn<TArgs, TReturn>) => AsyncFn<TArgs, TReturn> {
  const cache = new Map<string, { value: TReturn; expiresAt: number }>();

  return (fn) => async (...args: TArgs): Promise<TReturn> => {
    const key = JSON.stringify(args);
    const cached = cache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      console.log(`[cache] HIT for key ${key}`);
      return cached.value;
    }

    const value = await fn(...args);
    cache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    return value;
  };
}
```

---

### `pipe` Utility for Composing Decorators Left-to-Right

```typescript
// ── pipe: applies transforms left to right ────────────────────────────────────
function pipe<T>(...fns: Array<(arg: T) => T>): (arg: T) => T {
  return (arg: T) => fns.reduce((acc, fn) => fn(acc), arg);
}

// ── Base function ─────────────────────────────────────────────────────────────
async function fetchUser(id: string): Promise<User> {
  const resp = await fetch(`/api/users/${id}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json() as Promise<User>;
}

// ── Compose decorators ────────────────────────────────────────────────────────
const enhancedFetchUser = pipe<AsyncFn<[string], User>>(
  (fn) => withLogging(fn, 'fetchUser'),
  withRetry<[string], User>(3),
  withCache<[string], User>(60)
)(fetchUser);

// ── Usage ─────────────────────────────────────────────────────────────────────
const user = await enhancedFetchUser('42');
// Logs → retries up to 3 times → caches for 60 s
```

**Flow diagram:**

```
fetchUser
    │
    ▼
withLogging(fetchUser)          ← wraps first
    │
    ▼
withRetry(3)(loggedFn)          ← wraps second
    │
    ▼
withCache(60)(retryingFn)       ← wraps last (outermost)
    │
    ▼
enhancedFetchUser('42')  ──►  cache check ──► retry loop ──► log ──► real fetch
```

---

### When to Use Class Decorators vs Function Composition

| Criterion | Class decorators | Function composition |
|---|---|---|
| Framework integration | ✅ NestJS, TypeORM, Angular DI | ❌ Not applicable |
| Dependency injection metadata | ✅ Requires `reflect-metadata` | ❌ Not applicable |
| Pure business logic | ❌ Overkill, adds coupling | ✅ Clean and testable |
| Tree-shaking / bundle size | ❌ Decorators import heavier runtimes | ✅ Just functions |
| Composability | ⚠️ Fixed at class definition | ✅ Dynamic, runtime composable |
| Type safety | ⚠️ Depends on TS version | ✅ Full inference |

---

### Testing Decorators

Because each HOF decorator is just a function that accepts a function and returns a function, they are trivially testable in isolation.

```typescript
describe('withRetry', () => {
  it('retries on failure and resolves on success', async () => {
    let calls = 0;
    const unstable = jest.fn(async () => {
      calls++;
      if (calls < 3) throw new Error('transient failure');
      return 'ok';
    });

    const resilient = withRetry<[], string>(3)(unstable);
    const result = await resilient();

    expect(result).toBe('ok');
    expect(unstable).toHaveBeenCalledTimes(3);
  });

  it('throws after max attempts', async () => {
    const alwaysFails = jest.fn(async () => { throw new Error('permanent'); });
    const resilient = withRetry<[], never>(2, 0)(alwaysFails);

    await expect(resilient()).rejects.toThrow('permanent');
    expect(alwaysFails).toHaveBeenCalledTimes(2);
  });
});

describe('withCache', () => {
  it('calls the underlying function only once per TTL window', async () => {
    const expensive = jest.fn(async (id: string) => ({ id }));
    const cached = withCache<[string], { id: string }>(60)(expensive);

    await cached('a');
    await cached('a');
    await cached('b');

    expect(expensive).toHaveBeenCalledTimes(2); // 'b' is a cache miss
  });
});
```

---

## Chain of Responsibility

### Motivation

Chain of Responsibility passes a request along a chain of handlers. Each handler decides whether to handle the request, enrich it, or pass it to the next handler. This pattern is ideal for:

- HTTP request pipelines (auth → rate-limit → validation → handler)
- Input validation pipelines
- Event processing with optional short-circuiting

```
 Request
    │
    ▼
┌──────────────┐   pass   ┌──────────────────┐   pass   ┌──────────────────────┐
│ AuthHandler  │ ───────► │ RateLimitHandler │ ───────► │ BusinessLogicHandler │
└──────────────┘          └──────────────────┘          └──────────────────────┘
    │ reject                   │ reject                       │ handle
    ▼                          ▼                              ▼
  401 Error              429 Error                       Response
```

---

### Classic OOP Implementation

```typescript
// ── Request type ──────────────────────────────────────────────────────────────
interface HttpRequest {
  userId?: string;
  token?: string;
  ip: string;
  path: string;
  body: unknown;
}

interface HttpResponse {
  status: number;
  body: unknown;
}

// ── Abstract handler ──────────────────────────────────────────────────────────
abstract class Handler {
  private nextHandler: Handler | null = null;

  setNext(handler: Handler): Handler {
    this.nextHandler = handler;
    return handler; // allows chaining: a.setNext(b).setNext(c)
  }

  protected passToNext(request: HttpRequest): HttpResponse {
    if (this.nextHandler) {
      return this.nextHandler.handle(request);
    }
    // Default terminal response if no handler claimed the request
    return { status: 404, body: { error: 'No handler found' } };
  }

  abstract handle(request: HttpRequest): HttpResponse;
}

// ── Concrete handlers ─────────────────────────────────────────────────────────
class AuthHandler extends Handler {
  private readonly validTokens = new Set(['tok-abc', 'tok-def']);

  handle(request: HttpRequest): HttpResponse {
    if (!request.token || !this.validTokens.has(request.token)) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }
    // Enrich the request with the resolved userId
    request.userId = `user-from-${request.token}`;
    return this.passToNext(request);
  }
}

class RateLimitHandler extends Handler {
  private readonly counts = new Map<string, number>();
  private readonly limit = 100;

  handle(request: HttpRequest): HttpResponse {
    const count = (this.counts.get(request.ip) ?? 0) + 1;
    this.counts.set(request.ip, count);

    if (count > this.limit) {
      return { status: 429, body: { error: 'Too Many Requests' } };
    }
    return this.passToNext(request);
  }
}

class BusinessLogicHandler extends Handler {
  handle(request: HttpRequest): HttpResponse {
    return {
      status: 200,
      body: { message: `Processed for user ${request.userId}` },
    };
  }
}

// ── Chain assembly ────────────────────────────────────────────────────────────
const auth = new AuthHandler();
const rateLimit = new RateLimitHandler();
const business = new BusinessLogicHandler();

auth.setNext(rateLimit).setNext(business);

// ── Usage ─────────────────────────────────────────────────────────────────────
const response = auth.handle({ token: 'tok-abc', ip: '1.2.3.4', path: '/api', body: {} });
console.log(response); // { status: 200, body: { message: 'Processed for user user-from-tok-abc' } }
```

---

### Functional / Middleware Implementation

The functional approach models each step as a **middleware** function and composes them with a `compose` helper. This is the pattern used by Koa, tRPC, and many modern TypeScript frameworks.

```typescript
// ── Types ─────────────────────────────────────────────────────────────────────
interface Context {
  request: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: unknown;
  };
  response: {
    status: number;
    body: unknown;
  };
  // Handlers can attach arbitrary data to ctx
  [key: string]: unknown;
}

type Middleware = (ctx: Context, next: () => Promise<void>) => Promise<void>;

// ── compose: builds a chain from an array of middleware ───────────────────────
function compose(...middlewares: Middleware[]): Middleware {
  return async (ctx: Context, next: () => Promise<void>): Promise<void> => {
    let index = -1;

    async function dispatch(i: number): Promise<void> {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;

      const fn = i < middlewares.length ? middlewares[i] : next;
      await fn(ctx, () => dispatch(i + 1));
    }

    return dispatch(0);
  };
}

// ── Middleware implementations ────────────────────────────────────────────────
const authMiddleware: Middleware = async (ctx, next) => {
  const token = ctx.request.headers['authorization'];
  if (!token) {
    ctx.response = { status: 401, body: { error: 'Missing token' } };
    return; // short-circuit: do NOT call next()
  }
  ctx.userId = `user-from-${token}`;
  await next();
};

const loggingMiddleware: Middleware = async (ctx, next) => {
  const start = Date.now();
  console.log(`→ ${ctx.request.method} ${ctx.request.path}`);
  await next();
  console.log(`← ${ctx.response.status} in ${Date.now() - start}ms`);
};

const errorMiddleware: Middleware = async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    console.error('Unhandled error:', err);
    ctx.response = { status: 500, body: { error: 'Internal Server Error' } };
  }
};

const businessMiddleware: Middleware = async (ctx, _next) => {
  ctx.response = { status: 200, body: { message: `Hello, ${ctx.userId}` } };
};

// ── Compose and run ───────────────────────────────────────────────────────────
const pipeline = compose(
  errorMiddleware,
  loggingMiddleware,
  authMiddleware,
  businessMiddleware
);

const ctx: Context = {
  request: { method: 'GET', path: '/api/hello', headers: { authorization: 'tok-abc' }, body: null },
  response: { status: 0, body: null },
};

await pipeline(ctx, async () => { /* terminal no-op */ });
console.log(ctx.response); // { status: 200, body: { message: 'Hello, user-from-tok-abc' } }
```

---

### Type-Safe Generic Chain

Use generics so the context can be progressively narrowed as it flows through handlers.

```typescript
// ── Typed pipeline ────────────────────────────────────────────────────────────
interface BaseCtx {
  ip: string;
}

interface AuthCtx extends BaseCtx {
  userId: string;
}

interface ValidatedCtx extends AuthCtx {
  body: { name: string; age: number };
}

// Each handler receives the enriched type from previous handlers
type TypedHandler<TIn, TOut extends TIn> = (
  ctx: TIn,
  next: (enriched: TOut) => Promise<void>
) => Promise<void>;

// Usage pattern (simplified): handlers narrow the type as they pass context forward.
// This prevents downstream handlers from accessing fields that haven't been set yet.
```

---

### When to Use Chain of Responsibility

✅ **Good fits:**
- HTTP middleware (Express, Koa, Hono, Fastify plugins)
- Input validation pipelines where steps are conditional
- Event processing with optional logging/metrics injection
- Plugin systems where the chain can be extended without modifying existing code

❌ **Pitfalls:**

```typescript
// ── Pitfall 1: Forgetting to call next() ──────────────────────────────────────
const brokenMiddleware: Middleware = async (ctx, next) => {
  ctx.userId = 'x';
  // BUG: next() never called → downstream middleware never runs
};

// ── Pitfall 2: Order dependency ────────────────────────────────────────────────
// This breaks because businessMiddleware accesses ctx.userId set by authMiddleware
const wrongOrder = compose(businessMiddleware, authMiddleware); // ctx.userId is undefined

// ── Pitfall 3: Calling next() twice ───────────────────────────────────────────
const doubleNext: Middleware = async (ctx, next) => {
  await next();
  await next(); // Error thrown by compose: "next() called multiple times"
};
```

---

### Testing Chain of Responsibility

```typescript
describe('authMiddleware', () => {
  it('short-circuits with 401 when no token provided', async () => {
    const next = jest.fn();
    const ctx: Context = {
      request: { method: 'GET', path: '/', headers: {}, body: null },
      response: { status: 0, body: null },
    };

    await authMiddleware(ctx, next);

    expect(ctx.response.status).toBe(401);
    expect(next).not.toHaveBeenCalled(); // next must NOT be called
  });

  it('calls next() and sets userId when token is valid', async () => {
    const next = jest.fn().mockResolvedValue(undefined);
    const ctx: Context = {
      request: { method: 'GET', path: '/', headers: { authorization: 'tok-abc' }, body: null },
      response: { status: 0, body: null },
    };

    await authMiddleware(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(ctx.userId).toBe('user-from-tok-abc');
  });
});
```

---

## Strategy Pattern

### Motivation

The Strategy pattern defines a family of algorithms, encapsulates each one, and makes them interchangeable. The client code depends on the interface, not the concrete algorithm. This enables:

- Selecting algorithms at runtime from config or environment
- Independent testing of each algorithm
- Adding new strategies without touching existing code (Open/Closed Principle)

---

### Classic OOP: Sorting Strategies

```typescript
// ── Strategy interface ────────────────────────────────────────────────────────
interface SortStrategy<T> {
  sort(data: T[]): T[];
  readonly name: string;
}

// ── Concrete strategies ───────────────────────────────────────────────────────
class BubbleSort<T> implements SortStrategy<T> {
  readonly name = 'bubble';

  sort(data: T[]): T[] {
    const arr = [...data]; // never mutate the input
    for (let i = 0; i < arr.length; i++) {
      for (let j = 0; j < arr.length - i - 1; j++) {
        if (arr[j] > arr[j + 1]) {
          [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
        }
      }
    }
    return arr;
  }
}

class QuickSort<T> implements SortStrategy<T> {
  readonly name = 'quick';

  sort(data: T[]): T[] {
    if (data.length <= 1) return data;
    const [pivot, ...rest] = data;
    const left = rest.filter((x) => x <= pivot);
    const right = rest.filter((x) => x > pivot);
    return [...this.sort(left), pivot, ...this.sort(right)];
  }
}

class MergeSort<T> implements SortStrategy<T> {
  readonly name = 'merge';

  sort(data: T[]): T[] {
    if (data.length <= 1) return data;
    const mid = Math.floor(data.length / 2);
    return this.merge(this.sort(data.slice(0, mid)), this.sort(data.slice(mid)));
  }

  private merge(left: T[], right: T[]): T[] {
    const result: T[] = [];
    let l = 0; let r = 0;
    while (l < left.length && r < right.length) {
      result.push(left[l] <= right[r] ? left[l++] : right[r++]);
    }
    return [...result, ...left.slice(l), ...right.slice(r)];
  }
}

// ── Context class (Sorter) ────────────────────────────────────────────────────
class Sorter<T> {
  private strategy: SortStrategy<T>;

  constructor(strategy: SortStrategy<T>) {
    this.strategy = strategy;
  }

  setStrategy(strategy: SortStrategy<T>): void {
    this.strategy = strategy;
  }

  sort(data: T[]): T[] {
    console.log(`Sorting with ${this.strategy.name} strategy`);
    return this.strategy.sort(data);
  }
}

// ── Usage ─────────────────────────────────────────────────────────────────────
const sorter = new Sorter(new QuickSort<number>());
sorter.sort([5, 3, 8, 1, 9]); // → [1, 3, 5, 8, 9]

sorter.setStrategy(new MergeSort<number>());
sorter.sort([5, 3, 8, 1, 9]); // same result, different algorithm
```

---

### Functional Approach: Strategy Registry

```typescript
// ── Functional strategy: plain function type ──────────────────────────────────
type SortFn<T> = (data: T[]) => T[];

const sortStrategies: Record<string, SortFn<number>> = {
  bubble: (data) => {
    const arr = [...data];
    for (let i = 0; i < arr.length; i++)
      for (let j = 0; j < arr.length - i - 1; j++)
        if (arr[j] > arr[j + 1]) [arr[j], arr[j + 1]] = [arr[j + 1], arr[j]];
    return arr;
  },
  quick: (data) => {
    if (data.length <= 1) return data;
    const [p, ...r] = data;
    return [...sortStrategies.quick(r.filter(x => x <= p)), p, ...sortStrategies.quick(r.filter(x => x > p))];
  },
  native: (data) => [...data].sort((a, b) => a - b),
};

// ── Runtime selection ─────────────────────────────────────────────────────────
function sortWith(strategyName: string, data: number[]): number[] {
  const fn = sortStrategies[strategyName];
  if (!fn) throw new Error(`Unknown sort strategy: ${strategyName}`);
  return fn(data);
}

sortWith(process.env.SORT_STRATEGY ?? 'native', [5, 3, 1, 8]);
```

---

### Payment Processing Example (OOP + Functional)

```typescript
// ── OOP variant ───────────────────────────────────────────────────────────────
interface PaymentStrategy {
  charge(amount: number, currency: string): Promise<PaymentResult>;
  refund(transactionId: string): Promise<void>;
}

interface PaymentResult {
  transactionId: string;
  status: 'success' | 'failed';
  provider: string;
}

class StripeStrategy implements PaymentStrategy {
  async charge(amount: number, currency: string): Promise<PaymentResult> {
    // Stripe-specific API call
    return { transactionId: `stripe-${Date.now()}`, status: 'success', provider: 'stripe' };
  }
  async refund(transactionId: string): Promise<void> {
    console.log(`Stripe refund for ${transactionId}`);
  }
}

class PayPalStrategy implements PaymentStrategy {
  async charge(amount: number, currency: string): Promise<PaymentResult> {
    return { transactionId: `pp-${Date.now()}`, status: 'success', provider: 'paypal' };
  }
  async refund(transactionId: string): Promise<void> {
    console.log(`PayPal refund for ${transactionId}`);
  }
}

class CryptoStrategy implements PaymentStrategy {
  async charge(amount: number, currency: string): Promise<PaymentResult> {
    return { transactionId: `crypto-${Date.now()}`, status: 'success', provider: 'crypto' };
  }
  async refund(_transactionId: string): Promise<void> {
    throw new Error('Crypto payments are non-refundable');
  }
}

class PaymentProcessor {
  constructor(private strategy: PaymentStrategy) {}

  setStrategy(strategy: PaymentStrategy): void {
    this.strategy = strategy;
  }

  async processPayment(amount: number, currency = 'USD'): Promise<PaymentResult> {
    if (amount <= 0) throw new Error('Amount must be positive');
    return this.strategy.charge(amount, currency);
  }
}

// ── Functional variant ────────────────────────────────────────────────────────
type ChargeFn = (amount: number, currency: string) => Promise<PaymentResult>;

const paymentStrategies: Record<string, ChargeFn> = {
  stripe: async (amount, currency) => ({
    transactionId: `stripe-${Date.now()}`, status: 'success', provider: 'stripe',
  }),
  paypal: async (amount, currency) => ({
    transactionId: `pp-${Date.now()}`, status: 'success', provider: 'paypal',
  }),
  crypto: async (amount, currency) => ({
    transactionId: `crypto-${Date.now()}`, status: 'success', provider: 'crypto',
  }),
};

// ── Runtime selection from config ─────────────────────────────────────────────
const provider = (process.env.PAYMENT_PROVIDER ?? 'stripe') as keyof typeof paymentStrategies;
const charge = paymentStrategies[provider];

if (!charge) throw new Error(`Unknown payment provider: ${provider}`);
const result = await charge(99.99, 'USD');
```

---

### Testing Strategy Pattern

```typescript
describe('PaymentProcessor', () => {
  // Test each strategy in isolation
  describe('StripeStrategy', () => {
    it('returns a transaction ID on successful charge', async () => {
      const result = await new StripeStrategy().charge(50, 'USD');
      expect(result.status).toBe('success');
      expect(result.provider).toBe('stripe');
      expect(result.transactionId).toMatch(/^stripe-/);
    });
  });

  // Test the context with a mock strategy
  describe('PaymentProcessor with mock strategy', () => {
    const mockStrategy: PaymentStrategy = {
      charge: jest.fn().mockResolvedValue({
        transactionId: 'mock-123', status: 'success', provider: 'mock',
      }),
      refund: jest.fn().mockResolvedValue(undefined),
    };

    it('delegates to the strategy and returns its result', async () => {
      const processor = new PaymentProcessor(mockStrategy);
      const result = await processor.processPayment(100);
      expect(mockStrategy.charge).toHaveBeenCalledWith(100, 'USD');
      expect(result.transactionId).toBe('mock-123');
    });

    it('rejects non-positive amounts before calling strategy', async () => {
      const processor = new PaymentProcessor(mockStrategy);
      await expect(processor.processPayment(-1)).rejects.toThrow('Amount must be positive');
      expect(mockStrategy.charge).not.toHaveBeenCalled();
    });
  });
});
```

---

## Functional Design Patterns

Functional patterns avoid shared mutable state and side effects, making code more predictable and testable. These are practical TypeScript implementations — no category-theory PhD required.

---

### 1. Option / Maybe

**Motivation:** Replace `null`/`undefined` returns with an explicit type that forces the caller to handle the "nothing" case. Eliminates null-pointer surprises.

```typescript
// ── Type definition ───────────────────────────────────────────────────────────
type Option<T> = { tag: 'some'; value: T } | { tag: 'none' };

// ── Constructors ──────────────────────────────────────────────────────────────
const some = <T>(value: T): Option<T> => ({ tag: 'some', value });
const none = (): Option<never> => ({ tag: 'none' });

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapOption<T, U>(opt: Option<T>, fn: (value: T) => U): Option<U> {
  return opt.tag === 'some' ? some(fn(opt.value)) : none();
}

function flatMapOption<T, U>(opt: Option<T>, fn: (value: T) => Option<U>): Option<U> {
  return opt.tag === 'some' ? fn(opt.value) : none();
}

function getOrElse<T>(opt: Option<T>, fallback: T): T {
  return opt.tag === 'some' ? opt.value : fallback;
}

function fromNullable<T>(value: T | null | undefined): Option<T> {
  return value !== null && value !== undefined ? some(value) : none();
}

// ── Usage ─────────────────────────────────────────────────────────────────────
const users = new Map([['alice', { name: 'Alice', age: 30 }]]);

function findUser(id: string): Option<{ name: string; age: number }> {
  return fromNullable(users.get(id));
}

const greeting = getOrElse(
  mapOption(findUser('alice'), (u) => `Hello, ${u.name}`),
  'User not found'
);
console.log(greeting); // "Hello, Alice"

const missing = getOrElse(
  mapOption(findUser('bob'), (u) => `Hello, ${u.name}`),
  'User not found'
);
console.log(missing); // "User not found"
```

**When to prefer `Option<T>` over `T | null`:**
- When you want to chain safe transformations without null checks at every step
- When the absence of a value is an expected, meaningful state (not an error)
- When interoperating with functional libraries that understand `Option`

---

### 2. Result / Either

**Motivation:** Replace thrown exceptions with a return value that carries either a success or a typed error. Makes error handling explicit, composable, and traceable.

```typescript
// ── Type definition ───────────────────────────────────────────────────────────
type Result<T, E = Error> =
  | { tag: 'ok'; value: T }
  | { tag: 'err'; error: E };

// ── Constructors ──────────────────────────────────────────────────────────────
const ok = <T>(value: T): Result<T, never> => ({ tag: 'ok', value });
const err = <E>(error: E): Result<never, E> => ({ tag: 'err', error });

// ── Helpers ───────────────────────────────────────────────────────────────────
function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.tag === 'ok' ? ok(fn(result.value)) : result;
}

function flatMapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  return result.tag === 'ok' ? fn(result.value) : result;
}

function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.tag === 'ok' ? result.value : fallback;
}

// ── Full example with Zod validation ─────────────────────────────────────────
import { z, ZodError } from 'zod';

const UserSchema = z.object({
  name: z.string().min(1),
  age: z.number().int().positive(),
  email: z.string().email(),
});

type UserInput = z.infer<typeof UserSchema>;

// Validation wraps Zod's potential throw into a Result
function validateUser(raw: unknown): Result<UserInput, ZodError> {
  const parsed = UserSchema.safeParse(raw);
  return parsed.success ? ok(parsed.data) : err(parsed.error);
}

// Repository function uses Result for DB errors
async function saveUser(user: UserInput): Promise<Result<{ id: string }, string>> {
  try {
    // Simulated DB save
    const id = crypto.randomUUID();
    return ok({ id });
  } catch (e) {
    return err(`Database error: ${String(e)}`);
  }
}

// Compose the pipeline
async function createUser(raw: unknown): Promise<Result<{ id: string }, string>> {
  const validated = validateUser(raw);
  if (validated.tag === 'err') {
    return err(validated.error.issues.map((i) => i.message).join(', '));
  }
  return saveUser(validated.value);
}

// ── Usage ─────────────────────────────────────────────────────────────────────
const result = await createUser({ name: 'Bob', age: 25, email: 'bob@example.com' });
if (result.tag === 'ok') {
  console.log(`Created user with id ${result.value.id}`);
} else {
  console.error(`Failed: ${result.error}`);
}
```

---

### 3. Pipe and Compose

**Motivation:** Replace deeply nested function calls `f(g(h(x)))` with readable left-to-right pipelines.

```typescript
// ── Variadic pipe (left-to-right) ─────────────────────────────────────────────
// Overloads for up to 5 stages; real implementations use conditional types or a library
function pipe<A>(a: A): A;
function pipe<A, B>(a: A, ab: (a: A) => B): B;
function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C;
function pipe<A, B, C, D>(a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D): D;
function pipe<A, B, C, D, E>(
  a: A, ab: (a: A) => B, bc: (b: B) => C, cd: (c: C) => D, de: (d: D) => E
): E;
function pipe(a: unknown, ...fns: Array<(x: unknown) => unknown>): unknown {
  return fns.reduce((acc, fn) => fn(acc), a);
}

// ── Compose (right-to-left, mathematical convention) ─────────────────────────
function compose<A, B, C>(bc: (b: B) => C, ab: (a: A) => B): (a: A) => C {
  return (a) => bc(ab(a));
}

// ── Data transformation pipeline example ─────────────────────────────────────
interface RawOrder {
  items: Array<{ name: string; price: string; qty: string }>;
  discount: string;
}

const parseItems = (order: RawOrder) =>
  order.items.map((i) => ({ name: i.name, price: parseFloat(i.price), qty: parseInt(i.qty) }));

const calcSubtotal = (items: Array<{ price: number; qty: number; name: string }>) =>
  items.reduce((sum, i) => sum + i.price * i.qty, 0);

const applyDiscount = (discount: number) => (subtotal: number) =>
  subtotal * (1 - discount / 100);

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);

const rawOrder: RawOrder = {
  items: [{ name: 'Widget', price: '9.99', qty: '3' }],
  discount: '10',
};

const total = pipe(
  rawOrder,
  parseItems,
  calcSubtotal,
  applyDiscount(parseFloat(rawOrder.discount)),
  formatCurrency
);

console.log(total); // "$26.97"
```

---

### 4. Partial Application and Currying

**Motivation:** Pre-fill some arguments of a function to create specialised versions. Useful for configuration, event handlers, and eliminating repeated arguments.

```typescript
// ── curry: converts f(a, b, c) → f(a)(b)(c) ──────────────────────────────────
type Curry<F> = F extends (arg: infer A, ...rest: infer Rest) => infer R
  ? Rest extends []
    ? F
    : (arg: A) => Curry<(...args: Rest) => R>
  : never;

function curry<T extends (...args: unknown[]) => unknown>(fn: T): Curry<T> {
  const arity = fn.length;
  function curried(...args: unknown[]): unknown {
    return args.length >= arity
      ? fn(...args)
      : (...more: unknown[]) => curried(...args, ...more);
  }
  return curried as Curry<T>;
}

// ── partial: pre-fill leading arguments ───────────────────────────────────────
function partial<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  ...preArgs: Partial<TArgs>
): (...remainingArgs: unknown[]) => TReturn {
  return (...remainingArgs: unknown[]) =>
    fn(...([...preArgs, ...remainingArgs] as unknown as TArgs));
}

// ── Usage: configuration ──────────────────────────────────────────────────────
const formatLog = curry(
  (level: string, timestamp: string, message: string): string =>
    `[${timestamp}] [${level}] ${message}`
);

const logError = formatLog('ERROR');         // pre-fills level
const logInfo = formatLog('INFO');

const now = new Date().toISOString();
console.log(logError(now)('Connection refused')); // [2024-...] [ERROR] Connection refused
console.log(logInfo(now)('Server started'));

// ── Usage: event handlers ─────────────────────────────────────────────────────
function sendNotification(userId: string, channel: 'email' | 'sms', message: string): void {
  console.log(`Notify ${userId} via ${channel}: ${message}`);
}

const notifyViaEmail = partial(sendNotification, 'user-42', 'email');
notifyViaEmail('Your order has shipped!');
// → "Notify user-42 via email: Your order has shipped!"
```

---

### 5. Memoization

**Motivation:** Cache the result of pure function calls so repeated calls with the same arguments return immediately from cache. Only applies to **pure functions** (no side effects, deterministic output).

```typescript
// ── Type-safe memoize ─────────────────────────────────────────────────────────
function memoize<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
  keyFn: (...args: TArgs) => string = (...args) => JSON.stringify(args)
): (...args: TArgs) => TReturn {
  const cache = new Map<string, TReturn>();

  return (...args: TArgs): TReturn => {
    const key = keyFn(...args);
    if (cache.has(key)) {
      return cache.get(key) as TReturn;
    }
    const result = fn(...args);
    cache.set(key, result);
    return result;
  };
}

// ── Usage: expensive computation ──────────────────────────────────────────────
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const memoFib = memoize(fibonacci);

console.time('first');
memoFib(40); // slow
console.timeEnd('first');

console.time('second');
memoFib(40); // instant from cache
console.timeEnd('second');

// ── Custom key function for objects ───────────────────────────────────────────
interface QueryParams { table: string; filters: Record<string, unknown> }

const queryDb = memoize(
  async (params: QueryParams): Promise<unknown[]> => {
    // Expensive DB query
    return [];
  },
  (params) => `${params.table}:${JSON.stringify(params.filters)}`
);
```

> **Caution:** Memoization leaks memory if the argument space is unbounded. Add a max-size policy (LRU) or TTL for production caches.

---

### 6. Immutability Patterns

**Motivation:** Mutable shared state is the root cause of many concurrency bugs and unexpected behaviour. TypeScript provides compile-time immutability; `Object.freeze` adds runtime enforcement.

```typescript
// ── Readonly (shallow) ────────────────────────────────────────────────────────
type Config = Readonly<{
  apiUrl: string;
  timeout: number;
  retries: number;
}>;

const config: Config = { apiUrl: 'https://api.example.com', timeout: 5000, retries: 3 };
// config.apiUrl = 'x'; // TS2540: Cannot assign to 'apiUrl' because it is read-only

// ── DeepReadonly (recursive) ──────────────────────────────────────────────────
type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

interface AppState {
  user: { id: string; preferences: { theme: 'light' | 'dark' } };
  cart: { items: Array<{ sku: string; qty: number }> };
}

type FrozenState = DeepReadonly<AppState>;

const state: FrozenState = {
  user: { id: 'u1', preferences: { theme: 'dark' } },
  cart: { items: [{ sku: 'abc', qty: 2 }] },
};

// state.user.preferences.theme = 'light'; // TS error – deep readonly

// ── Object.freeze at API boundaries ──────────────────────────────────────────
function createConfig(raw: Partial<Config>): Config {
  return Object.freeze({
    apiUrl: raw.apiUrl ?? 'https://api.example.com',
    timeout: raw.timeout ?? 5000,
    retries: raw.retries ?? 3,
  });
}

// ── Immer: pragmatic escape hatch for complex updates ─────────────────────────
import { produce } from 'immer';

interface Todo {
  id: string;
  text: string;
  done: boolean;
}

const todos: ReadonlyArray<Todo> = [
  { id: '1', text: 'Write docs', done: false },
  { id: '2', text: 'Write tests', done: false },
];

// Immer lets you write mutable-style code; it returns a new immutable object
const updatedTodos = produce(todos, (draft) => {
  const todo = draft.find((t) => t.id === '1');
  if (todo) todo.done = true; // looks like mutation, but it's not
});

console.log(todos[0].done);        // false — original unchanged
console.log(updatedTodos[0].done); // true  — new object
```

---

### 7. Functor / Applicative Basics

**Motivation:** A Functor is any container that supports `map` — the ability to apply a function to the value(s) inside without unwrapping the container. You already use functors every day without realising it.

No category theory required. Here is the practical view:

```typescript
// ── Arrays are functors ───────────────────────────────────────────────────────
const numbers = [1, 2, 3, 4, 5];
const doubled = numbers.map((n) => n * 2); // [2, 4, 6, 8, 10]
// map applies a function (n => n*2) inside the Array container

// ── Options are functors ──────────────────────────────────────────────────────
// (using our Option type from above)
const maybeUser: Option<{ name: string }> = some({ name: 'Alice' });
const maybeName: Option<string> = mapOption(maybeUser, (u) => u.name);
// mapOption applies (u => u.name) inside the Option container, safely

// ── Promises are functors ─────────────────────────────────────────────────────
const userPromise: Promise<{ name: string }> = Promise.resolve({ name: 'Alice' });
const namePromise: Promise<string> = userPromise.then((u) => u.name);
// .then applies the function inside the Promise container

// ── Functor law: all these share the same pattern ─────────────────────────────
//   container.map(f).map(g)  ===  container.map(x => g(f(x)))

// ── Practical composition with "applicative" thinking ─────────────────────────
// Apply a list of functions to a list of values (Applicative pattern)
function applyAll<T, U>(fns: Array<(x: T) => U>, values: T[]): U[] {
  return fns.flatMap((fn) => values.map(fn));
}

const transforms = [
  (s: string) => s.toUpperCase(),
  (s: string) => s.trim(),
];

applyAll(transforms, ['  hello  ', 'world']); // ['  HELLO  ', 'WORLD', 'hello', 'world']

// ── Lifting a function into the Option context ─────────────────────────────────
function liftOption<T, U>(fn: (a: T) => U): (opt: Option<T>) => Option<U> {
  return (opt) => mapOption(opt, fn);
}

const toUpperOption = liftOption((s: string) => s.toUpperCase());

console.log(toUpperOption(some('hello'))); // { tag: 'some', value: 'HELLO' }
console.log(toUpperOption(none()));        // { tag: 'none' }

// ── Lifting into Promise context ───────────────────────────────────────────────
function liftPromise<T, U>(fn: (a: T) => U): (p: Promise<T>) => Promise<U> {
  return (p) => p.then(fn);
}

const toUpperAsync = liftPromise((s: string) => s.toUpperCase());
const result = await toUpperAsync(Promise.resolve('hello')); // "HELLO"
```

**The practical insight:** any time you see `.map()`, you are using a functor. The pattern unifies arrays, async operations, optional values, and custom containers under one mental model. When you write a custom container (like `Option` or `Result`), always implement `map` to make it a first-class citizen of this ecosystem.

---

## Summary and Decision Guide

```
Which pattern should I reach for?
───────────────────────────────────────────────────────────────────────────────

Problem                               Pattern
──────────────────────────────────────────────────────────────────────────────
Add behaviour to a class at runtime   Classical OOP Decorator (wrapper class)
Annotate classes for a DI framework   TypeScript Language Decorator (@Log, @Injectable)
Compose async functions               Functional HOF (withLogging, withRetry, withCache) + pipe
Sequential, conditional processing   Chain of Responsibility (Handler chain or middleware)
Swap algorithms at runtime            Strategy Pattern (OOP interface or function registry)
Handle missing values safely          Option / Maybe
Propagate typed errors without throw  Result / Either
Sequential data transformations       pipe / compose
Pre-configure functions               Partial Application / Currying
Cache pure computation                Memoize
Prevent accidental mutation           Readonly, DeepReadonly, Object.freeze, Immer
Apply functions to containers         Functor (map on Array, Option, Promise, Result)
───────────────────────────────────────────────────────────────────────────────
```

> **Golden rules:**
> 1. Prefer composition over inheritance — HOF decorators and pipe beat deep class hierarchies.
> 2. Make illegal states unrepresentable — use `Option` and `Result` to eliminate silent nulls and uncaught exceptions.
> 3. Test each strategy, decorator, and handler in isolation — the patterns are designed for it.
> 4. Keep the chain short and the order explicit — document middleware/handler order at the point of composition.
