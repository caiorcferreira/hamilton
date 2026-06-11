# End-to-End Testing

## Problem

You need reliable e2e tests for a Go service (gRPC, REST, or event-driven) that
verify real behavior against real dependencies — databases, caches, mock
external APIs — without code-level mocking. Unit tests miss integration bugs,
config mismatches, and container networking issues. Tests should be
protocol-agnostic so swapping gRPC for HTTP doesn't require rewriting scenarios.

## Prerequisites

- **Docker** running locally (for testcontainers)
- **CI runner** with Docker-in-Docker support
- **Packages**: `testcontainers-go`, `testify` (assert + require), `gjson`, `golang-jwt`

## Architecture: Four Layers

Four layers, each with a single responsibility:

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

Swapping protocols only requires a new driver — specifications never change.

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

All containers share one Docker network for internal DNS. Create once per test:

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

`t.Cleanup` removes the network after the test, even on failure.

### Step 3: Start Dependencies (Before the App)

Each dependency follows the pattern: `Options` struct → `Resource` struct →
`Start<Name>(t, opts) Resource`.

Every `Start*` function registers `t.Cleanup` to terminate the container:

- **Postgres**: `testcontainers-go/modules/postgres`, init scripts for schema + seed
- **Redis**: `testcontainers-go/modules/redis`, specify image tag
- **WireMock**: Mount mappings directory, expose port, capture requests for audit assertions

**Dual-address pattern** — every dependency returns two addresses:

| Address | Used by | Example |
|---------|---------|---------|
| **Internal** (`container-name:port`) | App → dependency | `http://wiremock:9001` |
| **Host-mapped** (`localhost:<random-port>`) | Test code → container | `http://localhost:54321` |

Pass internal addresses as env vars to the app. Use host-mapped ports in the driver.

### Step 4: Build and Start the Application Container

Build from `Dockerfile.e2e` (multi-stage: Go build → minimal Debian image).
Pick a protocol-appropriate wait strategy:

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

Wait strategies by protocol:
- **gRPC**: `wait.ForLog("starting grpc server")` + `wait.ForListeningPort(port)`
- **REST**: `wait.ForHTTP("/healthz").WithPort(port)`
- **Worker/Consumer**: `wait.ForLog("consumer started")`

Attach a log consumer for debugging: `LogConsumerCfg: LogConsumerConfig()`.

### Step 5: Define the Connector Interface

In `e2e/specifications/connector.go`, define protocol-agnostic interfaces as
the contract between specs and drivers:

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
- Use `string` for request/response bodies (JSON) — serialization-agnostic.
- Use `map[string][]string` for headers/metadata — compatible with HTTP and gRPC.
- One interface per logical concern.

### Step 6: Write the Driver

Implement the connector interface for your protocol. The driver translates
interface calls into protocol-specific I/O.

HTTP driver:
```go
type HTTPDriver struct {
    baseURL string
    client  *http.Client
}

func (d *HTTPDriver) CreateOrder(ctx context.Context, jsonBody string, headers map[string][]string) (specifications.Response, error) {
    return d.do(ctx, http.MethodPost, "/api/v1/orders", jsonBody, headers)
}
```

gRPC driver:
```go
type GRPCDriver struct {
    client protov1.YourServiceClient
}

func (d *GRPCDriver) YourMethod(ctx context.Context, jsonRequest string, metadata map[string][]string) (specifications.Response, error) {
    // Unmarshal JSON → protobuf, call gRPC, marshal protobuf → JSON response
}
```

### Step 7: Write Specifications

Specifications are pure test logic. Each accepts an interface and returns
`func(t *testing.T)`:

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

For side-effect assertions (audit logs, messages, DB rows), inject assertion
functions:

```go
func CreateOrderSendsAuditEvent(api APIClient, assertAudit func(t testing.TB, expected string)) func(t *testing.T) {
    // ... act, then call assertAudit(t, expectedJSON)
}
```

### Step 8: Manage Fixtures

Static fixtures under `e2e/fixtures/`, organized by category:

```
fixtures/
├── migrations/          # SQL schema + seed files
├── seed_data/           # Pre-populated test records
├── mock_responses/      # WireMock JSON mappings
├── jwt_private_key.pem  # Signing keys
└── redis.conf           # Service configs
```

Provide `fixtures.Read(t, filename)` and `fixtures.Path(t, filename)` helpers.
For dynamic data (JWTs, signed payloads), create generators like
`fixtures.CreateJWTToken(t, keyID, keyFile, claims)`.

### Step 9: Wire the Test Entry Point

The test file orchestrates everything:

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

For different configurations (e.g., Redis vs in-memory cache), use separate
`Test*` functions with different env setups.

### Step 10: Configure CI

Skip e2e in unit runs with `testing.Short()`. Separate targets in
Taskfile/Makefile:

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

Key flags: `-race` (race detection), `-count=1` (disable caching — containers
are ephemeral), `-cover` (coverage).

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

1. **Local**: `go test -race -count=1 ./e2e/...` — all specs pass
2. **CI**: Pipeline passes with Docker-in-Docker, artifacts include `coverage.out`
3. **Protocol swap**: Change only the driver — all specs pass unmodified

## Pitfalls

- **Test caching**: Always use `-count=1`. Go's cache doesn't know containers are ephemeral.
- **Container naming**: Use fixed names (`"test-postgres"`) for internal DNS. Random names break the dual-address pattern.
- **Cleanup ordering**: `t.Cleanup` runs LIFO — dependencies started first are cleaned up last (app stops before DB).
- **Port conflicts**: Let Docker assign random host ports via `MappedPort()`. Never hardcode.
- **Dockerfile.e2e**: Separate from the production Dockerfile. The e2e build context is `../` from `e2e/`.
