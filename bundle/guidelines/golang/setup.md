# Setup

### Toolchain

| Tool | Purpose |
|------|---------|
| Go | Compiler and toolchain (install via asdf/mise or official download) |
| golangci-lint | Meta-linter aggregating ~50 linters |
| goimports | Automatic import formatting |
| Task | Taskfile (https://taskfile.dev/) runner |

### Directory structure

```
project-name/
├── cmd/                    One binary per subdirectory
│   └── server/
│       └── main.go         main function: initialization and injection only
├── internal/               Private module code
│   ├── app/                Composition root
│   ├── <domain-1>/         Example: cart, subscription, users, etc.
│   ├── <domain-2>/           
│   └── <infra-1>/           Concrete implementations (DB, S3, Kafka)
├── pkg/                    Reusable by other applications (optional)
├── e2e/
├── docs/
│   └── adr/                Architecture Decision Records
├── AGENTS.md
├── CLAUDE.md -> AGENTS.md
├── Taskfile.yml
├── .pre-commit-config.yaml
├── go.mod
└── go.sum
```

### Build with ldflags

Every binary must embed version, commit, and date via ldflags at build time.
This enables `--version` and production debugging:

```yaml
# Taskfile.yml
build:
  vars:
    VERSION:
      sh: cat VERSION
    COMMIT:
      sh: git rev-parse --short=7 HEAD
    DATE:
      sh: date +%Y-%m-%d
    BUILD_TYPE: release
  cmds:
    - go build -ldflags "-X main.version={{.VERSION}}-{{.DATE}}-{{.COMMIT}} -X main.commit={{.COMMIT}} -X main.date={{.DATE}} -X main.buildType={{.BUILD_TYPE}}" -o bin/ ./cmd/...
```

The `main` package exposes these:

```go
package main

var (
    version   = "dev"
    commit    = "unknown"
    date      = "unknown"
    buildType = "dev"
)
```

### Pre-commit

```yaml
repos:
  - repo: local
    hooks:
      - id: lint
        name: Run golangci-lint
        entry: task lint
        language: system
        pass_filenames: false

      - id: fmt
        name: Run formatters
        entry: task fmt
        language: system
        pass_filenames: false
```
