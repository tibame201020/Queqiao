# ADR-0010: `run` and `shell` support bounded sync and async execution modes

- Status: Accepted
- Date: 2026-08-13
- Extends: ADR-0005 and the frozen Revision 4 native-shell contract

## Context

Queqiao's current process runtime is deliberately request-bound. Timeout, output overflow, or request cancellation terminates the process tree. This is the correct default for synchronous tool execution but makes long-running builds, servers, and other background work depend on MCP/HTTP/tunnel request lifetime.

Creating a separate Job domain would solve request lifetime at the cost of persistent job identity, status/output APIs, recovery semantics, reconciliation, and another platform abstraction. Using tmux as Core infrastructure would introduce a Unix-oriented session dependency that is not appropriate for native Windows/WSL parity.

The domain requirement is narrower: allow the existing execution primitives to start a bounded native process and return after the Worker has accepted it.

## Decision

### One primitive, two modes

Both public execution primitives evolve to accept:

```text
mode: sync | async
```

`sync` and `async` are execution modes of `run` and `shell`, not separate spawn/job tools.

Adding this field/result behavior is an intentional future Core Manifest Revision. Frozen Revision 4 evidence is not rewritten.

### Sync semantics

Sync mode preserves the current request-bound semantics:

- native Worker execution;
- current profile/tool/command/cwd authorization;
- bounded timeout, concurrency, environment, and output;
- request cancellation terminates the process tree;
- result reports exit/output/timeout/abort state as defined by the existing contract.

### Async semantics

Async mode starts a bounded native process and returns only after successful Worker acceptance/start.

After acceptance:

- aborting or disconnecting the initiating MCP/HTTP request does not terminate the accepted process;
- temporary client, tunnel, or Gateway request interruption does not terminate it while the Worker/process remain alive;
- process lifetime remains bounded by Worker execution policy and native OS semantics;
- concurrency/resource limits remain authoritative;
- Worker shutdown behavior is defined explicitly by the feature implementation;
- Worker crash/restart recovery is not guaranteed.

The returned async result exposes only the native process identity/metadata needed to confirm successful start. It does not create a durable Queqiao Job identity.

### Output handling

Async stdout/stderr behavior is a feature-level contract. Safe discard and/or explicitly configured Workspace-relative redirection may be supported. Any redirection must pass the same Workspace containment and write-policy ceiling as other mutations.

Queqiao does not add `job_output` or stream persistence merely to capture background process output.

### No Job domain or tmux dependency

Core does not introduce:

- `job_start`;
- `job_status`;
- `job_list`;
- `job_output`;
- `job_cancel`;
- durable JobStore/process reconciliation;
- process reattachment after Worker restart;
- tmux as an execution backend.

Clients can inspect or terminate accepted background processes using native OS commands through already-authorized `run`/`shell` capabilities. Higher-level terminal/session behavior may be supplied by an extension later.

## Consequences

- Long-running/background execution no longer depends on keeping one MCP request open.
- Windows and WSL/Linux retain native process semantics rather than being normalized through a Unix session manager.
- Queqiao remains an execution substrate rather than becoming a durable job scheduler.
- Async usefulness depends on explicit lifetime/resource/redirection rules and Windows/WSL acceptance tests.
- The new schema requires a new Core Manifest Revision and, for clients that cache schemas, a new connector binding.
