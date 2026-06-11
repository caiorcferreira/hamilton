# Go Style Guide

- [Guidelines](#guidelines)
  - [Pointers to Interfaces](#pointers-to-interfaces)
  - [Verify Interface Compliance](#verify-interface-compliance)
  - [Receivers and Interfaces](#receivers-and-interfaces)
  - [Zero-value Mutexes are Valid](#zero-value-mutexes-are-valid)
  - [Copy Slices and Maps at Boundaries](#copy-slices-and-maps-at-boundaries)
  - [Defer to Clean Up](#defer-to-clean-up)
  - [Channel Size is One or None](#channel-size-is-one-or-none)
  - [Start Enums at One](#start-enums-at-one)
  - [Use `"time"` to handle time](#use-time-to-handle-time)
  - [Errors](#errors)
    - [Error Types](#error-types)
    - [Error Wrapping](#error-wrapping)
    - [Error Naming](#error-naming)
    - [Handle Errors Once](#handle-errors-once)
  - [Handle Type Assertion Failures](#handle-type-assertion-failures)
  - [Don't Panic](#dont-panic)
  - [Avoid Mutable Globals](#avoid-mutable-globals)
  - [Avoid Embedding Types in Public Structs](#avoid-embedding-types-in-public-structs)
  - [Avoid Using Built-In Names](#avoid-using-built-in-names)
  - [Avoid `init()`](#avoid-init)
  - [Exit in Main](#exit-in-main)
    - [Exit Once](#exit-once)
  - [Use field tags in marshaled structs](#use-field-tags-in-marshaled-structs)
  - [Don't fire-and-forget goroutines](#dont-fire-and-forget-goroutines)
    - [Wait for goroutines to exit](#wait-for-goroutines-to-exit)
    - [No goroutines in `init()`](#no-goroutines-in-init)
- [Performance](#performance)
  - [Prefer strconv over fmt](#prefer-strconv-over-fmt)
  - [Avoid repeated string-to-byte conversions](#avoid-repeated-string-to-byte-conversions)
  - [Prefer Specifying Container Capacity](#prefer-specifying-container-capacity)
- [Style](#style)
  - [Avoid overly long lines](#avoid-overly-long-lines)
  - [Be Consistent](#be-consistent)
  - [Group Similar Declarations](#group-similar-declarations)
  - [Import Group Ordering](#import-group-ordering)
  - [Package Names](#package-names)
  - [Function Names](#function-names)
  - [Import Aliasing](#import-aliasing)
  - [Function Grouping and Ordering](#function-grouping-and-ordering)
  - [Reduce Nesting](#reduce-nesting)
  - [Unnecessary Else](#unnecessary-else)
  - [Top-level Variable Declarations](#top-level-variable-declarations)
  - [Prefix Unexported Globals with _](#prefix-unexported-globals-with-_)
  - [Embedding in Structs](#embedding-in-structs)
  - [Local Variable Declarations](#local-variable-declarations)
  - [nil is a valid slice](#nil-is-a-valid-slice)
  - [Reduce Scope of Variables](#reduce-scope-of-variables)
  - [Avoid Naked Parameters](#avoid-naked-parameters)
  - [Use Raw String Literals to Avoid Escaping](#use-raw-string-literals-to-avoid-escaping)
  - [Initializing Structs](#initializing-structs)
    - [Use Field Names to Initialize Structs](#use-field-names-to-initialize-structs)
    - [Omit Zero Value Fields in Structs](#omit-zero-value-fields-in-structs)
    - [Use `var` for Zero Value Structs](#use-var-for-zero-value-structs)
    - [Initializing Struct References](#initializing-struct-references)
  - [Initializing Maps](#initializing-maps)
  - [Format Strings outside Printf](#format-strings-outside-printf)
  - [Naming Printf-style Functions](#naming-printf-style-functions)


## Guidelines

### Pointers to Interfaces

You almost never need a pointer to an interface. Pass interfaces as values—the
underlying data can still be a pointer.

An interface is two fields:

1. A pointer to type-specific information ("type").
2. A data pointer. If the data is a pointer, it's stored directly. If it's a
   value, a pointer to the value is stored.

To let interface methods modify the underlying data, use a pointer.

### Verify Interface Compliance

Verify interface compliance at compile time where appropriate:

- Exported types required to implement specific interfaces by their API contract
- Types in a collection implementing the same interface
- Cases where violating an interface would break users

**Bad**
```go
type Handler struct {
  // ...
}



func (h *Handler) ServeHTTP(
  w http.ResponseWriter,
  r *http.Request,
) {
  ...
}
```

**Good**
```go
type Handler struct {
  // ...
}

var _ http.Handler = (*Handler)(nil)

func (h *Handler) ServeHTTP(
  w http.ResponseWriter,
  r *http.Request,
) {
  // ...
}
```

`var _ http.Handler = (*Handler)(nil)` fails to compile if `*Handler` stops
matching `http.Handler`.

Use the zero value of the asserted type on the right-hand side: `nil` for
pointers, slices, and maps; an empty struct for struct types.

```go
type LogHandler struct {
  h   http.Handler
  log *zap.Logger
}

var _ http.Handler = LogHandler{}

func (h LogHandler) ServeHTTP(
  w http.ResponseWriter,
  r *http.Request,
) {
  // ...
}
```

### Receivers and Interfaces

Methods with value receivers can be called on both pointers and values.
Methods with pointer receivers can only be called on pointers or addressable values.

For example,

```go
type S struct {
  data string
}

func (s S) Read() string {
  return s.data
}

func (s *S) Write(str string) {
  s.data = str
}

// We cannot get pointers to values stored in maps, because they are not
// addressable values.
sVals := map[int]S{1: {"A"}}

// We can call Read on values stored in the map because Read
// has a value receiver, which does not require the value to
// be addressable.
sVals[1].Read()

// We cannot call Write on values stored in the map because Write
// has a pointer receiver, and it's not possible to get a pointer
// to a value stored in a map.
//
//  sVals[1].Write("test")

sPtrs := map[int]*S{1: {"A"}}

// You can call both Read and Write if the map stores pointers,
// because pointers are intrinsically addressable.
sPtrs[1].Read()
sPtrs[1].Write("test")
```

An interface can be satisfied by a pointer even if the method uses a value
receiver.

```go
type F interface {
  f()
}

type S1 struct{}

func (s S1) f() {}

type S2 struct{}

func (s *S2) f() {}

s1Val := S1{}
s1Ptr := &S1{}
s2Val := S2{}
s2Ptr := &S2{}

var i F
i = s1Val
i = s1Ptr
i = s2Ptr

// The following doesn't compile, since s2Val is a value, and there is no value receiver for f.
//   i = s2Val
```

Effective Go has a good write up on Pointers vs. Values.

### Zero-value Mutexes are Valid

The zero-value of `sync.Mutex` and `sync.RWMutex` is valid. You almost never
need a pointer to a mutex.

**Bad**
```go
mu := new(sync.Mutex)
mu.Lock()
```

**Good**
```go
var mu sync.Mutex
mu.Lock()
```

If you take a struct by pointer, the mutex should be a non-pointer field. Do
not embed the mutex, even on unexported structs.

**Bad**
```go
type SMap struct {
  sync.Mutex

  data map[string]string
}

func NewSMap() *SMap {
  return &SMap{
    data: make(map[string]string),
  }
}

func (m *SMap) Get(k string) string {
  m.Lock()
  defer m.Unlock()

  return m.data[k]
}
```

**Good**
```go
type SMap struct {
  mu sync.Mutex

  data map[string]string
}

func NewSMap() *SMap {
  return &SMap{
    data: make(map[string]string),
  }
}

func (m *SMap) Get(k string) string {
  m.mu.Lock()
  defer m.mu.Unlock()

  return m.data[k]
}
```

**Bad**
The `Mutex` field, and the `Lock` and `Unlock` methods are unintentionally part
of the exported API of `SMap`.

**Good**
The mutex and its methods are implementation details of `SMap` hidden from its
callers.

### Copy Slices and Maps at Boundaries

Slices and maps contain pointers to underlying data. Copy them at boundaries
where callers might mutate the data.

#### Receiving Slices and Maps

Users can modify a map or slice you received as an argument if you store a
reference to it.

**Bad**
```go
func (d *Driver) SetTrips(trips []Trip) {
  d.trips = trips
}

trips := ...
d1.SetTrips(trips)

// Did you mean to modify d1.trips?
trips[0] = ...
```

**Good**
```go
func (d *Driver) SetTrips(trips []Trip) {
  d.trips = make([]Trip, len(trips))
  copy(d.trips, trips)
}

trips := ...
d1.SetTrips(trips)

// We can now modify trips[0] without affecting d1.trips.
trips[0] = ...
```

#### Returning Slices and Maps

Similarly, be wary of callers modifying maps or slices that expose internal state.

**Bad**
```go
type Stats struct {
  mu sync.Mutex
  counters map[string]int
}

// Snapshot returns the current stats.
func (s *Stats) Snapshot() map[string]int {
  s.mu.Lock()
  defer s.mu.Unlock()

  return s.counters
}

// snapshot is no longer protected by the mutex, so any
// access to the snapshot is subject to data races.
snapshot := stats.Snapshot()
```

**Good**
```go
type Stats struct {
  mu sync.Mutex
  counters map[string]int
}

func (s *Stats) Snapshot() map[string]int {
  s.mu.Lock()
  defer s.mu.Unlock()

  result := make(map[string]int, len(s.counters))
  for k, v := range s.counters {
    result[k] = v
  }
  return result
}

// Snapshot is now a copy.
snapshot := stats.Snapshot()
```

### Defer to Clean Up

Use `defer` to clean up resources such as files and locks.

**Bad**
```go
p.Lock()
if p.count < 10 {
  p.Unlock()
  return p.count
}

p.count++
newCount := p.count
p.Unlock()

return newCount

// easy to miss unlocks due to multiple returns
```

**Good**
```go
p.Lock()
defer p.Unlock()

if p.count < 10 {
  return p.count
}

p.count++
return p.count

// more readable
```

`defer` has negligible overhead. Avoid it only in nanosecond-scale functions.
The readability win far outweighs the cost, especially in larger methods.

### Channel Size is One or None

Channels should be unbuffered (size zero) or have a size of one. Any other size
requires strong scrutiny. Consider what prevents the channel from filling under
load, blocking writers, and the consequences.

**Bad**
```go
// Ought to be enough for anybody!
c := make(chan int, 64)
```

**Good**
```go
// Size of one
c := make(chan int, 1) // or
// Unbuffered channel, size of zero
c := make(chan int)
```

### Start Enums at One

The standard way to introduce enumerations in Go is to declare a custom type
and a `const` group with `iota`. Since variables default to the zero value,
enums should typically start at a non-zero value.

**Bad**
```go
type Operation int

const (
  Add Operation = iota
  Subtract
  Multiply
)

// Add=0, Subtract=1, Multiply=2
```

**Good**
```go
type Operation int

const (
  Add Operation = iota + 1
  Subtract
  Multiply
)

// Add=1, Subtract=2, Multiply=3
```

Zero-value enums are appropriate only when the zero value is the desirable
default behavior.

```go
type LogOutput int

const (
  LogToStdout LogOutput = iota
  LogToFile
  LogToRemote
)

// LogToStdout=0, LogToFile=1, LogToRemote=2
```

### Use `"time"` to handle time

Time is complicated. Don't assume a day is 24 hours or an hour is 60 minutes.

Use `time.Time` for instants and `time.Duration` for periods.

Use `time.Before` and `time.After` for comparisons, not `time.Time.Sub`.

Prefer `time.AddDate`, `time.Add`, and `time.Until` over arithmetic on
`time.Duration`.

Format and parse with `time.Format` and `time.Parse`, not `time.String`.

**Bad**
```go
func isActive(now, start, stop int) bool {
  return start <= now && now < stop
}
```

**Good**
```go
func isActive(now, start, stop time.Time) bool {
  return (start.Before(now) || start.Equal(now)) && now.Before(stop)
}
```

**Bad**
```go
func poll(delay int) {
  for {
    // ...
    time.Sleep(time.Duration(delay) * time.Millisecond)
  }
}

poll(10) // was that seconds or milliseconds?
```

**Good**
```go
func poll(delay time.Duration) {
  for {
    // ...
    time.Sleep(delay)
  }
}

poll(10*time.Second)
```

Back to the first example: adding time to an instant requires a
`time.Duration`, and subtracting two instants gives a `time.Duration`.

```go
// At(now, delay) returns delivery time.
func At(now time.Time, delay time.Duration) time.Time {
  return now.Add(delay)
}
```

Even in tests, avoid `time.Sleep` to wait for async events. Prefer
synchronization primitives or test hooks.

**Bad**
```go
func TestDelayedDelivery(t *testing.T) {
  now := time.Now()
  delivery := At(now, 10*time.Millisecond)

  time.Sleep(20 * time.Millisecond)

  if !delivery.Before(time.Now()) {
    t.Errorf("delivery should be in the past")
  }
}
```

**Good**
```go
func TestDelayedDelivery(t *testing.T) {
  now := time.Now()
  delivery := At(now, 10*time.Millisecond)

  if delivery.Before(now) {
    t.Errorf("delivery should be in the future")
  }
}
```

If you must sleep, accept the duration as a parameter for testability.

**Bad**
```go
func start() {
  time.Sleep(10 * time.Second)
}
```

**Good**
```go
func start(sleep time.Duration) {
  time.Sleep(sleep)
}
```

### Errors

#### Error Types

Declaring errors as values is flexible and matches the needs of most use cases.

Declare errors as `var` when callers need to match and handle specific errors.
Use `errors.New` or `fmt.Errorf` with `%w`.

```go
var ErrCouldNotOpen = errors.New("could not open")

func Open() error {
  return ErrCouldNotOpen
}
```

For errors that carry extra information, use a custom type.

```go
type ErrCouldNotOpen struct {
  File string
}

func (e ErrCouldNotOpen) Error() string {
  return fmt.Sprintf("could not open %q", e.File)
}
```

For errors with dynamic strings, use `fmt.Errorf` when callers don't need to
match, and a custom error when they do.

<table>
<thead><tr><th>No error matching</th><th>Error matching</th></tr></thead>
<tbody>
<tr><td>

```go
// package foo

func Open(file string) error {
  return fmt.Errorf("file %q not found", file)
}

// package bar

if err := foo.Open("testfile.txt"); err != nil {
  // Can't handle the error.
  panic("unknown error")
}
```

</td><td>

```go
// package foo

type NotFoundError struct {
  File string
}

func (e *NotFoundError) Error() string {
  return fmt.Sprintf("file %q not found", e.File)
}

func Open(file string) error {
  return &NotFoundError{File: file}
}


// package bar

if err := foo.Open("testfile.txt"); err != nil {
  var notFound *NotFoundError
  if errors.As(err, &notFound) {
    // handle the error
  } else {
    panic("unknown error")
  }
}
```

</td></tr>
</tbody></table>

Exported error variables or types become part of the package's public API.

#### Error Wrapping

Three options for propagating errors when a call fails:

- return the error as-is
- add context with `fmt.Errorf` and `%w`
- add context with `fmt.Errorf` and `%v`

Return the error as-is when no additional context is needed and the underlying
message is sufficient to trace its origin.

Otherwise, add context. "connection refused" becomes
"call service foo: connection refused".

- Use `%w` when callers should be able to match the underlying error. Document
  and test this as part of your contract when the wrapped error is a known
  `var` or type.
- Use `%v` to hide the underlying error. Callers can't match it, but you can
  switch to `%w` later.

Keep context succinct. Avoid "failed to" — it states the obvious and piles up:

**Bad**
```go
s, err := store.New()
if err != nil {
    return fmt.Errorf(
        "failed to create new store: %w", err)
}
```

**Good**
```go
s, err := store.New()
if err != nil {
    return fmt.Errorf(
        "new store: %w", err)
}
```

**Bad**
```plain
failed to x: failed to y: failed to create new store: the error
```

**Good**
```plain
x: y: new store: the error
```

When an error is sent to another system, make it clear it's an error (e.g. an
`err` tag or "Failed" prefix in logs).

See also Don't just check errors, handle them gracefully.

#### Error Naming

For error values stored as global variables, use the prefix `Err` or `err`
depending on whether they're exported. This supersedes
[Prefix Unexported Globals with _](#prefix-unexported-globals-with-_).

```go
var (
  // The following two errors are exported
  // so that users of this package can match them
  // with errors.Is.

  ErrBrokenLink = errors.New("link is broken")
  ErrCouldNotOpen = errors.New("could not open")

  // This error is not exported because
  // we don't want to make it part of our public API.
  // We may still use it inside the package
  // with errors.Is.

  errNotFound = errors.New("not found")
)
```

For custom error types, use the suffix `Error`.

```go
// Similarly, this error is exported
// so that users of this package can match it
// with errors.As.

type NotFoundError struct {
  File string
}

func (e *NotFoundError) Error() string {
  return fmt.Sprintf("file %q not found", e.File)
}

// And this error is not exported because
// we don't want to make it part of the public API.
// We can still use it inside the package
// with errors.As.

type resolveError struct {
  Path string
}

func (e *resolveError) Error() string {
  return fmt.Sprintf("resolve %q", e.Path)
}
```

#### Handle Errors Once

A caller can handle an error in several ways depending on context:

- match the error with `errors.Is` or `errors.As` and branch accordingly
- log the error and degrade gracefully (if recoverable)
- return a well-defined error (domain-specific failure)
- return the error, either [wrapped](#error-wrapping) or as-is

Handle each error only once. Don't log and then return — the caller may handle
it too, creating log noise.

For example:

<table>
<thead><tr><th>Description</th><th>Code</th></tr></thead>
<tbody>
<tr><td>

**Bad**: Log the error and return it

Callers further up the stack will likely take a similar action with the error.
Doing so makes a lot of noise in the application logs for little value.

</td><td>

```go
u, err := getUser(id)
if err != nil {
  // BAD: See description
  log.Printf("Could not get user %q: %v", id, err)
  return err
}
```

</td></tr>
<tr><td>

**Good**: Wrap the error and return it

Callers further up the stack will handle the error.
Use of `%w` ensures they can match the error with `errors.Is` or `errors.As`
if relevant.

</td><td>

```go
u, err := getUser(id)
if err != nil {
  return fmt.Errorf("get user %q: %w", id, err)
}
```

</td></tr>
<tr><td>

**Good**: Log the error and degrade gracefully

If the operation isn't strictly necessary,
we can provide a degraded but unbroken experience
by recovering from it.

</td><td>

```go
if err := emitMetrics(); err != nil {
  // Failure to write metrics should not
  // break the application.
  log.Printf("Could not emit metrics: %v", err)
}

```

</td></tr>
<tr><td>

**Good**: Match the error and degrade gracefully

If the callee defines a specific error in its contract,
and the failure is recoverable,
match on that error case and degrade gracefully.
For all other cases, wrap the error and return it.

Callers further up the stack will handle other errors.

</td><td>

```go
tz, err := getUserTimeZone(id)
if err != nil {
  if errors.Is(err, ErrUserNotFound) {
    // User doesn't exist. Use UTC.
    tz = time.UTC
  } else {
    return fmt.Errorf("get user %q: %w", id, err)
  }
}
```

</td></tr>
</tbody></table>

### Handle Type Assertion Failures

The single return value form of a type assertion panics on an incorrect type.
Always use the "comma ok" idiom.

**Bad**
```go
t := i.(string)
```

**Good**
```go
t, ok := i.(string)
if !ok {
  // handle the error gracefully
}
```

<!-- TODO: There are a few situations where the single assignment form is
fine. -->

### Don't Panic

Production code must avoid panics. Panics cause cascading failures. Return an
error and let the caller decide how to handle it.

**Bad**
```go
func run(args []string) {
  if len(args) == 0 {
    panic("an argument is required")
  }
  // ...
}

func main() {
  run(os.Args[1:])
}
```

**Good**
```go
func run(args []string) error {
  if len(args) == 0 {
    return errors.New("an argument is required")
  }
  // ...
  return nil
}

func main() {
  if err := run(os.Args[1:]); err != nil {
    fmt.Fprintln(os.Stderr, err)
    os.Exit(1)
  }
}
```

Panic/recover is not an error handling strategy. Panic only for irrecoverable
events like nil dereferences. Exception: program initialization — panicking to
abort at startup is acceptable.

```go
var _statusTemplate = template.Must(template.New("name").Parse("_statusHTML"))
```

In tests, prefer `t.Fatal` or `t.FailNow` over panics so the test is marked
as failed.

**Bad**
```go
// func TestFoo(t *testing.T)

f, err := os.CreateTemp("", "test")
if err != nil {
  panic("failed to set up test")
}
```

**Good**
```go
// func TestFoo(t *testing.T)

f, err := os.CreateTemp("", "test")
if err != nil {
  t.Fatal("failed to set up test")
}
```

### Avoid Mutable Globals

Avoid mutating global variables. Use dependency injection instead — pass values
as function arguments or struct fields.

**Bad**
```go
// sign.go

var _timeNow = time.Now

func sign(msg string) string {
  now := _timeNow()
  return signWithTime(msg, now)
}
```

**Good**
```go
// sign.go

type signer struct {
  now func() time.Time
}

func newSigner() *signer {
  return &signer{
    now: time.Now,
  }
}

func (s *signer) Sign(msg string) string {
  now := s.now()
  return signWithTime(msg, now)
}
```

**Bad**
```go
// sign_test.go

func TestSign(t *testing.T) {
  oldTimeNow := _timeNow
  _timeNow = func() time.Time {
    return someFixedTime
  }
  defer func() { _timeNow = oldTimeNow }()

  assert.Equal(t, want, sign(give))
}
```

**Good**
```go
// sign_test.go

func TestSigner(t *testing.T) {
  s := newSigner()
  s.now = func() time.Time {
    return someFixedTime
  }

  assert.Equal(t, want, s.Sign(give))
}
```

When a global variable is unavoidable, use `sync/atomic` with pointer types,
and `go.uber.org/atomic` for value types and structs.

### Avoid Embedding Types in Public Structs

Embedded types leak implementation details, inhibit type evolution, and obscure
documentation.

When using a shared `AbstractList`, don't embed it in concrete list
implementations. Hand-write delegate methods instead.

```go
type AbstractList struct {}

// Add adds an entity to the list.
func (l *AbstractList) Add(e Entity) {
  // ...
}

// Remove removes an entity from the list.
func (l *AbstractList) Remove(e Entity) {
  // ...
}
```

**Bad**
```go
// ConcreteList is a list of entities.
type ConcreteList struct {
  *AbstractList
}
```

**Good**
```go
// ConcreteList is a list of entities.
type ConcreteList struct {
  list *AbstractList
}

// Add adds an entity to the list.
func (l *ConcreteList) Add(e Entity) {
  l.list.Add(e)
}

// Remove removes an entity from the list.
func (l *ConcreteList) Remove(e Entity) {
  l.list.Remove(e)
}
```

Type embedding is a compromise between inheritance and composition. The outer
type gets implicit copies of the embedded type's methods. The struct also gains
a field named after the type — public if the embedded type is public. Future
versions must keep the embedded type for backward compatibility.

Embedding is rarely necessary. It's a convenience to avoid writing delegates.

Embedding an `AbstractList` *interface* offers more flexibility than embedding
a struct, but still leaks the implementation detail.

**Bad**
```go
// AbstractList is a generalized implementation
// for various kinds of lists of entities.
type AbstractList interface {
  Add(Entity)
  Remove(Entity)
}

// ConcreteList is a list of entities.
type ConcreteList struct {
  AbstractList
}
```

**Good**
```go
// ConcreteList is a list of entities.
type ConcreteList struct {
  list AbstractList
}

// Add adds an entity to the list.
func (l *ConcreteList) Add(e Entity) {
  l.list.Add(e)
}

// Remove removes an entity from the list.
func (l *ConcreteList) Remove(e Entity) {
  l.list.Remove(e)
}
```

Either way, embedding limits type evolution:

- Adding methods to an embedded interface is a breaking change.
- Removing methods from an embedded struct is a breaking change.
- Removing the embedded type is a breaking change.
- Replacing the embedded type, even with a compatible alternative, is a
  breaking change.

Writing delegate methods is tedious but hides implementation details, leaves
room for change, and eliminates indirection for discovering the full interface
in documentation.

### Avoid Using Built-In Names

Go's predeclared identifiers should not be reused as names.

Reusing them shadows the built-in in the current scope, or makes code
confusing. At best, the compiler complains. At worst, it introduces latent,
hard-to-grep bugs.

**Bad**
```go
var error string
// `error` shadows the builtin

// or

func handleErrorMessage(error string) {
    // `error` shadows the builtin
}
```

**Good**
```go
var errorMessage string
// `error` refers to the builtin

// or

func handleErrorMessage(msg string) {
    // `error` refers to the builtin
}
```

**Bad**
```go
type Foo struct {
    // While these fields technically don't
    // constitute shadowing, grepping for
    // `error` or `string` strings is now
    // ambiguous.
    error  error
    string string
}

func (f Foo) Error() error {
    // `error` and `f.error` are
    // visually similar
    return f.error
}

func (f Foo) String() string {
    // `string` and `f.string` are
    // visually similar
    return f.string
}
```

**Good**
```go
type Foo struct {
    // `error` and `string` strings are
    // now unambiguous.
    err error
    str string
}

func (f Foo) Error() error {
    return f.err
}

func (f Foo) String() string {
    return f.str
}
```

The compiler won't error on predeclared identifiers, but `go vet` should catch
these and other shadowing cases.

### Avoid `init()`

Avoid `init()` where possible. When unavoidable, `init()` code should:

1. Be completely deterministic regardless of environment or invocation.
2. Not depend on ordering or side-effects of other `init()` functions.
   Ordering is well-known but fragile — code changes break it.
3. Not access global or environment state (machine info, env vars, working
   directory, program arguments, etc.).
4. Not perform I/O (filesystem, network, system calls).

Code that can't meet these requirements belongs in `main()` or a helper called
from `main()`. Libraries must be especially careful to be deterministic and
avoid "init magic".

**Bad**
```go
type Foo struct {
    // ...
}

var _defaultFoo Foo

func init() {
    _defaultFoo = Foo{
        // ...
    }
}
```

**Good**
```go
var _defaultFoo = Foo{
    // ...
}

// or, better, for testability:

var _defaultFoo = defaultFoo()

func defaultFoo() Foo {
    return Foo{
        // ...
    }
}
```

**Bad**
```go
type Config struct {
    // ...
}

var _config Config

func init() {
    // Bad: based on current directory
    cwd, _ := os.Getwd()

    // Bad: I/O
    raw, _ := os.ReadFile(
        path.Join(cwd, "config", "config.yaml"),
    )

    yaml.Unmarshal(raw, &_config)
}
```

**Good**
```go
type Config struct {
    // ...
}

func loadConfig() Config {
    cwd, err := os.Getwd()
    // handle err

    raw, err := os.ReadFile(
        path.Join(cwd, "config", "config.yaml"),
    )
    // handle err

    var config Config
    yaml.Unmarshal(raw, &config)

    return config
}
```

Situations where `init()` may be acceptable:

- Complex expressions that can't be single assignments.
- Pluggable hooks (`database/sql` dialects, encoding registries, etc.).
- Optimizations for deterministic precomputation.

### Exit in Main

Use `os.Exit` or `log.Fatal*` for immediate exit. (Don't panic — see
[don't panic](#dont-panic).)

Call `os.Exit` or `log.Fatal*` **only in `main()`**. Other functions return
errors to signal failure.

**Bad**
```go
func main() {
  body := readFile(path)
  fmt.Println(body)
}

func readFile(path string) string {
  f, err := os.Open(path)
  if err != nil {
    log.Fatal(err)
  }

  b, err := io.ReadAll(f)
  if err != nil {
    log.Fatal(err)
  }

  return string(b)
}
```

**Good**
```go
func main() {
  body, err := readFile(path)
  if err != nil {
    log.Fatal(err)
  }
  fmt.Println(body)
}

func readFile(path string) (string, error) {
  f, err := os.Open(path)
  if err != nil {
    return "", err
  }

  b, err := io.ReadAll(f)
  if err != nil {
    return "", err
  }

  return string(b), nil
}
```

Multiple exiting functions create problems:

- Non-obvious control flow: any function can exit the program.
- Difficult to test: the test exits too, risking skipped tests.
- Skipped cleanup: deferred calls won't run.

#### Exit Once

Prefer to call `os.Exit` or `log.Fatal` **at most once** in `main()`. Delegate
error scenarios to a separate function that returns errors.

This shortens `main()` and puts business logic in a testable function.

**Bad**
```go
package main

func main() {
  args := os.Args[1:]
  if len(args) != 1 {
    log.Fatal("missing file")
  }
  name := args[0]

  f, err := os.Open(name)
  if err != nil {
    log.Fatal(err)
  }
  defer f.Close()

  // If we call log.Fatal after this line,
  // f.Close will not be called.

  b, err := io.ReadAll(f)
  if err != nil {
    log.Fatal(err)
  }

  // ...
}
```

**Good**
```go
package main

func main() {
  if err := run(); err != nil {
    log.Fatal(err)
  }
}

func run() error {
  args := os.Args[1:]
  if len(args) != 1 {
    return errors.New("missing file")
  }
  name := args[0]

  f, err := os.Open(name)
  if err != nil {
    return err
  }
  defer f.Close()

  b, err := io.ReadAll(f)
  if err != nil {
    return err
  }

  // ...
}
```

This applies equally to `os.Exit`:

```go
func main() {
  if err := run(); err != nil {
    fmt.Fprintln(os.Stderr, err)
    os.Exit(1)
  }
}
```

`run()` can return an exit code instead of an error, allowing unit tests to
verify it directly:

```go
func main() {
  os.Exit(run(args))
}

func run() (exitCode int) {
  // ...
}
```

The `run()` function is not prescriptive. You may:

- accept unparsed command line arguments (e.g., `run(os.Args[1:])`)
- parse arguments in `main()` and pass them to `run`
- use a custom error type to carry the exit code
- put business logic in a different layer

The only requirement: a single place in `main()` responsible for exiting.

### Use field tags in marshaled structs

Struct fields marshaled into JSON, YAML, or other tag-based formats must be
annotated with the relevant tag.

**Bad**
```go
type Stock struct {
  Price int
  Name  string
}

bytes, err := json.Marshal(Stock{
  Price: 137,
  Name:  "UBER",
})
```

**Good**
```go
type Stock struct {
  Price int    `json:"price"`
  Name  string `json:"name"`
  // Safe to rename Name to Symbol.
}

bytes, err := json.Marshal(Stock{
  Price: 137,
  Name:  "UBER",
})
```

Rationale: The serialized form is a contract between systems. Tags make the
contract explicit and guard against accidentally breaking it through
refactoring or renaming.

### Don't fire-and-forget goroutines

Goroutines aren't free: they cost stack memory and CPU scheduling. Large
numbers with uncontrolled lifetimes cause performance issues, prevent garbage
collection, and hold onto unused resources.

Don't leak goroutines in production. Use go.uber.org/goleak to test for leaks
in packages that spawn goroutines.

Every goroutine must:

- have a predictable stop time; or
- have a way to signal it to stop

In both cases, there must be a way to block and wait for it to finish.

**Bad**
```go
go func() {
  for {
    flush()
    time.Sleep(delay)
  }
}()
```

**Good**
```go
var (
  stop = make(chan struct{}) // tells the goroutine to stop
  done = make(chan struct{}) // tells us that the goroutine exited
)
go func() {
  defer close(done)

  ticker := time.NewTicker(delay)
  defer ticker.Stop()
  for {
    select {
    case <-ticker.C:
      flush()
    case <-stop:
      return
    }
  }
}()

// Elsewhere...
close(stop)  // signal the goroutine to stop
<-done       // and wait for it to exit
```

**Bad**
There's no way to stop this goroutine.
This will run until the application exits.

**Good**
This goroutine can be stopped with `close(stop)`,
and we can wait for it to exit with `<-done`.

#### Wait for goroutines to exit

Provide a way to wait for spawned goroutines to exit:

- `sync.WaitGroup` for multiple goroutines:

  ```go
  var wg sync.WaitGroup
  for i := 0; i < N; i++ {
    wg.Go(...)
  }

  // To wait for all to finish:
  wg.Wait()
  ```

- `chan struct{}` the goroutine closes when done (for a single goroutine):

  ```go
  done := make(chan struct{})
  go func() {
    defer close(done)
    // ...
  }()

  // To wait for the goroutine to finish:
  <-done
  ```

#### No goroutines in `init()`

`init()` functions must not spawn goroutines.
See also [Avoid init()](#avoid-init).

If a package needs a background goroutine, expose an object that manages its
lifetime with a method (`Close`, `Stop`, `Shutdown`, etc.) to signal stop and
wait for exit.

**Bad**
```go
func init() {
  go doWork()
}

func doWork() {
  for {
    // ...
  }
}
```

**Good**
```go
type Worker struct{ /* ... */ }

func NewWorker(...) *Worker {
  w := &Worker{
    stop: make(chan struct{}),
    done: make(chan struct{}),
    // ...
  }
  go w.doWork()
  return w
}

func (w *Worker) doWork() {
  defer close(w.done)
  for {
    // ...
    case <-w.stop:
      return
  }
}

// Shutdown tells the worker to stop
// and waits until it has finished.
func (w *Worker) Shutdown() {
  close(w.stop)
  <-w.done
}
```

**Bad**
Spawns a background goroutine unconditionally when the user exports this package.
The user has no control over the goroutine or a means of stopping it.

**Good**
Spawns the worker only if the user requests it.
Provides a means of shutting down the worker so that the user can free up
resources used by the worker.

Use `WaitGroup`s when the worker manages multiple goroutines.
See [Wait for goroutines to exit](#wait-for-goroutines-to-exit).

## Performance

Performance guidelines apply only to the hot path.

### Prefer strconv over fmt

`strconv` is faster than `fmt` for converting primitives to/from strings.

**Bad**
```go
for i := 0; i < b.N; i++ {
  s := fmt.Sprint(rand.Int())
}
```

**Good**
```go
for i := 0; i < b.N; i++ {
  s := strconv.Itoa(rand.Int())
}
```

**Bad**
```plain
BenchmarkFmtSprint-4    143 ns/op    2 allocs/op
```

**Good**
```plain
BenchmarkStrconv-4    64.2 ns/op    1 allocs/op
```

### Avoid repeated string-to-byte conversions

Convert a fixed string to a byte slice once and reuse it.

**Bad**
```go
for i := 0; i < b.N; i++ {
  w.Write([]byte("Hello world"))
}
```

**Good**
```go
data := []byte("Hello world")
for i := 0; i < b.N; i++ {
  w.Write(data)
}
```

**Bad**
```plain
BenchmarkBad-4   50000000   22.2 ns/op
```

**Good**
```plain
BenchmarkGood-4  500000000   3.25 ns/op
```

### Prefer Specifying Container Capacity

Specify container capacity to preallocate memory and minimize resizing
allocations.

#### Specifying Map Capacity Hints

Provide capacity hints when initializing maps with `make()`.

```go
make(map[T1]T2, hint)
```

This tries to right-size the map, reducing growth and allocations. Unlike
slices, map capacity hints are approximate (hashmap buckets) — allocations may
still occur up to the specified capacity.

**Bad**
```go
files, _ := os.ReadDir("./files")

m := make(map[string]os.DirEntry)
for _, f := range files {
    m[f.Name()] = f
}
```

**Good**
```go

files, _ := os.ReadDir("./files")

m := make(map[string]os.DirEntry, len(files))
for _, f := range files {
    m[f.Name()] = f
}
```

**Bad**
`m` is created without a size hint; the map will resize
dynamically, causing multiple allocations as it grows.

**Good**
`m` is created with a size hint; there may be fewer
allocations at assignment time.

#### Specifying Slice Capacity

Provide capacity hints when initializing slices with `make()`, especially when
appending.

```go
make([]T, length, capacity)
```

Slice capacity is not a hint: the compiler allocates exactly that memory.
Subsequent `append()` calls incur zero allocations until the slice is full.

**Bad**
```go
for n := 0; n < b.N; n++ {
  data := make([]int, 0)
  for k := 0; k < size; k++{
    data = append(data, k)
  }
}
```

**Good**
```go
for n := 0; n < b.N; n++ {
  data := make([]int, 0, size)
  for k := 0; k < size; k++{
    data = append(data, k)
  }
}
```

**Bad**
```plain
BenchmarkBad-4    100000000    2.48s
```

**Good**
```plain
BenchmarkGood-4   100000000    0.21s
```

## Style

### Avoid overly long lines

Avoid lines that require horizontal scrolling.

Soft limit: **99 characters**. Wrap before this limit, but it's not a hard
rule.

### Be Consistent

Some guidelines are objective; others are situational.

Above all, **be consistent**.

Consistent code is easier to maintain, rationalize, and migrate. It requires
less cognitive overhead.

Disparate styles within a codebase cause overhead, uncertainty, and bugs.

Apply these guidelines at the package level or above. Sub-package application
introduces multiple conflicting styles.

### Group Similar Declarations

Go supports grouping similar declarations.

**Bad**
```go
import "a"
import "b"
```

**Good**
```go
import (
  "a"
  "b"
)
```

This also applies to constants, variables, and type declarations.

**Bad**
```go

const a = 1
const b = 2



var a = 1
var b = 2



type Area float64
type Volume float64
```

**Good**
```go
const (
  a = 1
  b = 2
)

var (
  a = 1
  b = 2
)

type (
  Area float64
  Volume float64
)
```

Only group related declarations. Don't mix unrelated ones.

**Bad**
```go
type Operation int

const (
  Add Operation = iota + 1
  Subtract
  Multiply
  EnvVar = "MY_ENV"
)
```

**Good**
```go
type Operation int

const (
  Add Operation = iota + 1
  Subtract
  Multiply
)

const EnvVar = "MY_ENV"
```

Groups work inside functions too.

**Bad**
```go
func f() string {
  red := color.New(0xff0000)
  green := color.New(0x00ff00)
  blue := color.New(0x0000ff)

  // ...
}
```

**Good**
```go
func f() string {
  var (
    red   = color.New(0xff0000)
    green = color.New(0x00ff00)
    blue  = color.New(0x0000ff)
  )

  // ...
}
```

Exception: Group adjacent variable declarations inside functions, even if
unrelated.

**Bad**
```go
func (c *client) request() {
  caller := c.name
  format := "json"
  timeout := 5*time.Second
  var err error

  // ...
}
```

**Good**
```go
func (c *client) request() {
  var (
    caller  = c.name
    format  = "json"
    timeout = 5*time.Second
    err error
  )

  // ...
}
```

### Import Group Ordering

Two import groups:

- Standard library
- Everything else

This is goimports' default.

**Bad**
```go
import (
  "fmt"
  "os"
  "go.uber.org/atomic"
  "golang.org/x/sync/errgroup"
)
```

**Good**
```go
import (
  "fmt"
  "os"

  "go.uber.org/atomic"
  "golang.org/x/sync/errgroup"
)
```

### Package Names

Choose names that are:

- All lower-case. No capitals or underscores.
- Not requiring import aliasing at most call sites.
- Short and succinct. The name appears at every call site.
- Not plural. e.g., `net/url`, not `net/urls`.
- Not "common", "util", "shared", or "lib".

See also Package Names and Style guideline for Go packages.

### Function Names

Use MixedCaps for function names. Test functions may use underscores for
grouping, e.g., `TestMyFunction_WhatIsBeingTested`.

### Import Aliasing

Use import aliasing when the package name differs from the last element of the
import path.

```go
import (
  "net/http"

  client "example.com/client-go"
  trace "example.com/trace/v2"
)
```

Avoid aliases otherwise, unless imports directly conflict.

**Bad**
```go
import (
  "fmt"
  "os"
  runtimetrace "runtime/trace"

  nettrace "golang.net/x/trace"
)
```

**Good**
```go
import (
  "fmt"
  "os"
  "runtime/trace"

  nettrace "golang.net/x/trace"
)
```

### Function Grouping and Ordering

- Functions sorted in rough call order.
- Functions grouped by receiver.

Exported functions first, after `struct`, `const`, `var`. `NewXYZ()` after the
type, before its methods. Plain utility functions at the end.

**Bad**
```go
func (s *something) Cost() {
  return calcCost(s.weights)
}

type something struct{ ... }

func calcCost(n []int) int {...}

func (s *something) Stop() {...}

func newSomething() *something {
    return &something{}
}
```

**Good**
```go
type something struct{ ... }

func newSomething() *something {
    return &something{}
}

func (s *something) Cost() {
  return calcCost(s.weights)
}

func (s *something) Stop() {...}

func calcCost(n []int) int {...}
```

### Reduce Nesting

Reduce nesting by handling error/special cases first and returning early or
continuing.

**Bad**
```go
for _, v := range data {
  if v.F1 == 1 {
    v = process(v)
    if err := v.Call(); err == nil {
      v.Send()
    } else {
      return err
    }
  } else {
    log.Printf("Invalid v: %v", v)
  }
}
```

**Good**
```go
for _, v := range data {
  if v.F1 != 1 {
    log.Printf("Invalid v: %v", v)
    continue
  }

  v = process(v)
  if err := v.Call(); err != nil {
    return err
  }
  v.Send()
}
```

### Unnecessary Else

When a variable is set in both branches of an if, replace with a default and a
single if.

**Bad**
```go
var a int
if b {
  a = 100
} else {
  a = 10
}
```

**Good**
```go
a := 10
if b {
  a = 100
}
```

### Top-level Variable Declarations

At the top level, use `var`. Don't specify the type unless it differs from the
expression.

**Bad**
```go
var _s string = F()

func F() string { return "A" }
```

**Good**
```go
var _s = F()
// Since F already states that it returns a string, we don't need to specify
// the type again.

func F() string { return "A" }
```

Specify the type when it doesn't match the expression:

```go
type myError struct{}

func (myError) Error() string { return "error" }

func F() myError { return myError{} }

var _e error = F()
// F returns an object of type myError but we want error.
```

### Prefix Unexported Globals with _

Prefix unexported top-level `var`s and `const`s with `_` to mark them as
global symbols and avoid accidental reuse.

**Bad**
```go
// foo.go

const (
  defaultPort = 8080
  defaultUser = "user"
)

// bar.go

func Bar() {
  defaultPort := 9090
  ...
  fmt.Println("Default port", defaultPort)

  // We will not see a compile error if the first line of
  // Bar() is deleted.
}
```

**Good**
```go
// foo.go

const (
  _defaultPort = 8080
  _defaultUser = "user"
)
```

**Exception**: Unexported error values may use the prefix `err` without the underscore.
See [Error Naming](#error-naming).

### Embedding in Structs

Embedded types go at the top of the struct, separated by an empty line from
regular fields.

**Bad**
```go
type Client struct {
  version int
  http.Client
}
```

**Good**
```go
type Client struct {
  http.Client

  version int
}
```

Embedding should provide tangible benefit with zero adverse user-facing effects
(see also: [Avoid Embedding Types in Public Structs](#avoid-embedding-types-in-public-structs)).

Exception: Mutexes should not be embedded, even on unexported types. See also:
[Zero-value Mutexes are Valid](#zero-value-mutexes-are-valid).

Embedding **should not**:

- Be purely cosmetic or convenience-oriented.
- Make outer types harder to construct or use.
- Affect zero values — a useful zero value must remain useful.
- Leak unrelated functions or fields as a side-effect.
- Expose unexported types.
- Affect copy semantics.
- Change the outer type's API or type semantics.
- Embed a non-canonical form of the inner type.
- Expose implementation details.
- Allow users to observe or control internals.
- Surprise users by changing inner function behavior through wrapping.

Embed consciously. Litmus test: "would all these exported inner
methods/fields be added directly to the outer type?" If the answer is "some"
or "no", use a field instead.

**Bad**
```go
type A struct {
    // Bad: A.Lock() and A.Unlock() are
    //      now available, provide no
    //      functional benefit, and allow
    //      users to control details about
    //      the internals of A.
    sync.Mutex
}
```

**Good**
```go
type countingWriteCloser struct {
    // Good: Write() is provided at this
    //       outer layer for a specific
    //       purpose, and delegates work
    //       to the inner type's Write().
    io.WriteCloser

    count int
}

func (w *countingWriteCloser) Write(bs []byte) (int, error) {
    w.count += len(bs)
    return w.WriteCloser.Write(bs)
}
```

**Bad**
```go
type Book struct {
    // Bad: pointer changes zero value usefulness
    io.ReadWriter

    // other fields
}

// later

var b Book
b.Read(...)  // panic: nil pointer
b.String()   // panic: nil pointer
b.Write(...) // panic: nil pointer
```

**Good**
```go
type Book struct {
    // Good: has useful zero value
    bytes.Buffer

    // other fields
}

// later

var b Book
b.Read(...)  // ok
b.String()   // ok
b.Write(...) // ok
```

**Bad**
```go
type Client struct {
    sync.Mutex
    sync.WaitGroup
    bytes.Buffer
    url.URL
}
```

**Good**
```go
type Client struct {
    mtx sync.Mutex
    wg  sync.WaitGroup
    buf bytes.Buffer
    url url.URL
}
```

### Local Variable Declarations

Use `:=` when setting a variable to an explicit value.

**Bad**
```go
var s = "foo"
```

**Good**
```go
s := "foo"
```

Use `var` when the zero value is clearer. For example, declaring empty slices.

**Bad**
```go
func f(list []int) {
  filtered := []int{}
  for _, v := range list {
    if v > 10 {
      filtered = append(filtered, v)
    }
  }
}
```

**Good**
```go
func f(list []int) {
  var filtered []int
  for _, v := range list {
    if v > 10 {
      filtered = append(filtered, v)
    }
  }
}
```

### nil is a valid slice

`nil` is a valid slice of length 0.

- Return `nil`, not an empty slice literal.

  **Bad**
```go
  if x == "" {
    return []int{}
  }
  ```

**Good**
```go
  if x == "" {
    return nil
  }
  ```

- Check emptiness with `len(s) == 0`, not `s == nil`.

  **Bad**
```go
  func isEmpty(s []string) bool {
    return s == nil
  }
  ```

**Good**
```go
  func isEmpty(s []string) bool {
    return len(s) == 0
  }
  ```

- The zero value is usable immediately without `make()`.

  **Bad**
```go
  nums := []int{}
  // or, nums := make([]int)

  if add1 {
    nums = append(nums, 1)
  }

  if add2 {
    nums = append(nums, 2)
  }
  ```

**Good**
```go
  var nums []int

  if add1 {
    nums = append(nums, 1)
  }

  if add2 {
    nums = append(nums, 2)
  }
  ```

A nil slice is not equivalent to an allocated empty slice — they may be treated
differently (e.g., in serialization).

### Reduce Scope of Variables

Reduce the scope of variables where possible. Don't reduce scope if it
conflicts with [Reduce Nesting](#reduce-nesting).

**Bad**
```go
err := os.WriteFile(name, data, 0644)
if err != nil {
 return err
}
```

**Good**
```go
if err := os.WriteFile(name, data, 0644); err != nil {
 return err
}
```

Don't reduce scope when you need the result outside the if.

**Bad**
```go
if data, err := os.ReadFile(name); err == nil {
  err = cfg.Decode(data)
  if err != nil {
    return err
  }

  fmt.Println(cfg)
  return nil
} else {
  return err
}
```

**Good**
```go
data, err := os.ReadFile(name)
if err != nil {
   return err
}

if err := cfg.Decode(data); err != nil {
  return err
}

fmt.Println(cfg)
return nil
```

Constants don't need to be global unless used across multiple functions/files
or part of the package's external contract.

**Bad**
```go
const (
  _defaultPort = 8080
  _defaultUser = "user"
)

func Bar() {
  fmt.Println("Default port", _defaultPort)
}
```

**Good**
```go
func Bar() {
  const (
    defaultPort = 8080
    defaultUser = "user"
  )
  fmt.Println("Default port", defaultPort)
}
```

### Avoid Naked Parameters

Naked parameters hurt readability. Use C-style comments (`/* ... */`) for
parameter names when their meaning isn't obvious.

**Bad**
```go
// func printInfo(name string, isLocal, done bool)

printInfo("foo", true, true)
```

**Good**
```go
// func printInfo(name string, isLocal, done bool)

printInfo("foo", true /* isLocal */, true /* done */)
```

Better: replace naked `bool` types with custom types for readability and type
safety, and to allow more than two states in the future.

```go
type Region int

const (
  UnknownRegion Region = iota
  Local
)

type Status int

const (
  StatusReady Status = iota + 1
  StatusDone
  // Maybe we will have a StatusInProgress in the future.
)

func printInfo(name string, region Region, status Status)
```

### Use Raw String Literals to Avoid Escaping

Go supports raw string literals that span multiple lines and include quotes.
Use them to avoid hand-escaped strings.

**Bad**
```go
wantError := "unknown name:\"test\""
```

**Good**
```go
wantError := `unknown error:"test"`
```

### Initializing Structs

#### Use Field Names to Initialize Structs

Always specify field names when initializing structs. Enforced by `go vet`.

**Bad**
```go
k := User{"John", "Doe", true}
```

**Good**
```go
k := User{
    FirstName: "John",
    LastName: "Doe",
    Admin: true,
}
```

Exception: Field names may be omitted in test tables with 3 or fewer fields.

```go
tests := []struct{
  op Operation
  want string
}{
  {Add, "add"},
  {Subtract, "subtract"},
}
```

#### Omit Zero Value Fields in Structs

Omit zero-value fields unless they provide meaningful context.

**Bad**
```go
user := User{
  FirstName: "John",
  LastName: "Doe",
  MiddleName: "",
  Admin: false,
}
```

**Good**
```go
user := User{
  FirstName: "John",
  LastName: "Doe",
}
```

This reduces noise. Only specify meaningful values.

Include zero values when field names add meaningful context. For example, test
cases in [Test Tables](#test-tables) can benefit:

```go
tests := []struct{
  give string
  want int
}{
  {give: "0", want: 0},
  // ...
}
```

#### Use `var` for Zero Value Structs

When all struct fields are omitted, use `var` to declare it.

**Bad**
```go
user := User{}
```

**Good**
```go
var user User
```

This distinguishes zero valued structs from initialized ones, matching the
convention for [map initialization](#initializing-maps) and empty slices.

#### Initializing Struct References

Use `&T{}` instead of `new(T)` for consistency with struct initialization.

**Bad**
```go
sval := T{Name: "foo"}

// inconsistent
sptr := new(T)
sptr.Name = "bar"
```

**Good**
```go
sval := T{Name: "foo"}

sptr := &T{Name: "bar"}
```

### Initializing Maps

Prefer `make()` for empty maps and programmatically populated maps. This makes
initialization visually distinct from declaration and simplifies adding size
hints later.

**Bad**
```go
var (
  // m1 is safe to read and write;
  // m2 will panic on writes.
  m1 = map[T1]T2{}
  m2 map[T1]T2
)
```

**Good**
```go
var (
  // m1 is safe to read and write;
  // m2 will panic on writes.
  m1 = make(map[T1]T2)
  m2 map[T1]T2
)
```

**Bad**
Declaration and initialization are visually similar.

**Good**
Declaration and initialization are visually distinct.

Provide capacity hints when initializing maps with `make()`.
See [Specifying Map Capacity Hints](#specifying-map-capacity-hints).

When the map holds a fixed set of elements, use map literals.

**Bad**
```go
m := make(map[T1]T2, 3)
m[k1] = v1
m[k2] = v2
m[k3] = v3
```

**Good**
```go
m := map[T1]T2{
  k1: v1,
  k2: v2,
  k3: v3,
}
```

Rule of thumb: use map literals for a fixed set at initialization; otherwise
use `make` (with a size hint if available).

### Format Strings outside Printf

Declare `Printf`-style format strings as `const` values outside a string literal.

This enables `go vet` static analysis.

**Bad**
```go
msg := "unexpected values %v, %v\n"
fmt.Printf(msg, 1, 2)
```

**Good**
```go
const msg = "unexpected values %v, %v\n"
fmt.Printf(msg, 1, 2)
```

### Naming Printf-style Functions

Let `go vet` detect and check format strings on your `Printf`-style functions.

Use predefined `Printf`-style names where possible. `go vet` checks these by
default. See Printf family for more information.

Otherwise, end the name with `f`: `Wrapf`, not `Wrap`. `go vet` can check
specific names if they end with `f`.

```shell
go vet -printfuncs=wrapf,statusf
```

See also go vet: Printf family check.
