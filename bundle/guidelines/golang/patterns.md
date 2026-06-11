# Design Patterns

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
