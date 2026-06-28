# TypeScript Guidelines — 02: Code Style

This document defines the code-style rules for all TypeScript projects.
Every rule includes a ✅ correct example and a ❌ incorrect example so the intent is unambiguous.
Where a rule is enforced automatically (ESLint, Prettier, TypeScript compiler option), the relevant
configuration is noted.

---

## Interface Usage

### Prefer `interface` for object shapes; `type` for unions and mapped types

`interface` supports declaration merging and `extends`, which makes it the right tool for
describing the *shape* of a value that might be augmented or sub-typed.  
`type` is the right tool when you need algebraic combinations — unions, intersections, conditional
types, and mapped types.

```typescript
// ✅ interface for an object shape that may be extended
interface User {
  id: string;
  email: string;
  displayName: string;
}

interface AdminUser extends User {
  permissions: string[];
}

// ✅ type for a union
type Status = "active" | "inactive" | "suspended";

// ✅ type for a mapped type
type Partial<T> = { [K in keyof T]?: T[K] };

// ✅ type for an intersection of unrelated shapes
type AuditedEntity = Entity & AuditFields;
```

```typescript
// ❌ type alias for a plain object shape that will be extended
type User = {
  id: string;
  email: string;
};

// extending a type alias with & is noisy and loses declaration-merge support
type AdminUser = User & { permissions: string[] };
```

### Avoid the `I`-prefix naming convention

The `I`-prefix (`IUser`, `IRepository`) is a C#/Java convention with no benefit in TypeScript.
The type system makes it clear what is an interface.

```typescript
// ✅
interface UserRepository {
  findById(id: string): Promise<User | null>;
}

// ❌
interface IUserRepository {
  findById(id: string): Promise<IUser | null>;
}
```

### Use `extends` over `&` for interface inheritance

```typescript
// ✅
interface Animal {
  name: string;
}

interface Dog extends Animal {
  breed: string;
}

// ❌ — works but loses interface semantics and IDE tooling fidelity
type Dog = Animal & { breed: string };
```

### `readonly` properties and optional (`?`) vs. required fields

Mark fields `readonly` when they must not be mutated after construction.
Only mark a field optional when it is genuinely absent in some valid states.

```typescript
// ✅
interface Config {
  readonly apiUrl: string;           // never changes after construction
  readonly maxRetries: number;
  timeout?: number;                  // truly optional — has a runtime default
  authToken: string;                 // always required; never make it optional just to avoid passing it
}

// ❌
interface Config {
  apiUrl: string;                    // should be readonly
  timeout?: number;                  // fine
  authToken?: string;                // wrong: making required data optional hides bugs
}
```

### The `satisfies` operator for safe type validation without widening

`satisfies` validates that a value conforms to a type while *preserving* the narrower literal type
of the value. This is the right tool for config objects and look-up tables.

```typescript
// ✅ — palette's type is inferred as the specific tuple/value, not widened
const palette = {
  red:   [255, 0, 0],
  green: "#00ff00",
} satisfies Record<string, string | number[]>;

// palette.red is [number, number, number], not (string | number[])[]
palette.red[0]; // ✅ type is number

// ❌ — using 'as' widens and loses precision
const palette2 = {
  red:   [255, 0, 0],
  green: "#00ff00",
} as Record<string, string | number[]>;

palette2.red[0]; // type is string | number — information lost
```

---

## Resource Cleanup and Concurrency

### `using` keyword — explicit resource management (TypeScript 5.2+)

The TC39 Explicit Resource Management proposal adds `using` (synchronous) and `await using`
(asynchronous) to guarantee cleanup even when exceptions occur.

```typescript
// ✅ — database connection is closed even if the body throws
async function processOrders(db: Database): Promise<void> {
  await using conn = await db.connect(); // conn must implement Symbol.asyncDispose
  const orders = await conn.query("SELECT * FROM orders WHERE status = 'pending'");
  await fulfil(orders);
} // conn[Symbol.asyncDispose]() is called automatically here

// Implementing Symbol.asyncDispose on your own resource class
class DatabaseConnection {
  async query(sql: string) { /* … */ }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }

  private async close(): Promise<void> { /* … */ }
}
```

```typescript
// ❌ — cleanup is not guaranteed if an exception is thrown mid-function
async function processOrders(db: Database): Promise<void> {
  const conn = await db.connect();
  const orders = await conn.query("SELECT * FROM orders WHERE status = 'pending'");
  await fulfil(orders);
  await conn.close(); // never reached on throw
}
```

### `AbortController` + `AbortSignal` for cancellable async operations

Pass an `AbortSignal` through the call chain so callers can cancel in-flight work.

```typescript
// ✅
async function fetchUserData(
  userId: string,
  signal: AbortSignal,
): Promise<User> {
  const response = await fetch(`/api/users/${userId}`, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<User>;
}

// Caller can cancel after a timeout:
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 5_000);
try {
  const user = await fetchUserData("abc", controller.signal);
} finally {
  clearTimeout(timer);
}
```

```typescript
// ❌ — no cancellation path; fetch runs until the network times out
async function fetchUserData(userId: string): Promise<User> {
  const response = await fetch(`/api/users/${userId}`);
  return response.json() as Promise<User>;
}
```

### Avoid floating Promises

A "floating" Promise is one whose rejection is silently ignored.

```typescript
// ✅ — always await or explicitly handle the rejection
async function saveAndNotify(user: User): Promise<void> {
  await userRepository.save(user);
  await notificationService.send(user.email, "Welcome!").catch((err) => {
    logger.error("Notification failed", { err });
    // non-critical: we don't rethrow
  });
}

// ✅ — if truly fire-and-forget, attach a .catch handler
function trackEvent(name: string): void {
  analytics.track(name).catch((err) => logger.warn("Analytics failed", { err }));
}
```

```typescript
// ❌ — rejection is lost; no way to know if save succeeded
function saveUser(user: User): void {
  userRepository.save(user); // floating Promise — eslint @typescript-eslint/no-floating-promises
}
```

Enable `@typescript-eslint/no-floating-promises` in ESLint to catch this automatically.

### Concurrency patterns — when to use each

| Pattern | Use when |
|---|---|
| `Promise.all` | All operations must succeed; fail fast on first rejection |
| `Promise.allSettled` | Run all; inspect each result independently afterward |
| `Promise.race` | First to settle wins (e.g., timeout vs. fetch) |
| `Promise.any` | First to *fulfil* wins; ignore individual rejections |

```typescript
// ✅ Promise.all — fetch user + permissions in parallel; abort if either fails
const [user, permissions] = await Promise.all([
  userService.findById(userId),
  permissionService.forUser(userId),
]);

// ✅ Promise.allSettled — send notifications to multiple channels; log failures
const results = await Promise.allSettled([
  emailService.send(notification),
  smsService.send(notification),
  pushService.send(notification),
]);
for (const result of results) {
  if (result.status === "rejected") {
    logger.error("Notification channel failed", { reason: result.reason });
  }
}

// ✅ Promise.race — enforce a timeout
const timeoutPromise = new Promise<never>((_, reject) =>
  setTimeout(() => reject(new Error("Timeout")), 3_000),
);
const data = await Promise.race([fetchData(id), timeoutPromise]);
```

### Avoiding unhandled rejections

```typescript
// ✅ In Node.js — always register a last-resort handler at startup
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled rejection", { reason, promise });
  process.exit(1); // fail fast in server processes
});

// ✅ In browser — same pattern
window.addEventListener("unhandledrejection", (event) => {
  logger.error("Unhandled rejection", { reason: event.reason });
});
```

---

## Enums and Zero Values

### Avoid numeric `enum` — prefer `as const` objects

Numeric enums have a reverse-mapping that pollutes object iteration and makes the compiled output
surprising. An `as const` object with a derived union type is safer and equally ergonomic.

```typescript
// ❌ numeric enum — Direction[0] === "Up", Direction["Up"] === 0 (reverse mapping)
enum Direction {
  Up,
  Down,
  Left,
  Right,
}
// Object.values(Direction) → [0, 1, 2, 3, "Up", "Down", "Left", "Right"]

// ✅ as const — no surprises, tree-shakeable, works well with JSON
const Direction = {
  Up:    "UP",
  Down:  "DOWN",
  Left:  "LEFT",
  Right: "RIGHT",
} as const;

type Direction = (typeof Direction)[keyof typeof Direction];
// Direction === "UP" | "DOWN" | "LEFT" | "RIGHT"

// Usage is identical:
function move(dir: Direction): void { /* … */ }
move(Direction.Up); // ✅
```

### String enums as a safer alternative when the `enum` keyword is needed

If you must use `enum` (e.g., for declaration merging or a third-party API contract), use string
values to avoid the reverse-mapping problem.

```typescript
// ✅ string enum — no reverse mapping; values are readable in JSON
enum LogLevel {
  Debug = "DEBUG",
  Info  = "INFO",
  Warn  = "WARN",
  Error = "ERROR",
}
```

### Representing "empty" / zero states — prefer explicit `null | T` or discriminated unions

Sentinel values (e.g., `-1`, `""`, `0`) are invisible to the type system and cause implicit bugs.

```typescript
// ❌ — sentinel value; -1 has no meaning the type system can enforce
function findIndex(arr: string[], value: string): number {
  return arr.indexOf(value); // returns -1 when not found
}
const idx = findIndex(names, "Alice");
if (idx !== -1) { names[idx] = "Bob"; } // easy to forget the check

// ✅ — explicit null; the type system forces the caller to handle absence
function findIndex(arr: string[], value: string): number | null {
  const i = arr.indexOf(value);
  return i === -1 ? null : i;
}
const idx = findIndex(names, "Alice");
if (idx !== null) { names[idx] = "Bob"; }

// ✅ discriminated union — richer state representation
type SearchResult<T> =
  | { found: true;  value: T }
  | { found: false };

function search<T>(arr: T[], predicate: (v: T) => boolean): SearchResult<T> {
  const value = arr.find(predicate);
  return value !== undefined ? { found: true, value } : { found: false };
}
```

---

## Time Handling

### Use the Temporal API (or `date-fns` / `luxon`) instead of `Date`

The built-in `Date` object has well-documented flaws: mutable, month is 0-indexed, timezone
handling is inconsistent, and arithmetic is error-prone. Prefer the Temporal API (TC39 stage 3,
available via polyfill or natively in recent runtimes).

```typescript
// ✅ Temporal API — explicit timezone, unambiguous arithmetic
import { Temporal } from "@js-temporal/polyfill";

const now = Temporal.Now.instant();
const tomorrow = now.add({ hours: 24 });
const formatted = now.toString(); // "2024-03-15T10:30:00Z" — always UTC ISO 8601

// ✅ date-fns — functional, tree-shakeable
import { addDays, formatISO, parseISO } from "date-fns";

const startDate = parseISO("2024-01-01");
const endDate   = addDays(startDate, 30);
const isoString = formatISO(endDate); // "2024-01-31T00:00:00.000Z"
```

```typescript
// ❌ — raw Date arithmetic is error-prone and timezone-unaware
const now = new Date();
const tomorrow = new Date(now.getTime() + 86_400_000); // magic number
const month = now.getMonth() + 1; // getMonth() is 0-indexed — easy to forget +1
```

### Always store timestamps as UTC ISO 8601 or epoch milliseconds

```typescript
// ✅ — store as UTC ISO 8601 string
interface Event {
  id:         string;
  occurredAt: string; // "2024-03-15T10:30:00.000Z"
}

// ✅ — or epoch milliseconds (unambiguous, sortable, comparable)
interface Event {
  id:         string;
  occurredAt: number; // Unix epoch ms: 1710499800000
}

// ❌ — local time string with no timezone info is ambiguous
interface Event {
  id:         string;
  occurredAt: string; // "2024-03-15 10:30:00" — which timezone?
}
```

### Avoid arithmetic on `Date` objects directly

```typescript
// ✅ — use date-fns or Temporal for arithmetic
import { differenceInDays, addMonths } from "date-fns";

const daysDiff = differenceInDays(endDate, startDate);
const nextMonth = addMonths(startDate, 1);

// ✅ Temporal arithmetic
const duration = Temporal.Duration.from({ days: 30 });
const future = Temporal.Now.plainDateISO().add(duration);
```

```typescript
// ❌ — manual millisecond arithmetic ignores DST, leap seconds, month length
const msPerDay = 86_400_000;
const thirtyDaysLater = new Date(someDate.getTime() + 30 * msPerDay);
```

### Correct patterns for comparing, adding, and formatting dates

```typescript
// ✅ Comparing
import { isBefore, isAfter, isEqual } from "date-fns";

if (isBefore(startDate, endDate)) { /* … */ }

// ✅ Formatting — always specify timezone explicitly
import { formatInTimeZone } from "date-fns-tz";

const display = formatInTimeZone(event.occurredAt, "America/New_York", "yyyy-MM-dd HH:mm");

// ✅ Temporal comparison
const a = Temporal.Instant.from("2024-01-01T00:00:00Z");
const b = Temporal.Instant.from("2024-06-01T00:00:00Z");
Temporal.Instant.compare(a, b); // -1, 0, or 1
```

---

## Error Handling

### The `Result<T, E>` pattern

Return errors as values for *expected* failure modes. Reserve thrown exceptions for truly
*unexpected* failures (programming errors, infrastructure failures).

```typescript
// ✅ — Result type definition
type Result<T, E = Error> =
  | { ok: true;  value: T }
  | { ok: false; error: E };

// ✅ — usage
async function findUser(id: string): Promise<Result<User, "NOT_FOUND" | "DB_ERROR">> {
  try {
    const user = await db.users.findById(id);
    if (!user) return { ok: false, error: "NOT_FOUND" };
    return { ok: true, value: user };
  } catch {
    return { ok: false, error: "DB_ERROR" };
  }
}

const result = await findUser("123");
if (!result.ok) {
  if (result.error === "NOT_FOUND") return res.status(404).json({ message: "User not found" });
  return res.status(500).json({ message: "Internal error" });
}
const { value: user } = result;
```

```typescript
// ❌ — throws for expected failure; caller must know to catch
async function findUser(id: string): Promise<User> {
  const user = await db.users.findById(id);
  if (!user) throw new Error("User not found"); // caller must try/catch
  return user;
}
```

### Custom error classes with a `name` property

```typescript
// ✅ — custom error with a stable name property for instanceof and type narrowing
class ValidationError extends Error {
  override readonly name = "ValidationError" as const;

  constructor(
    message: string,
    public readonly field: string,
  ) {
    super(message);
    // Needed in environments that transpile classes (e.g., TypeScript targeting ES5)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

class NotFoundError extends Error {
  override readonly name = "NotFoundError" as const;

  constructor(resource: string, id: string) {
    super(`${resource} with id "${id}" not found`);
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// Usage
try {
  throw new ValidationError("Email is invalid", "email");
} catch (err) {
  if (err instanceof ValidationError) {
    console.error(err.field, err.message); // narrowed correctly
  }
}
```

### `useUnknownInCatchVariables` — `unknown` is safer than `any`

Enable `"useUnknownInCatchVariables": true` in `tsconfig.json` (default in `strict` mode ≥TS4.4).

```typescript
// ✅ — unknown forces you to narrow before use
try {
  await riskyOperation();
} catch (err: unknown) {
  if (err instanceof Error) {
    logger.error(err.message, { stack: err.stack });
  } else {
    logger.error("Unknown error", { raw: String(err) });
  }
}

// ✅ — reusable narrowing helper
function isError(value: unknown): value is Error {
  return value instanceof Error;
}
```

```typescript
// ❌ — 'any' means you can call .message without checking — silent runtime crash if err is a string
try {
  await riskyOperation();
} catch (err: any) {
  logger.error(err.message); // crashes if err is "string thrown directly"
}
```

### Never swallow errors silently

```typescript
// ✅ — log then rethrow
async function processPayment(order: Order): Promise<void> {
  try {
    await paymentGateway.charge(order);
  } catch (err) {
    logger.error("Payment processing failed", { orderId: order.id, err });
    throw err; // rethrow so the caller knows
  }
}

// ✅ — return as Result
async function processPayment(order: Order): Promise<Result<void>> {
  try {
    await paymentGateway.charge(order);
    return { ok: true, value: undefined };
  } catch (err) {
    logger.error("Payment failed", { orderId: order.id, err });
    return { ok: false, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
```

```typescript
// ❌ — error is silently discarded; bugs become invisible
try {
  await processPayment(order);
} catch {
  // do nothing 🔥
}
```

### Validation at system boundaries using Zod

```typescript
// ✅ — define schema, infer type, parse at the boundary
import { z } from "zod";

const CreateUserSchema = z.object({
  email:       z.string().email(),
  displayName: z.string().min(1).max(100),
  role:        z.enum(["admin", "member", "viewer"]).default("member"),
});

type CreateUserInput = z.infer<typeof CreateUserSchema>;

// In your HTTP handler:
function handleCreateUser(req: Request): void {
  const result = CreateUserSchema.safeParse(req.body);
  if (!result.success) {
    throw new ValidationError(result.error.message, "body");
  }
  const input: CreateUserInput = result.data; // fully typed, validated
  userService.create(input);
}
```

```typescript
// ❌ — trusting raw JSON from external sources without validation
function handleCreateUser(req: Request): void {
  const input = req.body as CreateUserInput; // 'as' is a lie — no runtime check
  userService.create(input);
}
```

---

## Type Assertion Safety

### `as T` is a compile-time lie

`as T` tells the compiler to trust you. It performs no runtime check. It is permissible only when
you have runtime evidence that the type is correct and the evidence is documented.

```typescript
// ✅ — permissible: you have just parsed and validated, the type is known
const raw: unknown = JSON.parse(text);
const validated = CreateUserSchema.parse(raw); // Zod throws if wrong
const user = validated as CreateUserInput; // redundant here; Zod already typed it

// ✅ — permissible: DOM API returns Element | null; you verified it exists
const button = document.getElementById("submit-btn") as HTMLButtonElement;
// DOCUMENT: "submit-btn" is always present in this template; checked at mount"

// ❌ — assertion without evidence is a runtime bomb
function getUser(): User {
  return fetchData() as User; // fetchData() returns unknown — no check
}
```

### Prefer user-defined type guards over assertions

```typescript
// ✅ — type guard is a runtime check that also narrows the type
function isUser(value: unknown): value is User {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["id"] === "string" &&
    typeof (value as Record<string, unknown>)["email"] === "string"
  );
}

function processValue(value: unknown): void {
  if (isUser(value)) {
    console.log(value.email); // ✅ narrowed to User
  }
}

// ❌ — assertion provides narrowing without a runtime check
function processValue(value: unknown): void {
  const user = value as User;
  console.log(user.email); // crashes silently if value is not a User
}
```

### Never use `as unknown as T` double assertion except for bridging untyped code

```typescript
// ✅ — rare legitimate use: bridging external untyped code (document why)
// REASON: legacy SDK returns 'object' with no type; validated at runtime before this point
const legacyResult = (sdkResponse as unknown) as LegacyApiResponse;

// ❌ — double assertion to silence a type error without understanding it
const bad = (someValue as unknown) as CompletelyDifferentType; // dangerous shortcut
```

### Non-null assertion (`!`) — use only when nullability is guaranteed by the call site

```typescript
// ✅ — Map.get() returns T | undefined, but we just set it; the ! is justified
const cache = new Map<string, User>();
cache.set("abc", user);
const cached = cache.get("abc")!; // we just set it; it exists

// ✅ — documented invariant enforced by the framework
// React: ref.current is assigned before any event handler fires
function handleClick(): void {
  inputRef.current!.focus(); // INVARIANT: ref attached in JSX before this fires
}

// ❌ — using ! to silence a nullable warning without understanding it
const user = maybeGetUser()!; // if maybeGetUser() returns null, this crashes
```

---

## Control Flow

### Exhaustiveness checking with `never`

In a `switch` over a discriminated union, add a `never`-typed default branch. The compiler will
error if any variant is unhandled.

```typescript
// ✅
type Shape =
  | { kind: "circle";    radius: number }
  | { kind: "rectangle"; width: number; height: number }
  | { kind: "triangle";  base: number;  height: number };

function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":    return Math.PI * shape.radius ** 2;
    case "rectangle": return shape.width * shape.height;
    case "triangle":  return 0.5 * shape.base * shape.height;
    default: {
      const _exhaustive: never = shape;
      throw new Error(`Unhandled shape: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
// Adding a new variant to Shape without updating area() → compile error ✅
```

```typescript
// ❌ — no exhaustiveness check; new variants silently return undefined
function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":    return Math.PI * shape.radius ** 2;
    case "rectangle": return shape.width * shape.height;
    // forgot triangle → returns undefined at runtime, typed as number
  }
}
```

### Avoid `else` after early returns

```typescript
// ✅
function getDiscount(user: User): number {
  if (!user.isActive) return 0;
  if (user.role === "admin") return 50;
  if (user.subscriptionYears >= 5) return 20;
  return 10;
}

// ❌ — unnecessary else nesting
function getDiscount(user: User): number {
  if (!user.isActive) {
    return 0;
  } else {
    if (user.role === "admin") {
      return 50;
    } else {
      if (user.subscriptionYears >= 5) {
        return 20;
      } else {
        return 10;
      }
    }
  }
}
```

### Guard clauses over deeply nested `if/else`

```typescript
// ✅ — guard clauses: fail fast, keep the happy path flat
async function processOrder(orderId: string, userId: string): Promise<Receipt> {
  const order = await orderRepository.findById(orderId);
  if (!order) throw new NotFoundError("Order", orderId);

  const user = await userRepository.findById(userId);
  if (!user) throw new NotFoundError("User", userId);

  if (order.userId !== userId) throw new ForbiddenError("Order does not belong to user");
  if (order.status !== "pending") throw new ConflictError("Order is not pending");

  return paymentService.charge(order, user);
}

// ❌ — pyramid of doom
async function processOrder(orderId: string, userId: string): Promise<Receipt | null> {
  const order = await orderRepository.findById(orderId);
  if (order) {
    const user = await userRepository.findById(userId);
    if (user) {
      if (order.userId === userId) {
        if (order.status === "pending") {
          return paymentService.charge(order, user);
        }
      }
    }
  }
  return null;
}
```

### Prefer `find`, `filter`, `reduce` over imperative loops when it improves clarity

```typescript
// ✅
const activeAdmins = users
  .filter((u) => u.isActive && u.role === "admin")
  .map((u) => u.email);

const totalRevenue = orders.reduce((sum, o) => sum + o.amount, 0);

const userById = new Map(users.map((u) => [u.id, u]));

// ❌ — imperative equivalent is more verbose and harder to read
const activeAdmins: string[] = [];
for (const u of users) {
  if (u.isActive && u.role === "admin") {
    activeAdmins.push(u.email);
  }
}
```

> **Note**: for very large arrays or performance-critical paths, profile before switching away from
> a plain `for` loop. `reduce` with complex accumulators can hurt readability — use a named helper
> function instead.

---

## Mutable Globals and Dependency Injection

### Avoid module-level mutable state

Module-level `let` / mutable objects become invisible global state. They make testing hard, cause
race conditions in worker-based environments, and make the execution order of side effects unclear.

```typescript
// ❌ — module-level mutable state
let currentUser: User | null = null;

export function setCurrentUser(u: User): void { currentUser = u; }
export function getCurrentUser(): User | null  { return currentUser; }

// ✅ — inject via parameters or context
export async function handleRequest(
  req: Request,
  context: { currentUser: User },
): Promise<Response> {
  return buildResponse(req, context.currentUser);
}
```

### Simple DI without a framework — constructor injection with interfaces

```typescript
// ✅ — define interfaces for each dependency
interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

// ✅ — inject via constructor; easy to substitute in tests
class UserService {
  constructor(
    private readonly repo:   UserRepository,
    private readonly logger: Logger,
  ) {}

  async deactivate(userId: string): Promise<void> {
    const user = await this.repo.findById(userId);
    if (!user) throw new NotFoundError("User", userId);
    user.isActive = false;
    await this.repo.save(user);
    this.logger.info("User deactivated", { userId });
  }
}

// In tests — inject mocks trivially:
const mockRepo: UserRepository = {
  findById: async () => ({ id: "1", isActive: true, email: "a@b.com" } as User),
  save:     async () => {},
};
const mockLogger: Logger = { info: () => {}, error: () => {} };
const service = new UserService(mockRepo, mockLogger);
```

### Factory functions as a DI alternative

```typescript
// ✅ — functional DI via factory
function createOrderService(deps: {
  orderRepo:      OrderRepository;
  paymentGateway: PaymentGateway;
  logger:         Logger;
}) {
  return {
    async place(input: PlaceOrderInput): Promise<Order> {
      const order = await deps.orderRepo.create(input);
      await deps.paymentGateway.charge(order);
      deps.logger.info("Order placed", { orderId: order.id });
      return order;
    },
  };
}
```

### When a DI container is appropriate

Use a container (`tsyringe`, `inversify`) only when:
- The project has 20+ injectable services with many transitive dependencies.
- You need scoped/singleton lifetime management.
- The team is already familiar with the container's API.

Avoid containers in libraries and small services; the explicit constructor approach is more
readable and has zero magic.

---

## Shadowing Built-in Names

### Never shadow built-in globals

Shadowing `Error`, `Promise`, `Array`, `Object`, `Map`, `Set`, `fetch`, `URL`, `Event`, `Date`,
`Number`, `String`, `Boolean`, etc. confuses readers and creates subtle bugs.

```typescript
// ❌ — 'Promise' now refers to the local variable in this scope
function processData(Promise: unknown): void {
  // 'new Promise(...)' no longer works — the built-in is shadowed
}

// ❌ — 'Error' shadowed by import alias
import { CustomError as Error } from "./errors"; // 'Error' now broken in this file

// ✅ — use a non-colliding name
import { CustomError } from "./errors";
function processData(promiseInput: unknown): void { /* … */ }
```

### ESLint rule: `no-shadow` with built-in globals

```json
// .eslintrc.json
{
  "rules": {
    "no-shadow": ["error", {
      "builtinGlobals": true,
      "hoist": "functions",
      "allow": []
    }]
  }
}
```

### Real-world shadowing bug

```typescript
// ❌ — shadowing 'Map' breaks downstream code in the same file
function transformMap(Map: Record<string, string>): string[] {
  return Object.values(Map);
}

// Later in the same file:
const userMap = new Map<string, User>(); // ❌ 'Map' is now the Record from the function scope?
// No — function scope is different, but the name collision confuses readers and
// in a closure scenario can cause actual bugs.
```

---

## Serialization (JSON)

### Use `JSON.parse` + Zod to validate external data at the boundary

```typescript
// ✅
import { z } from "zod";

const ApiUserSchema = z.object({
  id:          z.string().uuid(),
  email:       z.string().email(),
  created_at:  z.string().datetime(),
});

type ApiUser = z.infer<typeof ApiUserSchema>;

async function fetchUser(id: string): Promise<ApiUser> {
  const response = await fetch(`/api/users/${id}`);
  const raw: unknown = await response.json();
  return ApiUserSchema.parse(raw); // throws ZodError if schema doesn't match
}

// ❌ — trust raw JSON without validation
async function fetchUser(id: string): Promise<ApiUser> {
  const response = await fetch(`/api/users/${id}`);
  return response.json() as ApiUser; // no runtime check — lies to the type system
}
```

### Transforming camelCase ↔ snake_case

```typescript
// ✅ — transform at the boundary with Zod
import { z } from "zod";

const ApiResponseSchema = z
  .object({
    user_id:     z.string(),
    display_name: z.string(),
    created_at:  z.string(),
  })
  .transform((data) => ({
    userId:      data.user_id,
    displayName: data.display_name,
    createdAt:   data.created_at,
  }));

// Or use a manual transform map for large APIs:
const snakeToCamel: Record<string, string> = {
  user_id:      "userId",
  display_name: "displayName",
  created_at:   "createdAt",
};
```

### Using `toJSON()` on classes for controlled serialization

```typescript
// ✅ — toJSON() controls what JSON.stringify includes
class User {
  constructor(
    public readonly id:           string,
    public readonly email:        string,
    private readonly passwordHash: string, // must not be serialized
  ) {}

  toJSON(): Omit<User, "passwordHash" | "toJSON"> {
    return { id: this.id, email: this.email };
  }
}

const user = new User("1", "alice@example.com", "hashed_secret");
JSON.stringify(user); // {"id":"1","email":"alice@example.com"} — passwordHash excluded ✅
```

### `JSON.stringify` replacers for stripping sensitive fields

```typescript
// ✅ — replacer function strips secrets from any serialized object
const SENSITIVE_KEYS = new Set(["password", "token", "secret", "apiKey", "creditCard"]);

function safeStringify(value: unknown): string {
  return JSON.stringify(value, (key, val) => {
    if (SENSITIVE_KEYS.has(key)) return "[REDACTED]";
    return val;
  }, 2);
}

const payload = { userId: "1", token: "super-secret", data: { credit_card: "4111..." } };
safeStringify(payload);
// {"userId":"1","token":"[REDACTED]","data":{"credit_card":"4111..."}}
// Note: "credit_card" not in set — use exact key names or normalise keys first
```

---

## Performance

### Avoid premature optimization — profile first

```typescript
// ✅ — profile with Node.js built-in profiler
// node --prof server.js
// node --prof-process isolate-*.log > processed.txt

// ✅ — clinic.js for in-depth flame graphs
// npx clinic flame -- node server.js

// ❌ — micro-optimizing without evidence
// Avoid changing readable code to "faster" alternatives without a benchmark showing a real gain
```

### Object spread vs `Object.assign`

Prefer spread for creating new objects (immutable pattern). Use `Object.assign` only when you
intentionally mutate the target.

```typescript
// ✅ — spread creates a new object; original is unchanged
const updatedUser = { ...user, displayName: "New Name" };

// ✅ — Object.assign mutates target intentionally (e.g., merging defaults)
const config = Object.assign({}, DEFAULT_CONFIG, userConfig);

// ❌ — Object.assign mutates the first argument, which might be an imported object
Object.assign(importedConfig, overrides); // mutates module-level state
```

### Avoid re-creating functions inside render loops

```typescript
// ✅ React — useCallback for stable function identity
const handleClick = useCallback((id: string) => {
  dispatch({ type: "SELECT_ITEM", payload: id });
}, [dispatch]);

// ✅ Non-React — define helpers outside the loop
const format = (n: number): string => n.toFixed(2);
const formatted = largeArray.map(format); // same function reference reused

// ❌ — new function on every render / iteration
const formatted = largeArray.map((n) => n.toFixed(2)); // minor; OK for simple cases
// but avoid this pattern with heavy event listeners:
element.addEventListener("click", () => expensiveSetup()); // ❌ re-creates on every call
```

### Lazy imports (`import()`) for large modules

```typescript
// ✅ — load heavy modules only when needed
async function generatePdfReport(data: ReportData): Promise<Buffer> {
  const { PDFDocument } = await import("pdf-lib"); // loaded lazily
  const doc = await PDFDocument.create();
  // …
  return doc.save();
}

// ❌ — top-level import bloats startup time
import { PDFDocument } from "pdf-lib"; // loaded on every startup even if rarely used
```

### Type-level performance — avoid deeply nested generics

```typescript
// ✅ — break complex types into named intermediate types
type UserMap = Map<string, User>;
type GroupedUsers = Map<string, UserMap>;

// ❌ — deeply nested generics increase type-checking time
type Data = Map<string, Map<string, Map<string, Record<string, unknown[]>>>>;

// ✅ — use 'infer' sparingly and only when necessary
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T;

// ❌ — chaining multiple conditional types with deep infer slows the compiler
type DeepUnwrap<T> =
  T extends Promise<infer U> ? DeepUnwrap<U>
  : T extends Array<infer V>  ? DeepUnwrap<V>
  : T; // recursive conditional types — use with care
```

---

## Styling Conventions

### Line length — 100 characters maximum

Enforce with Prettier:

```json
// prettier.config.json
{
  "printWidth": 100,
  "tabWidth": 2,
  "singleQuote": false,
  "trailingComma": "all",
  "semi": true
}
```

```typescript
// ✅ — fits within 100 chars; Prettier handles wrapping automatically
const result = await userService.findActiveUsersWithRole("admin", { includeDeleted: false });

// ❌ — manually broken at arbitrary points (let Prettier decide)
const result = await userService
  .findActiveUsersWithRole("admin", { includeDeleted: false });
```

### Consistency — one style per project, never mixed in a file

```typescript
// ❌ — mixing quote styles in a single file
const a = "double quotes";
const b = 'single quotes'; // pick one and apply project-wide

// ✅ — Prettier enforces this automatically; no manual decisions needed
const a = "double quotes";
const b = "double quotes";
```

### Import ordering — stdlib → third-party → local

Enforce with `eslint-plugin-import` or `@trivago/prettier-plugin-sort-imports`.

```typescript
// ✅ — ordered: Node built-ins, then third-party, then internal/local
import { readFile } from "node:fs/promises";
import { join }     from "node:path";

import { z }        from "zod";
import express      from "express";

import { UserService }    from "@/services/user-service";
import { parseUserInput } from "./parse-user-input";
import type { User }      from "./types";

// ❌ — mixed ordering
import { UserService }    from "@/services/user-service";
import { readFile }       from "node:fs/promises";
import express            from "express";
import { parseUserInput } from "./parse-user-input";
import { z }              from "zod";
```

### Module naming — `kebab-case` file names; avoid barrel `index.ts` for deep trees

```
✅ Correct file structure:
src/
  services/
    user-service.ts
    order-service.ts
    payment-gateway.ts
  handlers/
    create-user.ts
    list-orders.ts

❌ Avoid deep index.ts barrels:
src/
  services/
    index.ts         ← re-exports everything; creates circular-dependency risk
    UserService.ts   ← PascalCase file name is non-idiomatic for TypeScript
```

```typescript
// ✅ — explicit import; import path reflects exactly what you get
import { UserService } from "@/services/user-service";

// ❌ — barrel import hides where things come from; hurts tree-shaking
import { UserService, OrderService, PaymentGateway } from "@/services";
```

### Function naming and ordering — exported first, helpers after; verbs for functions, nouns for types

```typescript
// ✅ — exported functions at the top, private helpers below
export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const validated = validateInput(input);
  const order = buildOrderEntity(validated);
  return orderRepository.save(order);
}

export async function cancelOrder(orderId: string): Promise<void> {
  const order = await assertOrderExists(orderId);
  assertCancellable(order);
  await orderRepository.update(orderId, { status: "cancelled" });
}

// ── Private helpers ──────────────────────────────────────────────────────────
function validateInput(input: CreateOrderInput): ValidatedOrderInput { /* … */ }
function buildOrderEntity(input: ValidatedOrderInput): Order { /* … */ }
async function assertOrderExists(id: string): Promise<Order> { /* … */ }
function assertCancellable(order: Order): void { /* … */ }

// ✅ — naming: verbs for functions, nouns for types/classes
function getUser(): User { /* … */ }          // verb
function createOrder(): Order { /* … */ }     // verb
class OrderService { /* … */ }               // noun
type UserRole = "admin" | "member";          // noun
interface PaymentGateway { /* … */ }         // noun

// ❌ — confusing names
function user(): User { /* … */ }            // noun used as function — unclear
function doTheOrderThing(): void { /* … */ } // vague verb
```

### Reducing nesting — extract to functions; early returns; simple ternaries only

```typescript
// ✅ — flat, with early returns
function formatUserLabel(user: User | null): string {
  if (!user) return "Guest";
  if (!user.displayName) return user.email;
  return user.displayName;
}

// ✅ — ternary only for simple two-branch cases
const label = isLoggedIn ? "Dashboard" : "Login";

// ❌ — nested ternary (unreadable)
const label = isLoggedIn
  ? isAdmin
    ? "Admin Dashboard"
    : "User Dashboard"
  : "Login";

// ❌ — excessive nesting instead of extraction
function processData(data: Data | null): Result {
  if (data) {
    if (data.isValid) {
      if (data.items.length > 0) {
        return transform(data.items);
      }
    }
  }
  return emptyResult();
}
```

### Unnecessary `else` — remove after `return` or `throw`

```typescript
// ✅
function classify(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  return "F";
}

// ❌
function classify(score: number): string {
  if (score >= 90) {
    return "A";
  } else if (score >= 80) {
    return "B";
  } else if (score >= 70) {
    return "C";
  } else {
    return "F";
  }
}
```

Enable `no-else-return` ESLint rule to enforce this automatically.

### Variable declarations — `const` by default; `let` only when mutation is needed; never `var`

```typescript
// ✅
const userId = "abc-123";
const users  = await userRepository.findAll();

let retryCount = 0;
while (retryCount < 3) {
  try { await connect(); break; }
  catch { retryCount++; }
}

// ❌
var userId = "abc-123"; // var is function-scoped and hoisted — always use const/let
let name = "Alice";     // should be const — name is never reassigned
```

Enable `prefer-const` and `no-var` ESLint rules.

### Variable scope — declare as close to use as possible

```typescript
// ✅ — declared inside the block where it's used
for (const order of orders) {
  const total = calculateTotal(order); // scoped to the loop body
  console.log(total);
}

// ❌ — declared far from use, widening scope unnecessarily
let total: number;
for (const order of orders) {
  total = calculateTotal(order);
  console.log(total);
}
```

### Template literals — prefer over string concatenation; tag templates for i18n / SQL

```typescript
// ✅ — template literal
const greeting = `Hello, ${user.displayName}! You have ${count} messages.`;

// ✅ — tagged template for SQL (parameterised, safe from injection)
import { sql } from "@vercel/postgres";
const result = await sql`SELECT * FROM users WHERE id = ${userId}`;

// ✅ — tagged template for i18n
const message = i18n`Welcome, ${user.displayName}. Your plan expires on ${expiresAt}.`;

// ❌ — string concatenation
const greeting = "Hello, " + user.displayName + "! You have " + count + " messages.";

// ❌ — string interpolation in raw SQL (SQL injection risk)
const result = await db.query(`SELECT * FROM users WHERE id = '${userId}'`); // ❌ DANGEROUS
```

### Object initialization — shorthand properties; computed property names

```typescript
// ✅ — shorthand property names
const name  = "Alice";
const email = "alice@example.com";
const user  = { name, email }; // shorthand: no need to write { name: name, email: email }

// ✅ — computed property names
const key = "dynamicField";
const obj = { [key]: "value", staticField: true };

// ❌ — verbose long-form when shorthand is available
const user = { name: name, email: email };
```

### Grouping declarations — group related constants; group imports by type

```typescript
// ✅ — group related constants together with a comment block
// ── Pagination defaults ────────────────────────────────────────────────────
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE     = 100;
const MIN_PAGE_SIZE     = 1;

// ── Rate limiting ──────────────────────────────────────────────────────────
const RATE_LIMIT_WINDOW_MS  = 60_000;
const RATE_LIMIT_MAX_REQS   = 100;

// ❌ — constants scattered with unrelated declarations
const DEFAULT_PAGE_SIZE = 20;
function fetchPage() { /* … */ }
const MAX_PAGE_SIZE = 100;
function processResults() { /* … */ }
const MIN_PAGE_SIZE = 1;
```

### Format strings — use template literals; avoid `util.format` unless needed for logging

```typescript
// ✅ — template literals for formatting
const message = `User ${userId} performed action "${action}" at ${timestamp}`;

// ✅ — util.format is acceptable for printf-style log formatting in Node.js
import { format } from "node:util";
logger.debug(format("Retry %d of %d for %s", attempt, maxAttempts, operationName));

// ❌ — string concatenation for multi-part strings
const message = "User " + userId + " performed action \"" + action + "\" at " + timestamp;

// ❌ — util.format in browser code or where template literals suffice
const msg = util.format("Hello %s", name); // use `Hello ${name}` instead
```

---

## Summary Checklist

| Category | Rule | Enforcement |
|---|---|---|
| Interfaces | Prefer `interface` for shapes, `type` for unions | Code review |
| Interfaces | No `I`-prefix | ESLint `@typescript-eslint/naming-convention` |
| Concurrency | No floating Promises | ESLint `@typescript-eslint/no-floating-promises` |
| Enums | No numeric enums | ESLint `@typescript-eslint/no-enum-members-as-values` |
| Error handling | `useUnknownInCatchVariables` | `tsconfig.json` strict mode |
| Assertions | No unexplained `as T` | Code review |
| Control flow | Exhaustiveness with `never` | Code review |
| DI | No module-level mutable state | Code review |
| Shadowing | No built-in shadowing | ESLint `no-shadow` with `builtinGlobals: true` |
| Serialization | Zod at boundaries | Code review |
| Style | 100 char line length | Prettier |
| Style | Import ordering | `eslint-plugin-import` |
| Style | `const` by default | ESLint `prefer-const`, `no-var` |
| Style | No `else` after `return` | ESLint `no-else-return` |
| Style | `kebab-case` file names | ESLint `unicorn/filename-case` |
