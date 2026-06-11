# End-to-End Testing

## Problem

You need reliable end-to-end tests for a Go service (gRPC, REST, or event-driven) that verify real behavior against real dependencies — databases, caches, mock external APIs — without mocking at the code level. Unit tests alone can't catch integration bugs, configuration mismatches, or container networking issues. You want tests that are protocol-agnostic so swapping gRPC for HTTP doesn't force a rewrite of all test scenarios.

## Prerequisites

- **Docker** running locally (for testcontainers)
- **CI runner** with Docker-in-Docker support (for pipeline execution)
- **Packages**: `testcontainers-go`, `testify` (assert + require), `gjson`, `golang-jwt`

## Architecture: Four Layers

The e2e test suite separates concerns into four layers, each with a single responsibility ^[extracted]:

```
┌─────────────────────────────────────────────┐
│  Test Entry Point (e2e/<service>_test.go)    │  Orchestrate infrastructure, create driver, run specs
├─────────────────────────────────────────────┤
│  Specifications (e2e/specifications/)        │  Business-level test scenarios — protocol agnostic
├─────────────────────────────────────────────┤
│  Driver (e2e/driver/)                        │  Translates interfaces into protocol-specific I/O
├─────────────────────────────────────────────┤
│  Resources (e2e/resources/)                  │  Docker containers and external dependencies
└─────────────────────────────────────────────┘
```

This separation means swapping protocols only requires writing a new driver — specifications never change. This architecture is a concrete implementation of the specification-pattern.

## Procedure

### Step 1: Set Up Directory Structure

```
e2e/
├── <service>_test.go
├── driver/
│   └── <protocol>.go
├── resources/
│   ├── application.go
│   ├── network.go
│   ├── <dependency>.go   (postgres.go, redis.go, wiremock.go, etc.)
│   └── logconsumer.go
├── specifications/
│   ├── connector.go      (interfaces + helpers)
│   └── <feature>.go
└── fixtures/
    ├── read.go
    ├── <data_helpers>.go
    └── <static_data>/
```

### Step 2: Create the Docker Network

All containers share a single Docker network for internal DNS resolution. Create it once per test function ^[extracted]:

```go
func SetupNetwork(t testing.TB) NetworkResource {
    ctx := context.Background()
    net, err := network.New(ctx,
        network.WithCheckDuplicate(),
        network.WithAttachable(),
        network.WithDriver("bridge"),
    )
    require.NoError(t, err)
    t.Cleanup(func() { _ = net.Remove(ctx) })
    return NetworkResource{Name: net.Name}
}
```

Key: `t.Cleanup` ensures the network is removed after the test, even on failure.

### Step 3: Start Dependencies (Before the App)

Each dependency follows the same pattern: `Options` struct → `Resource` struct → `Start<Name>(t, opts) Resource` ^[extracted].

Every `Start*` function registers `t.Cleanup` to terminate the container. Examples:

- **Postgres**: Use `testcontainers-go/modules/postgres`, pass init scripts for schema + seed data
- **Redis**: Use `testcontainers-go/modules/redis`, specify image tag
- **WireMock**: Mount a mappings directory, expose port, capture requests for audit assertions

**Critical: Dual-address pattern** — every dependency returns two addresses ^[extracted]:

| Address | Used by | Example |
|---------|---------|---------|
| **Internal** (`container-name:port`) | Application container → dependency | `http://wiremock:9001` |
| **Host-mapped** (`localhost:<random-port>`) | Test code → container | `http://localhost:54321` |

Always pass internal addresses as env vars to the application. Use host-mapped ports in the driver.

### Step 4: Build and Start the Application Container

Build from a `Dockerfile.e2e` (multi-stage: Go build → minimal Debian image). Wait for readiness with a protocol-appropriate strategy ^[extracted]:

```go
func StartApplication(t testing.TB, opts AppResourceOptions) AppResource {
    req := testcontainers.ContainerRequest{
        FromDockerfile: testcontainers.FromDockerfile{
            Context: "../", Dockerfile: "Dockerfile.e2e",
        },
        ExposedPorts: []string{fmt.Sprintf("%s/tcp", opts.Port)},
        Env:          opts.Env,
        Networks:     opts.Docker.Networks,
        WaitingFor: wait.ForAll(
            wait.ForLog("server started").WithStartupTimeout(15*time.Second),
            wait.ForListeningPort(appPort).WithStartupTimeout(15*time.Second),
        ),
    }
    // ... create container, get hostPort, register cleanup
    return AppResource{HostPort: hostPort.Port()}
}
```

Wait strategy by protocol:
- **gRPC**: `wait.ForLog("starting grpc server")` + `wait.ForListeningPort(port)`
- **REST**: `wait.ForHTTP("/healthz").WithPort(port)`
- **Worker/Consumer**: `wait.ForLog("consumer started")`

Attach a log consumer to any container for debugging: `LogConsumerCfg: LogConsumerConfig()`.

### Step 5: Define the Connector Interface

In `e2e/specifications/connector.go`, define protocol-agnostic interfaces that serve as the contract between specs and drivers ^[extracted]:

```go
type APIClient interface {
    CreateOrder(ctx context.Context, jsonBody string, headers map[string][]string) (Response, error)
    GetOrder(ctx context.Context, orderID string, headers map[string][]string) (Response, error)
}

type Response struct {
    Content  string              // JSON body
    Metadata map[string][]string // Headers (HTTP) or trailing metadata (gRPC)
}
```

Rules:
- Use `string` for request/response bodies (JSON). Keeps the interface serialization-agnostic.
- Use `map[string][]string` for headers/metadata. Compatible with both HTTP and gRPC.
- Define one interface per logical concern.

### Step 6: Write the Driver

Implement the connector interface for your protocol. The driver translates interface calls into protocol-specific I/O ^[extracted].

HTTP driver pattern:
```go
type HTTPDriver struct {
    baseURL string
    client  *http.Client
}

func (d *HTTPDriver) CreateOrder(ctx context.Context, jsonBody string, headers map[string][]string) (specifications.Response, error) {
    return d.do(ctx, http.MethodPost, "/api/v1/orders", jsonBody, headers)
}
```

gRPC driver pattern:
```go
type GRPCDriver struct {
    client protov1.YourServiceClient
}

func (d *GRPCDriver) YourMethod(ctx context.Context, jsonRequest string, metadata map[string][]string) (specifications.Response, error) {
    // Unmarshal JSON → protobuf, call gRPC, marshal protobuf → JSON response
}
```

### Step 7: Write Specifications

Specifications are pure test logic using the specification-pattern. Each is a function that accepts an interface and returns `func(t *testing.T)` ^[extracted]:

```go
func CreateOrderReturnsCreatedResource(api APIClient) func(t *testing.T) {
    return func(t *testing.T) {
        ctx := context.Background()
        body := `{"customer_id": "cust-123", "items": [{"product_id": "prod-1", "quantity": 2}]}`
        headers := metadataPairs("Authorization", "Bearer valid-token")

        response, err := api.CreateOrder(ctx, body, headers)
        require.NoError(t, err)

        assert.Equal(t, "created", gjson.Get(response.Content, "status").String())
        assert.NotEmpty(t, gjson.Get(response.Content, "id").String())
    }
}
```

For side-effect assertions (audit logs, messages, DB rows), inject assertion functions as parameters:

```go
func CreateOrderSendsAuditEvent(api APIClient, assertAudit func(t testing.TB, expected string)) func(t *testing.T) {
    // ... act, then call assertAudit(t, expectedJSON)
}
```

### Step 8: Manage Fixtures

Static fixtures go under `e2e/fixtures/` organized by category ^[extracted]:

```
fixtures/
├── migrations/          # SQL schema + seed files
├── seed_data/           # Pre-populated test records
├── mock_responses/      # WireMock JSON mappings
├── jwt_private_key.pem  # Signing keys
└── redis.conf           # Service configs
```

Provide a `fixtures.Read(t, filename)` helper and a `fixtures.Path(t, filename)` helper. For dynamic data (JWTs, signed payloads), create generator functions like `fixtures.CreateJWTToken(t, keyID, keyFile, claims)`.

### Step 9: Wire the Test Entry Point

The test file orchestrates everything ^[extracted]:

```go
func TestServiceName(t *testing.T) {
    if testing.Short() { t.Skip("skipping e2e tests in short mode") }

    network := resources.SetupNetwork(t)
    db := resources.StartPostgres(t, resources.PostgresOptions{...})
    wiremock := resources.StartWiremock(t, resources.WiremockOptions{...})

    env := map[string]string{
        "DATABASE_URL":    db.InternalAddr,
        "PAYMENT_API_URL": wiremock.InternalURL,
    }
    app := resources.StartApplication(t, resources.AppResourceOptions{Port: "8080", Env: env, ...})

    driver := driver.NewHTTPDriver(fmt.Sprintf("http://localhost:%s", app.HostPort))

    t.Run("health", specifications.HealthCheckSpecification(driver))
    t.Run("create order", specifications.CreateOrderReturnsCreatedResource(driver))
    t.Run("side effects", specifications.CreateOrderSendsAuditEvent(driver, auditAsserter.Assert))
}
```

For different configurations (e.g., Redis vs in-memory cache), use separate `Test*` functions with different env setups.

### Step 10: Configure CI

Use `testing.Short()` to skip e2e in unit test runs. Separate targets in Taskfile/Makefile ^[extracted]:

```yaml
test:e2e:
  cmds:
    - go test -race -count=1 -cover ./e2e/...
test:unit:
  cmds:
    - go test -short -race -count=1 -cover ./...
```

CI needs Docker-in-Docker:
```yaml
e2e_test:
  image: golang:1.24
  services:
    - docker:dind
  variables:
    DOCKER_HOST: "tcp://docker:2375"
  script:
    - go test -race -count=1 ./e2e/...
```

Key flags: `-race` (detect races), `-count=1` (disable caching — containers are ephemeral), `-cover` (coverage).

## Assertion Patterns

| Goal | Tool | Example |
|------|------|---------|
| Full JSON match (order-insensitive) | `assert.JSONEq` | `assert.JSONEq(t, expected, response.Content)` |
| Partial JSON field extraction | `gjson` | `gjson.Get(response.Content, "status").String()` |
| Header/metadata checks | Response.Metadata | `response.Metadata["X-Cache-Status"][0]` |
| Error presence + message | `require.Error` + `require.ErrorContains` | `require.ErrorContains(t, err, "not found")` |
| JWT claims | `golang-jwt` parse + `assert.JSONEq` | Parse unverified, assert claims subset |
| Side effects (audit, events) | WireMock admin API | `GET /__admin/requests` to find captured requests |

## Verification

1. **Local**: `go test -race -count=1 ./e2e/...` — all specs pass against real containers
2. **CI**: Pipeline passes with Docker-in-Docker, artifacts include `coverage.out`
3. **Protocol swap**: Change only the driver in the test entry point — all specs should pass unmodified

## Pitfalls

- **Test caching**: Always use `-count=1` — Go's test cache doesn't know containers are ephemeral.
- **Container naming**: Use fixed names (`"test-postgres"`, etc.) for internal DNS. Random names break the dual-address pattern.
- **Cleanup ordering**: `t.Cleanup` runs LIFO. Dependencies started first will be cleaned up last — this is correct (app stops before DB).
- **Port conflicts**: Let Docker assign random host ports via `MappedPort()`. Never hardcode ports.
- **Dockerfile.e2e**: Must be separate from production Dockerfile. The e2e build context is `../` from `e2e/`.

