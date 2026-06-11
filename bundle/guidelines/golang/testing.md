# Testing

## Unit test

Test file conventions:
- Same package: `foo.go` has `foo_test.go` next to it.
- Use `testify` for assertions (`assert`, `require`).
- Test names: `TestFunctionName_Scenario_ExpectedBehavior`.
- Integration tests: build tag `//go:build integration` or `TestIntegration*` prefix.
- Always use `-race` (data race detector).
- Use `testify/mock` for mocks. Avoid heavy mock libraries.

```yaml
# Taskfile.yml testing tasks
test:
  desc: Run all tests.
  cmds:
    - go test -race -count=1 -cover ./...

test/unit:
  desc: Run unit tests only.
  cmds:
    - go test -short -race -count=1 -cover ./...
```

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
