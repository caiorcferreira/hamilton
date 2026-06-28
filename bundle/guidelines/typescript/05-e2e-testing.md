# TypeScript Guidelines – 05: End-to-End Testing

> **Stack**: Vitest · Testcontainers for Node.js · Playwright · `fetch` / `got`

This guideline covers how to write reliable, fast, and maintainable end-to-end (E2E) tests for TypeScript
back-end and full-stack applications. The patterns here treat E2E tests as **executable specifications** of
system behaviour, not as glorified integration smoke-checks.

---

## E2E Architecture

### The 4-Layer Model

Well-structured E2E suites separate four distinct concerns so that each layer can evolve independently.

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 1 – Entry Point                                          │
│  vitest.config.ts  ·  e2e/setup.ts  ·  globalSetup.ts          │
│  Bootstraps the runtime: starts containers, builds the network, │
│  injects env vars, waits for health checks.                     │
└────────────────────────────┬────────────────────────────────────┘
                             │ provides a fully-constructed Driver
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 2 – Specifications                                       │
│  e2e/specs/**/*.spec.ts                                         │
│  Pure business logic expressed as Vitest describe/it blocks.    │
│  Zero infrastructure imports. Receives Driver from setup.       │
└────────────────────────────┬────────────────────────────────────┘
                             │ calls high-level actions
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 3 – Driver                                               │
│  e2e/drivers/**/*.ts                                            │
│  Protocol adapter (HTTP, gRPC, WebSocket, Browser).            │
│  Translates domain actions → wire calls → domain results.       │
│  Hides status codes, serialization, retries.                    │
└────────────────────────────┬────────────────────────────────────┘
                             │ connects to
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Layer 4 – Resources                                            │
│  e2e/resources/**/*.ts                                          │
│  Testcontainers wrappers, fixtures, seed helpers.               │
│  Manages Docker containers, networks, volumes.                  │
└─────────────────────────────────────────────────────────────────┘
```

### Dependency Rule

**Specifications must never import infrastructure directly.** They receive a fully-constructed driver via
Vitest's fixture system (or a module-level singleton set up in `globalSetup`). This means a spec file
should contain zero references to `testcontainers`, `fetch`, Docker ports, or environment variables.

```
e2e/
├── setup.ts                  # Vitest globalSetup – starts/stops all containers
├── vitest.config.e2e.ts      # Separate Vitest project config for E2E
├── specs/
│   ├── users/
│   │   ├── create-user.spec.ts
│   │   └── delete-user.spec.ts
│   └── orders/
│       └── place-order.spec.ts
├── drivers/
│   ├── user.http.driver.ts
│   ├── user.grpc.driver.ts
│   └── order.http.driver.ts
├── resources/
│   ├── app.container.ts      # GenericContainer for the app under test
│   ├── postgres.container.ts
│   ├── kafka.container.ts
│   └── mailhog.container.ts
└── fixtures/
    ├── static/
    │   └── users.json
    └── generators/
        └── user.factory.ts
```

### Vitest Project Config for E2E

```typescript
// vitest.config.e2e.ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    name: 'e2e',
    include: ['e2e/specs/**/*.spec.ts'],
    globalSetup: ['e2e/setup.ts'],
    testTimeout: 60_000,       // containers are slow; be generous
    hookTimeout: 120_000,
    reporters: ['verbose'],
    // Run specs serially within the E2E project to avoid shared-state races.
    // Use --shard for parallelism across CI runners instead.
    sequence: { concurrent: false },
    pool: 'forks',             // each worker gets its own process
  },
  resolve: {
    alias: {
      '@e2e': path.resolve(__dirname, 'e2e'),
    },
  },
});
```

---

## Dependency Management (Docker / Testcontainers)

### Installation

```shell
# Core Testcontainers package
npm install --save-dev testcontainers

# Community modules for specific technologies
npm install --save-dev @testcontainers/postgresql
npm install --save-dev @testcontainers/kafka
npm install --save-dev @testcontainers/localstack

# HTTP client
npm install --save-dev got

# Faker for dynamic fixtures
npm install --save-dev @faker-js/faker
```

### The Dual-Address Pattern

Every Testcontainers container is reachable from two perspectives:

| Perspective              | Address source                              | When to use                          |
|--------------------------|---------------------------------------------|--------------------------------------|
| Test process (host)      | `container.getMappedPort(containerPort)`    | Driver base URLs, DB connections     |
| Other containers (Docker)| Docker alias / service name on shared net   | App container → Postgres, Kafka, etc.|

Mixing these up is one of the most common E2E bugs. Always be explicit about which address you are using:

```typescript
// e2e/resources/postgres.container.ts
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Network } from 'testcontainers';

export interface PostgresAddresses {
  /** Use from the test process to run migrations / seed data */
  hostConnectionString: string;
  /** Use inside the app container's environment variables */
  containerConnectionString: string;
}

export async function startPostgres(
  network: Network,
  alias: string = 'postgres',
): Promise<{ container: StartedPostgreSqlContainer; addresses: PostgresAddresses }> {
  const container = await new PostgreSqlContainer('postgres:16.3-alpine')
    .withNetwork(network)
    .withNetworkAliases(alias)      // inter-container DNS name
    .withDatabase('appdb')
    .withUsername('app')
    .withPassword('secret')
    .withWaitStrategy(
      // Wait until Postgres logs the ready message before returning
      Wait.forLogMessage('database system is ready to accept connections'),
    )
    .start();

  return {
    container,
    addresses: {
      // From the test process: use the randomly mapped host port
      hostConnectionString:
        `postgresql://app:secret@localhost:${container.getMappedPort(5432)}/appdb`,
      // From inside Docker: use the alias and the internal port (5432 is never remapped)
      containerConnectionString:
        `postgresql://app:secret@${alias}:5432/appdb`,
    },
  };
}
```

### Network Setup

Create a named Docker bridge network and attach all containers to it so they can resolve each other by alias:

```typescript
// e2e/resources/network.ts
import { Network } from 'testcontainers';

let sharedNetwork: Network | null = null;

export async function getSharedNetwork(): Promise<Network> {
  if (!sharedNetwork) {
    sharedNetwork = await new Network().start();
  }
  return sharedNetwork;
}

export async function teardownNetwork(): Promise<void> {
  if (sharedNetwork) {
    await sharedNetwork.stop();
    sharedNetwork = null;
  }
}
```

### Image Version Pinning

**Never use `latest`.** Unpinned images make builds non-deterministic and break without warning on CI.

```typescript
// ✅ Good – pinned digest or tag
const pg = new PostgreSqlContainer('postgres:16.3-alpine');
const kafka = new KafkaContainer('confluentinc/cp-kafka:7.6.1');
const redis = new GenericContainer('redis:7.2.5-alpine');

// ❌ Bad – will silently break when the image is updated
const pg = new PostgreSqlContainer('postgres:latest');
const redis = new GenericContainer('redis');
```

### Wait Strategies

```typescript
import { Wait } from 'testcontainers';

// 1. Wait for a specific log line (most reliable for databases)
Wait.forLogMessage('ready to accept connections')

// 2. Wait for the container's HEALTHCHECK instruction to pass
Wait.forHealthCheck()

// 3. Wait until a specific port is listening
Wait.forListeningPorts()

// 4. Combine strategies (all must pass)
Wait.forAll([
  Wait.forListeningPorts(),
  Wait.forLogMessage('Server started'),
])

// 5. HTTP health check – poll until 200
Wait.forHttp('/healthz', 8080).forStatusCode(200)
```

---

## Application Container Lifecycle

### Starting the App Under Test

The application under test runs as a Docker container built from the project's own `Dockerfile`. This
ensures the exact same image that ships to production is what gets tested.

```typescript
// e2e/resources/app.container.ts
import path from 'node:path';
import { GenericContainer, Wait, StartedTestContainer, Network } from 'testcontainers';

export interface AppContainerOptions {
  network: Network;
  postgresUrl: string;   // docker-internal address
  kafkaBrokers: string;  // docker-internal address
  redisUrl: string;
}

export async function startAppContainer(
  opts: AppContainerOptions,
): Promise<StartedTestContainer> {
  const projectRoot = path.resolve(__dirname, '../../');

  const container = await GenericContainer
    .fromDockerfile(projectRoot, 'Dockerfile')
    .withBuildArgs({ NODE_ENV: 'test' })
    .build();

  return container
    .withNetwork(opts.network)
    .withNetworkAliases('app')
    .withExposedPorts(8080)
    .withEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: opts.postgresUrl,          // docker-internal
      KAFKA_BROKERS: opts.kafkaBrokers,        // docker-internal
      REDIS_URL: opts.redisUrl,                // docker-internal
      LOG_LEVEL: 'warn',
    })
    // Wait until /healthz returns 200 before letting tests proceed
    .withWaitStrategy(
      Wait.forHttp('/healthz', 8080)
        .forStatusCode(200)
        .withStartupTimeout(60_000),
    )
    .start();
}
```

### globalSetup / globalTeardown

Vitest's `globalSetup` runs once before all test files and `globalTeardown` runs once after. This is the
correct place to start and stop long-lived containers.

```typescript
// e2e/setup.ts
import type { GlobalSetupContext } from 'vitest/node';
import { getSharedNetwork, teardownNetwork } from './resources/network';
import { startPostgres } from './resources/postgres.container';
import { startKafka } from './resources/kafka.container';
import { startMailhog } from './resources/mailhog.container';
import { startAppContainer } from './resources/app.container';
import { runMigrations } from './resources/migrations';

// Shared state – exported so specs can import base URLs
export let APP_BASE_URL: string;
export let DB_URL: string;

let cleanupFns: Array<() => Promise<void>> = [];

export async function setup(_ctx: GlobalSetupContext): Promise<void> {
  const network = await getSharedNetwork();

  // Start infrastructure containers in parallel
  const [pgResult, kafkaResult, mailhogResult] = await Promise.all([
    startPostgres(network, 'postgres'),
    startKafka(network, 'kafka'),
    startMailhog(network, 'mailhog'),
  ]);

  cleanupFns.push(
    () => pgResult.container.stop(),
    () => kafkaResult.container.stop(),
    () => mailhogResult.container.stop(),
  );

  // Start the application after dependencies are ready
  const appContainer = await startAppContainer({
    network,
    postgresUrl: pgResult.addresses.containerConnectionString,
    kafkaBrokers: kafkaResult.brokerAddress,   // docker-internal
    redisUrl: 'redis://redis:6379',
  });
  cleanupFns.push(() => appContainer.stop());

  // Run DB migrations against the host-accessible URL
  await runMigrations(pgResult.addresses.hostConnectionString);

  // Publish base URLs for specs and drivers
  APP_BASE_URL = `http://localhost:${appContainer.getMappedPort(8080)}`;
  DB_URL = pgResult.addresses.hostConnectionString;

  // Make them available across test files via env vars
  process.env.E2E_APP_BASE_URL = APP_BASE_URL;
  process.env.E2E_DB_URL = DB_URL;

  console.log(`[setup] App ready at ${APP_BASE_URL}`);
}

export async function teardown(): Promise<void> {
  // Stop in reverse order, tolerating individual failures
  for (const fn of cleanupFns.reverse()) {
    try {
      await fn();
    } catch (err) {
      console.error('[teardown] Error stopping container:', err);
    }
  }
  await teardownNetwork();
}
```

### Graceful Shutdown with SIGTERM

When the application container receives SIGTERM (from `container.stop()`), it should drain in-flight
requests and flush buffers. Wire this into your application's entry point:

```typescript
// src/main.ts  (application under test)
import { createServer } from './server';

const server = await createServer();
await server.listen({ port: 8080, host: '0.0.0.0' });

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down gracefully`);
  await server.close();     // stop accepting new connections
  await server.db.destroy(); // flush DB pool
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

---

## Protocol-Agnostic Connector Interfaces

### The `Connector` Interface

Define a minimal abstraction that any transport protocol can implement:

```typescript
// e2e/drivers/connector.ts

/**
 * A Connector translates a typed input into a typed output over some protocol.
 * Specifications depend only on this interface, never on transport details.
 */
export interface Connector<TInput, TOutput> {
  send(input: TInput): Promise<TOutput>;
}

/**
 * A Connector that carries an HTTP-specific contract.
 * The connector still handles serialization, retries, and error mapping internally.
 */
export interface HttpConnector<TInput, TOutput> extends Connector<TInput, TOutput> {
  readonly baseUrl: string;
}

/**
 * A Connector for bidirectional gRPC calls.
 */
export interface GrpcConnector<TInput, TOutput> extends Connector<TInput, TOutput> {
  readonly serviceName: string;
}

/**
 * A Connector for WebSocket message exchanges.
 */
export interface WebSocketConnector<TInput, TOutput> extends Connector<TInput, TOutput> {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
}
```

### Why Protocol Abstraction Matters

```
Specification (create-user.spec.ts)
   │
   │  depends on
   ▼
UserDriver (interface)          ← specifications import this type only
   │
   ├── UserHttpDriver            ← swap in to test REST API
   └── UserGrpcDriver           ← swap in to test gRPC API without changing specs
```

A specification that only depends on `UserDriver` can be run against any protocol by injecting a different
driver implementation. This makes protocol migration tests trivial and keeps specs readable.

---

## Driver Implementation

### HTTP Driver

```typescript
// e2e/drivers/user.http.driver.ts
import got, { type Got, HTTPError } from 'got';

// Domain types – these live in your application's shared type package
export interface CreateUserDto {
  email: string;
  name: string;
  role: 'admin' | 'member';
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt: string;
}

export class UserNotFoundError extends Error {
  constructor(id: string) {
    super(`User ${id} not found`);
    this.name = 'UserNotFoundError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details: unknown,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * UserHttpDriver wraps the User REST API.
 *
 * - Accepts a base URL at construction time (injected from globalSetup).
 * - Returns typed domain objects, never raw HTTP responses.
 * - Maps HTTP status codes to domain errors.
 * - Keeps all HTTP knowledge (headers, status codes, paths) out of specs.
 */
export class UserHttpDriver {
  private readonly client: Got;

  constructor(baseUrl: string) {
    this.client = got.extend({
      prefixUrl: baseUrl,
      responseType: 'json',
      // Throw on non-2xx so we can catch and map them
      throwHttpErrors: true,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      retry: {
        limit: 2,
        statusCodes: [502, 503, 504],  // only retry transient gateway errors
      },
    });
  }

  async createUser(dto: CreateUserDto): Promise<User> {
    try {
      const response = await this.client.post<User>('api/users', { json: dto });
      return response.body;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async getUser(id: string): Promise<User> {
    try {
      const response = await this.client.get<User>(`api/users/${id}`);
      return response.body;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async deleteUser(id: string): Promise<void> {
    try {
      await this.client.delete(`api/users/${id}`);
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async listUsers(params?: { role?: string; limit?: number }): Promise<User[]> {
    try {
      const response = await this.client.get<User[]>('api/users', {
        searchParams: params ?? {},
      });
      return response.body;
    } catch (err) {
      throw this.mapError(err);
    }
  }

  /** Translate HTTP errors into meaningful domain errors. */
  private mapError(err: unknown): Error {
    if (err instanceof HTTPError) {
      const status = err.response.statusCode;
      const body = err.response.body as Record<string, unknown>;

      if (status === 404) {
        return new UserNotFoundError(String(body.id ?? 'unknown'));
      }
      if (status === 400 || status === 422) {
        return new ValidationError(String(body.message ?? 'Validation failed'), body.errors);
      }
      if (status === 409) {
        return new Error(`Conflict: ${body.message}`);
      }
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
```

### Using Plain `fetch` (Alternative to `got`)

```typescript
// e2e/drivers/user.fetch.driver.ts
export class UserFetchDriver {
  constructor(private readonly baseUrl: string) {}

  async createUser(dto: CreateUserDto): Promise<User> {
    const response = await fetch(`${this.baseUrl}/api/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
    });

    if (!response.ok) {
      await this.throwDomainError(response);
    }

    return response.json() as Promise<User>;
  }

  async getUser(id: string): Promise<User> {
    const response = await fetch(`${this.baseUrl}/api/users/${id}`);

    if (response.status === 404) {
      throw new UserNotFoundError(id);
    }
    if (!response.ok) {
      await this.throwDomainError(response);
    }

    return response.json() as Promise<User>;
  }

  async deleteUser(id: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/users/${id}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      await this.throwDomainError(response);
    }
  }

  private async throwDomainError(response: Response): Promise<never> {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    throw new Error(`HTTP ${response.status}: ${body.message ?? response.statusText}`);
  }
}
```

### gRPC Driver

```typescript
// e2e/drivers/user.grpc.driver.ts
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import path from 'node:path';
import type { CreateUserDto, User } from './user.http.driver';

const PROTO_PATH = path.resolve(__dirname, '../../proto/user.proto');

interface UserServiceClient {
  CreateUser(
    req: CreateUserDto,
    cb: (err: grpc.ServiceError | null, res: User) => void,
  ): void;
  GetUser(
    req: { id: string },
    cb: (err: grpc.ServiceError | null, res: User) => void,
  ): void;
  DeleteUser(
    req: { id: string },
    cb: (err: grpc.ServiceError | null, res: Record<string, never>) => void,
  ): void;
}

/**
 * UserGrpcDriver exposes the same domain interface as UserHttpDriver.
 * Specifications that use UserDriver can be wired to either without changes.
 */
export class UserGrpcDriver {
  private client: UserServiceClient;

  constructor(host: string, port: number) {
    const packageDef = protoLoader.loadSync(PROTO_PATH, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const proto = grpc.loadPackageDefinition(packageDef) as any;

    this.client = new proto.user.UserService(
      `${host}:${port}`,
      grpc.credentials.createInsecure(),
    ) as UserServiceClient;
  }

  createUser(dto: CreateUserDto): Promise<User> {
    return new Promise((resolve, reject) => {
      this.client.CreateUser(dto, (err, res) => {
        if (err) reject(this.mapGrpcError(err));
        else resolve(res);
      });
    });
  }

  getUser(id: string): Promise<User> {
    return new Promise((resolve, reject) => {
      this.client.GetUser({ id }, (err, res) => {
        if (err) reject(this.mapGrpcError(err));
        else resolve(res);
      });
    });
  }

  deleteUser(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.DeleteUser({ id }, (err) => {
        if (err) reject(this.mapGrpcError(err));
        else resolve();
      });
    });
  }

  private mapGrpcError(err: grpc.ServiceError): Error {
    if (err.code === grpc.status.NOT_FOUND) {
      return new Error(`User not found: ${err.details}`);
    }
    return new Error(`gRPC error ${err.code}: ${err.message}`);
  }

  close(): void {
    grpc.closeClient(this.client as unknown as grpc.Client);
  }
}
```

---

## Specification Writing

### What a Specification Should Look Like

A specification file:
- Imports the **driver** and **domain types** only — never containers, never HTTP internals.
- Names tests in terms of **business behaviour**, not implementation details.
- Is completely readable by a product manager.

```typescript
// e2e/specs/users/create-user.spec.ts
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { UserHttpDriver } from '@e2e/drivers/user.http.driver';
import { MailhogDriver } from '@e2e/drivers/mailhog.driver';
import { DbDriver } from '@e2e/drivers/db.driver';
import { createUserFixture } from '@e2e/fixtures/generators/user.factory';
import { waitFor } from '@e2e/helpers/wait-for';

// Base URLs are published by globalSetup via environment variables.
// Drivers are constructed here and passed down — specs never access process.env directly.
const userDriver = new UserHttpDriver(process.env.E2E_APP_BASE_URL!);
const mailDriver = new MailhogDriver(process.env.E2E_MAILHOG_URL!);
const db = new DbDriver(process.env.E2E_DB_URL!);

describe('User creation', () => {
  afterEach(async () => {
    // Keep tests hermetic: wipe the users table after each test
    await db.truncate('users', 'email_verifications');
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates a new user and returns their profile', async () => {
    const fixture = createUserFixture({ role: 'member' });

    const created = await userDriver.createUser(fixture);

    expect(created.id).toBeTruthy();
    expect(created.email).toBe(fixture.email);
    expect(created.name).toBe(fixture.name);
    expect(created.role).toBe('member');
  });

  it('makes the new user immediately retrievable', async () => {
    const fixture = createUserFixture();
    const created = await userDriver.createUser(fixture);

    const fetched = await userDriver.getUser(created.id);

    expect(fetched.id).toBe(created.id);
    expect(fetched.email).toBe(fixture.email);
  });

  it('sends a welcome email to the new user', async () => {
    const fixture = createUserFixture();
    await userDriver.createUser(fixture);

    // Email delivery is async – poll until it appears or timeout
    const email = await waitFor(
      () => mailDriver.findLatestEmailTo(fixture.email),
      { timeout: 10_000, interval: 500 },
    );

    expect(email.subject).toBe('Welcome to Acme!');
    expect(email.to).toContain(fixture.email);
  });

  it('persists the user to the database', async () => {
    const fixture = createUserFixture();
    const created = await userDriver.createUser(fixture);

    const dbRecord = await db.findOne('users', { id: created.id });

    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.email).toBe(fixture.email);
  });

  it('rejects duplicate email addresses', async () => {
    const fixture = createUserFixture();
    await userDriver.createUser(fixture);

    await expect(userDriver.createUser(fixture)).rejects.toThrow(/Conflict/);
  });

  it('rejects invalid email format', async () => {
    const fixture = createUserFixture({ email: 'not-an-email' });

    await expect(userDriver.createUser(fixture)).rejects.toThrow(/Validation/);
  });
});
```

### Side-Effect Assertions

```typescript
// e2e/specs/users/delete-user.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { UserHttpDriver, UserNotFoundError } from '@e2e/drivers/user.http.driver';
import { KafkaDriver } from '@e2e/drivers/kafka.driver';
import { waitFor } from '@e2e/helpers/wait-for';

const userDriver = new UserHttpDriver(process.env.E2E_APP_BASE_URL!);
const kafka = new KafkaDriver(process.env.E2E_KAFKA_BROKERS!);

describe('User deletion', () => {
  let userId: string;

  beforeEach(async () => {
    // Seed a user to delete in each test
    const user = await userDriver.createUser({
      email: `user-${crypto.randomUUID()}@example.com`,
      name: 'Test User',
      role: 'member',
    });
    userId = user.id;
  });

  afterEach(async () => {
    // Best-effort cleanup (user may already be deleted by the test)
    await userDriver.deleteUser(userId).catch(() => {});
  });

  it('removes the user from the system', async () => {
    await userDriver.deleteUser(userId);

    await expect(userDriver.getUser(userId)).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('emits a user.deleted event on the Kafka topic', async () => {
    await userDriver.deleteUser(userId);

    const event = await waitFor(
      () => kafka.findEvent('user.deleted', { userId }),
      { timeout: 15_000, interval: 1_000 },
    );

    expect(event).toMatchObject({ userId, type: 'user.deleted' });
  });
});
```

---

## Fixture Management

### Static Fixtures

Static fixtures are JSON files checked into source control. Use them for reference data that almost never
changes (country codes, permission sets, price lists).

```typescript
// e2e/fixtures/static/admin-user.json
{
  "email": "admin@example.com",
  "name": "Test Admin",
  "role": "admin"
}
```

```typescript
// e2e/helpers/load-fixture.ts
import { readFileSync } from 'node:fs';
import path from 'node:path';

const FIXTURE_DIR = path.resolve(__dirname, '../fixtures/static');

export function loadFixture<T>(name: string): T {
  const filePath = path.join(FIXTURE_DIR, `${name}.json`);
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

// Usage
const admin = loadFixture<CreateUserDto>('admin-user');
```

### Dynamic Fixture Factories

For tests that create data, use factory functions that produce randomised valid objects. This eliminates
ordering dependencies between tests and avoids collisions.

```typescript
// e2e/fixtures/generators/user.factory.ts
import { faker } from '@faker-js/faker';
import type { CreateUserDto } from '@e2e/drivers/user.http.driver';

/**
 * Creates a valid CreateUserDto with randomised data.
 * Pass an override object to lock specific fields.
 */
export function createUserFixture(
  overrides: Partial<CreateUserDto> = {},
): CreateUserDto {
  return {
    email: faker.internet.email({ provider: 'test.example.com' }),
    name: faker.person.fullName(),
    role: faker.helpers.arrayElement(['admin', 'member'] as const),
    ...overrides,
  };
}

// e2e/fixtures/generators/order.factory.ts
export interface CreateOrderDto {
  customerId: string;
  items: Array<{ productId: string; quantity: number }>;
  currency: string;
}

export function createOrderFixture(
  customerId: string,
  overrides: Partial<CreateOrderDto> = {},
): CreateOrderDto {
  return {
    customerId,
    items: Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => ({
      productId: faker.string.uuid(),
      quantity: faker.number.int({ min: 1, max: 10 }),
    })),
    currency: 'USD',
    ...overrides,
  };
}
```

### Database Seeding and Cleanup

```typescript
// e2e/helpers/seed.ts
import type { Knex } from 'knex';

/**
 * Seed multiple tables from a fixture map.
 * Call in beforeAll for read-heavy test suites.
 */
export async function seed(
  db: Knex,
  fixtures: Record<string, unknown[]>,
): Promise<void> {
  for (const [table, rows] of Object.entries(fixtures)) {
    await db(table).insert(rows);
  }
}

/**
 * Truncate tables in reverse order to respect foreign keys.
 * Call in afterEach for mutation test suites.
 */
export async function truncate(db: Knex, ...tables: string[]): Promise<void> {
  await db.raw(
    `TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`,
  );
}

// e2e/specs/orders/list-orders.spec.ts  — usage example
describe('List orders', () => {
  beforeAll(async () => {
    await seed(db, {
      users: [{ id: 'u1', email: 'alice@example.com', name: 'Alice', role: 'member' }],
      orders: [
        { id: 'o1', customerId: 'u1', currency: 'USD', status: 'placed' },
        { id: 'o2', customerId: 'u1', currency: 'EUR', status: 'shipped' },
      ],
    });
  });

  afterAll(async () => {
    await truncate(db, 'orders', 'users');
  });

  it('returns all orders for a customer', async () => {
    const orders = await orderDriver.listOrders({ customerId: 'u1' });
    expect(orders).toHaveLength(2);
  });
});
```

---

## CI Configuration

### GitHub Actions Workflow

```yaml
# .github/workflows/e2e.yml
name: E2E Tests

on:
  push:
    branches: [main, 'release/**']
  pull_request:
    branches: [main]

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 30

    strategy:
      fail-fast: false
      matrix:
        shard: [1, 2, 3, 4]   # run 4 shards in parallel

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: npm

      - name: Install dependencies
        run: npm ci

      # Cache Docker image layers to avoid re-pulling on every run.
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Cache Docker layers
        uses: actions/cache@v4
        with:
          path: /tmp/.buildx-cache
          key: ${{ runner.os }}-buildx-${{ hashFiles('Dockerfile', 'package-lock.json') }}
          restore-keys: |
            ${{ runner.os }}-buildx-

      - name: Pre-build app image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          load: true
          tags: myapp:test
          cache-from: type=local,src=/tmp/.buildx-cache
          cache-to: type=local,dest=/tmp/.buildx-cache-new,mode=max

      # Rotate cache to prevent unbounded growth
      - name: Move cache
        run: |
          rm -rf /tmp/.buildx-cache
          mv /tmp/.buildx-cache-new /tmp/.buildx-cache

      - name: Pre-pull infrastructure images
        run: |
          docker pull postgres:16.3-alpine
          docker pull confluentinc/cp-kafka:7.6.1
          docker pull mailhog/mailhog:v1.0.1

      - name: Run E2E tests (shard ${{ matrix.shard }}/4)
        env:
          # Testcontainers settings
          TESTCONTAINERS_RYUK_DISABLED: 'true'    # GitHub Actions runners clean up on exit
          TESTCONTAINERS_CHECKS_DISABLE: 'true'
          # Docker host is available at the default socket path on ubuntu-latest
          DOCKER_HOST: unix:///var/run/docker.sock
        run: |
          npx vitest run \
            --config vitest.config.e2e.ts \
            --shard=${{ matrix.shard }}/4 \
            --reporter=junit \
            --outputFile=test-results/e2e-${{ matrix.shard }}.xml

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-results-shard-${{ matrix.shard }}
          path: test-results/

  # Merge results from all shards into a single report
  report:
    needs: e2e
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Download all test results
        uses: actions/download-artifact@v4
        with:
          pattern: e2e-results-shard-*
          merge-multiple: true
          path: test-results/

      - name: Publish test report
        uses: mikepenz/action-junit-report@v4
        with:
          report_paths: test-results/*.xml
          check_name: E2E Test Results
```

### Key CI Environment Variables

| Variable | Value | Purpose |
|---|---|---|
| `TESTCONTAINERS_RYUK_DISABLED` | `true` | Disable Ryuk reaper when Docker socket is not accessible or when the runner cleans up on exit anyway |
| `TESTCONTAINERS_CHECKS_DISABLE` | `true` | Skip pre-flight Docker API checks (faster startup) |
| `DOCKER_HOST` | `unix:///var/run/docker.sock` or `tcp://...` | Override to use a remote Docker daemon |
| `TESTCONTAINERS_HUB_IMAGE_NAME_PREFIX` | your registry URL | Pull from a private mirror instead of Docker Hub |

### Remote Docker (Testcontainers Cloud)

For teams that cannot run Docker on CI workers, Testcontainers Cloud provides a remote Docker daemon:

```yaml
- name: Setup Testcontainers Cloud Client
  uses: atomicjar/testcontainers-cloud-setup-action@v1
  with:
    token: ${{ secrets.TC_CLOUD_TOKEN }}
```

---

## Assertion Patterns and Verification

### Status and Shape Assertions in Drivers (not Specs)

Status-code assertions live in the driver, not the spec. The spec asserts on domain meaning:

```typescript
// ✅ In the driver (implementation detail)
if (response.status === 201) { return response.json() as User; }
if (response.status === 404) { throw new UserNotFoundError(id); }

// ✅ In the spec (business assertion)
const user = await userDriver.createUser(fixture);
expect(user.id).toBeTruthy();

// ❌ Don't do this in a spec (leaks HTTP knowledge into business logic)
const response = await fetch(`${baseUrl}/api/users`, { method: 'POST', body: ... });
expect(response.status).toBe(201);
```

### Domain State Verification

After a write operation, verify that the system's state changed correctly by reading back through the driver:

```typescript
it('persists role change immediately', async () => {
  const user = await userDriver.createUser(createUserFixture({ role: 'member' }));

  await userDriver.updateUserRole(user.id, 'admin');

  const updated = await userDriver.getUser(user.id);
  expect(updated.role).toBe('admin');
});
```

### Async Side-Effect Verification with `waitFor`

Event-driven systems produce side effects asynchronously. Use a polling helper with timeout:

```typescript
// e2e/helpers/wait-for.ts

export interface WaitOptions {
  /** Maximum milliseconds to wait. Default: 10_000 */
  timeout?: number;
  /** Polling interval in milliseconds. Default: 250 */
  interval?: number;
  /** Human-readable description of what we are waiting for (for error messages) */
  description?: string;
}

/**
 * Polls `condition` until it returns a truthy value or the timeout expires.
 * Returns the first truthy value returned by `condition`.
 *
 * @throws Error if the timeout elapses without a truthy result.
 */
export async function waitFor<T>(
  condition: () => Promise<T | null | undefined | false>,
  options: WaitOptions = {},
): Promise<T> {
  const { timeout = 10_000, interval = 250, description = 'condition' } = options;
  const deadline = Date.now() + timeout;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const result = await condition();
      if (result) return result;
    } catch (err) {
      lastError = err;
    }
    await sleep(interval);
  }

  const message = `waitFor(${description}) timed out after ${timeout}ms`;
  throw lastError instanceof Error
    ? new Error(`${message}: ${lastError.message}`)
    : new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Usage in a spec:
const email = await waitFor(
  async () => {
    const msgs = await mailDriver.findEmailsTo(user.email);
    return msgs.find((m) => m.subject === 'Welcome to Acme!') ?? null;
  },
  { timeout: 10_000, interval: 500, description: 'welcome email' },
);
expect(email.body).toContain('Get started');
```

### Snapshot Testing

Use snapshots for complex, stable response shapes. Store them in source control so changes are reviewed:

```typescript
it('returns the full user profile shape', async () => {
  const fixture = createUserFixture({
    email: 'snapshot@example.com', // fixed to keep snapshot stable
    name: 'Snapshot User',
    role: 'member',
  });

  const user = await userDriver.createUser(fixture);

  // Normalise volatile fields before snapshotting
  const stable = {
    ...user,
    id: '[uuid]',
    createdAt: '[timestamp]',
  };

  expect(stable).toMatchSnapshot();
});
```

---

## Common Pitfalls

### 1. Container Cleanup: Always Use `try/finally`

Leaked containers accumulate quickly and exhaust Docker resources. Guard with `try/finally` in setup code:

```typescript
// ✅ Safe pattern
export async function setup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:16.3-alpine').start();

  try {
    await runMigrations(`postgresql://...@localhost:${container.getMappedPort(5432)}/db`);
    // ... more setup
  } catch (err) {
    // Cleanup immediately if setup fails mid-way
    await container.stop().catch(() => {});
    throw err;
  }

  // Register teardown
  cleanupFns.push(() => container.stop());
}

// ❌ Risky pattern – a throw in runMigrations leaks the container
export async function setup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:16.3-alpine').start();
  await runMigrations(...); // if this throws, container is never stopped
}
```

Ryuk (Testcontainers' background reaper daemon) acts as a last-resort safety net and will clean up
containers if the test process exits unexpectedly. However, Ryuk requires Docker socket access and is
disabled in some environments via `TESTCONTAINERS_RYUK_DISABLED=true`.

### 2. Port Conflicts: Never Hardcode Host Ports

Hardcoded ports cause spurious failures when something else is already bound to that port.

```typescript
// ✅ Let Testcontainers pick a free host port
const container = await new PostgreSqlContainer('postgres:16.3-alpine')
  .withExposedPorts(5432)   // expose the container port
  .start();

const hostPort = container.getMappedPort(5432); // use the randomly assigned host port
const url = `postgresql://app:secret@localhost:${hostPort}/db`;

// ❌ Never do this
const container = await new GenericContainer('postgres:16.3-alpine')
  .withPortBindings({ '5432/tcp': [{ HostPort: '5432' }] }) // hardcoded → collision risk
  .start();
```

### 3. Test Caching: Disable for E2E

Vitest caches test results. In development this is great; in CI it can serve stale results after a
container image change.

```shell
# Disable caching for E2E in CI
npx vitest run --config vitest.config.e2e.ts --cache=false

# Or add to vitest.config.e2e.ts:
test: {
  cache: false,
}
```

In local development, invalidate the cache manually after rebuilding images:

```shell
npx vitest run --config vitest.config.e2e.ts --force
```

### 4. Ordering Dependencies: Tests Must Be Independent

Tests that rely on execution order fail intermittently and are impossible to shard.

```typescript
// ❌ Bad – test 2 depends on test 1 having run first
it('creates a user', async () => {
  createdUserId = (await userDriver.createUser(fixture)).id; // sets outer variable
});

it('deletes the user created above', async () => {
  await userDriver.deleteUser(createdUserId); // fails if test 1 was skipped or reordered
});

// ✅ Good – each test is self-contained
it('deletes a user', async () => {
  const user = await userDriver.createUser(createUserFixture());
  await userDriver.deleteUser(user.id);
  await expect(userDriver.getUser(user.id)).rejects.toBeInstanceOf(UserNotFoundError);
});
```

### 5. Image Pull Latency: Pre-Pull in CI

Cold CI runners must pull images from Docker Hub on every run. Pre-pull in a dedicated step or use a
registry mirror:

```yaml
# Pre-pull all images used by Testcontainers
- name: Pre-pull images
  run: |
    docker pull postgres:16.3-alpine &
    docker pull confluentinc/cp-kafka:7.6.1 &
    docker pull mailhog/mailhog:v1.0.1 &
    wait   # wait for all background pulls to finish
```

For local development, Testcontainers' `reuse` option caches a running container between test runs:

```typescript
// ⚠️ Only use reuse in local development; never in CI
const container = await new PostgreSqlContainer('postgres:16.3-alpine')
  .withReuse()   // reuse an existing container if one is already running
  .start();
```

Activate the reuse feature by setting `TESTCONTAINERS_RYUK_DISABLED=true` and
`testcontainers.reuse.enable=true` in `~/.testcontainers.properties`.

### 6. Non-Determinism: Use UUIDs, Not `Date.now()`

Fixture IDs based on timestamps cause collisions when tests run fast enough that two calls land in the
same millisecond.

```typescript
// ❌ Bad – can collide under parallelism
const userId = `user-${Date.now()}`;

// ✅ Good – universally unique
const userId = crypto.randomUUID();

// ✅ Also good – faker generates realistic unique values
const email = faker.internet.email({ provider: 'test.example.com' });
```

### 7. Container Startup Order

Containers that depend on others must start after their dependencies are ready. Use `Promise.all` for
independent containers, but sequential `await` for dependent ones:

```typescript
// Independent containers – start in parallel
const [pg, kafka] = await Promise.all([
  startPostgres(network),
  startKafka(network),
]);

// App depends on both – start after
const app = await startAppContainer({
  postgresUrl: pg.addresses.containerConnectionString,
  kafkaBrokers: kafka.brokerAddress,
});
```

### 8. Long Health Check Waits in Tests

If you find yourself adding `await sleep(5000)` before making assertions, replace it with a proper
`waitFor` call or add a `/healthz` check to the container:

```typescript
// ❌ Fragile – what if the service takes 6s?
await sleep(5_000);
const result = await driver.doSomething();

// ✅ Robust – wait up to 30s, poll every 500ms
const result = await waitFor(
  () => driver.doSomething().catch(() => null),
  { timeout: 30_000, interval: 500, description: 'service response' },
);
```

---

## Quick-Reference Summary

```
File                           Responsibility
─────────────────────────────────────────────────────────────────
e2e/setup.ts                   globalSetup: start/stop all containers
e2e/vitest.config.e2e.ts       Vitest config for E2E project
e2e/specs/**/*.spec.ts         Business behaviour, no infra imports
e2e/drivers/*.driver.ts        Protocol adapters (HTTP, gRPC, WS)
e2e/resources/*.container.ts   Testcontainers wrappers
e2e/fixtures/static/*.json     Static reference data
e2e/fixtures/generators/*.ts   Faker-based fixture factories
e2e/helpers/wait-for.ts        Async polling utility
e2e/helpers/seed.ts            DB seed + truncate helpers
e2e/helpers/load-fixture.ts    Static fixture loader
```

### The Golden Rules

1. **Specifications never import infrastructure.** They receive a driver; that is all they know.
2. **Drivers never throw HTTP errors.** They throw domain errors.
3. **Ports are always dynamic.** Use `getMappedPort`, never hardcode.
4. **Image versions are always pinned.** No `latest`.
5. **Every test cleans up after itself.** `afterEach` truncates or rolls back.
6. **Async side effects use `waitFor`.** Never `sleep`.
7. **Fixture IDs use `crypto.randomUUID()`.** Never `Date.now()`.

---

*This guideline is part of the TypeScript Guidelines series. See also:*
- *01 – Project Structure*
- *02 – Type System Best Practices*
- *03 – Error Handling*
- *04 – Unit & Integration Testing*
- *06 – Performance & Observability*
