# Design Patterns

### Test Tables

Use table-driven tests with subtests to avoid duplicating repetitive test logic. Test tables reduce duplicate logic, add context to error messages, and make it easy to add new test cases.

Use a table-driven test when a system needs testing against *multiple conditions*
with varying inputs and outputs.

**Bad**
```go
// func TestSplitHostPort(t *testing.T)

host, port, err := net.SplitHostPort("192.0.2.0:8000")
require.NoError(t, err)
assert.Equal(t, "192.0.2.0", host)
assert.Equal(t, "8000", port)

host, port, err = net.SplitHostPort("192.0.2.0:http")
require.NoError(t, err)
assert.Equal(t, "192.0.2.0", host)
assert.Equal(t, "http", port)

host, port, err = net.SplitHostPort(":8000")
require.NoError(t, err)
assert.Equal(t, "", host)
assert.Equal(t, "8000", port)

host, port, err = net.SplitHostPort("1:8")
require.NoError(t, err)
assert.Equal(t, "1", host)
assert.Equal(t, "8", port)
```

**Good**
```go
// func TestSplitHostPort(t *testing.T)

tests := []struct{
  give     string
  wantHost string
  wantPort string
}{
  {
    give:     "192.0.2.0:8000",
    wantHost: "192.0.2.0",
    wantPort: "8000",
  },
  {
    give:     "192.0.2.0:http",
    wantHost: "192.0.2.0",
    wantPort: "http",
  },
  {
    give:     ":8000",
    wantHost: "",
    wantPort: "8000",
  },
  {
    give:     "1:8",
    wantHost: "1",
    wantPort: "8",
  },
}

for _, tt := range tests {
  t.Run(tt.give, func(t *testing.T) {
    host, port, err := net.SplitHostPort(tt.give)
    require.NoError(t, err)
    assert.Equal(t, tt.wantHost, host)
    assert.Equal(t, tt.wantPort, port)
  })
}
```

Name the slice of structs `tests` and each case `tt`. Prefix input and output
fields with `give` and `want`.

```go
tests := []struct{
  give     string
  wantHost string
  wantPort string
}{
  // ...
}

for _, tt := range tests {
  // ...
}
```

#### Avoid Unnecessary Complexity in Table Tests

Do **NOT** use table tests when subtests need conditional assertions or branching
logic inside the `for` loop. Complex tables harm readability and make test
failures harder to debug.

Split complex table tests into multiple test tables or individual `Test...`
functions.

Aim for:

* The narrowest unit of behavior
* Minimal "test depth" — avoid conditional assertions
* All table fields used in all test cases
* All test logic runs for all table cases

"Test depth" means successive assertions that depend on previous assertions
holding (similar to cyclomatic complexity). Shallower tests have fewer
interdependent assertions and are less likely to be conditional.

Table tests become confusing when they use multiple branching pathways
(`shouldError`, `expectCall`), `if` statements for mock expectations
(`shouldCallFoo`), or functions inside the table (`setupMocks func(*FooMock)`).

When behavior only changes based on input, group similar cases in a table test
to show how behavior varies across inputs — splitting them into separate
tests makes comparison harder.

A single branching pathway for success vs. failure (e.g. a `shouldErr` field)
is acceptable if the test body is short and straightforward.

**Bad**
```go
func TestComplicatedTable(t *testing.T) {
  tests := []struct {
    give          string
    want          string
    wantErr       error
    shouldCallX   bool
    shouldCallY   bool
    giveXResponse string
    giveXErr      error
    giveYResponse string
    giveYErr      error
  }{
    // ...
  }

  for _, tt := range tests {
    t.Run(tt.give, func(t *testing.T) {
      // setup mocks
      ctrl := gomock.NewController(t)
      xMock := xmock.NewMockX(ctrl)
      if tt.shouldCallX {
        xMock.EXPECT().Call().Return(
          tt.giveXResponse, tt.giveXErr,
        )
      }
      yMock := ymock.NewMockY(ctrl)
      if tt.shouldCallY {
        yMock.EXPECT().Call().Return(
          tt.giveYResponse, tt.giveYErr,
        )
      }

      got, err := DoComplexThing(tt.give, xMock, yMock)

      // verify results
      if tt.wantErr != nil {
        require.EqualError(t, err, tt.wantErr)
        return
      }
      require.NoError(t, err)
      assert.Equal(t, want, got)
    })
  }
}
```

**Good**
```go
func TestShouldCallX(t *testing.T) {
  // setup mocks
  ctrl := gomock.NewController(t)
  xMock := xmock.NewMockX(ctrl)
  xMock.EXPECT().Call().Return("XResponse", nil)

  yMock := ymock.NewMockY(ctrl)

  got, err := DoComplexThing("inputX", xMock, yMock)

  require.NoError(t, err)
  assert.Equal(t, "want", got)
}

func TestShouldCallYAndFail(t *testing.T) {
  // setup mocks
  ctrl := gomock.NewController(t)
  xMock := xmock.NewMockX(ctrl)

  yMock := ymock.NewMockY(ctrl)
  yMock.EXPECT().Call().Return("YResponse", nil)

  _, err := DoComplexThing("inputY", xMock, yMock)
  assert.EqualError(t, err, "Y failed")
}
```

This complexity makes tests harder to change, understand, and verify.

Prioritize readability and maintainability when choosing between table tests
and separate test functions.

#### Parallel Tests

In parallel tests and loops that spawn goroutines or capture references,
explicitly assign loop variables inside the loop body to ensure they hold the
expected values.

```go
tests := []struct{
  give string
  // ...
}{
  // ...
}

for _, tt := range tests {
  t.Run(tt.give, func(t *testing.T) {
    t.Parallel()
    // ...
  })
}
```

The `tt` variable must be scoped to the loop iteration because of
`t.Parallel()`. Without it, most tests will receive an unexpected or changing
value for `tt`.

<!-- TODO: Explain how to use _test packages. -->

### Functional Options

Functional options is a pattern where an opaque `Option` type records
information in an internal struct. A variadic number of options is accepted and
applied to configure the struct.

Use this pattern for optional constructor and public API arguments you expect
to expand, especially with three or more arguments.

**Bad**
```go
// package db

func Open(
  addr string,
  cache bool,
  logger *zap.Logger
) (*Connection, error) {
  // ...
}
```

**Good**
```go
// package db

type Option interface {
  // ...
}

func WithCache(c bool) Option {
  // ...
}

func WithLogger(log *zap.Logger) Option {
  // ...
}

// Open creates a connection.
func Open(
  addr string,
  opts ...Option,
) (*Connection, error) {
  // ...
}
```

**Bad**
The cache and logger parameters must always be provided, even if the user
wants to use the default.

```go
db.Open(addr, db.DefaultCache, zap.NewNop())
db.Open(addr, db.DefaultCache, log)
db.Open(addr, false /* cache */, zap.NewNop())
db.Open(addr, false /* cache */, log)
```

**Good**
Options are provided only if needed.

```go
db.Open(addr)
db.Open(addr, db.WithLogger(log))
db.Open(addr, db.WithCache(false))
db.Open(
  addr,
  db.WithCache(false),
  db.WithLogger(log),
)
```

Our preferred implementation uses an `Option` interface with an unexported
method that records options on an unexported `options` struct.

```go
type options struct {
  cache  bool
  logger *zap.Logger
}

type Option interface {
  apply(*options)
}

type cacheOption bool

func (c cacheOption) apply(opts *options) {
  opts.cache = bool(c)
}

func WithCache(c bool) Option {
  return cacheOption(c)
}

type loggerOption struct {
  Log *zap.Logger
}

func (l loggerOption) apply(opts *options) {
  opts.logger = l.Log
}

func WithLogger(log *zap.Logger) Option {
  return loggerOption{Log: log}
}

// Open creates a connection.
func Open(
  addr string,
  opts ...Option,
) (*Connection, error) {
  options := options{
    cache:  defaultCache,
    logger: zap.NewNop(),
  }

  for _, o := range opts {
    o.apply(&options)
  }

  // ...
}
```

This pattern is preferred over closures because it gives authors more
flexibility and is easier to debug and test. Options can be compared in tests
and mocks (impossible with closures) and can implement interfaces like
`fmt.Stringer` for readable string representations.

See also,

- Self-referential functions and the design of options
- Functional options for friendly APIs

<!-- TODO: replace this with parameter structs and functional options, when to
use one vs other -->
