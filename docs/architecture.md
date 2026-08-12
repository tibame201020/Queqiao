# Architecture

## System context

```text
ChatGPT / MCP client
        |
        | HTTPS + OAuth + Streamable HTTP MCP
        v
Queqiao Gateway  <---- outbound authenticated worker channel ----+
        |                                                        |
        +----------------------+----------------------+-----------+
                               |                      |
                        Windows Worker            WSL Worker
                               |                      |
                        Windows workspaces        Linux workspaces
```

Only the Gateway is reachable through the public tunnel. A Worker initiates its own
authenticated connection and never requires a public listening port.

The current verified Windows/WSL baseline uses loopback-only Worker endpoints while
both environments run on the same WSL2 host. The registry abstraction deliberately
keeps routing independent of that transport so a later outbound persistent channel
can replace loopback without changing the public MCP contract.

## Module boundaries

### `apps/gateway`

Internet-facing composition root. It owns OAuth, MCP session lifecycle, stable tool
registration, worker presence, request routing, timeouts, cancellation, and public
rate limits. It MUST NOT import filesystem or child-process execution modules.

### `apps/worker`

Environment-local composition root. It loads local workspace policy, connects to a
Gateway, validates every delegated request again, and invokes workspace capabilities.
It MUST NOT implement the public OAuth authorization server.

Native operations are registered through the shared tool runtime and reached through
a versioned internal invocation route. Compatibility endpoints may remain during a
rolling upgrade, but they delegate to the same runtime and authoritative policy path.

### `apps/cli`

Administrative interface for atomic configuration changes, migrations, diagnostics,
service lifecycle, credentials, and permission inspection. CLI changes must not alter
the public MCP tool schema.

### `packages/protocol`

Transport-neutral, versioned schemas shared by Gateway and Worker. Breaking wire
changes require a protocol version change and an explicit compatibility policy.

### `packages/config`

Versioned configuration schemas and migration contracts. Persistence and secret
storage are adapters; runtime modules receive validated configuration only.

### `packages/security`

Authentication and step-up authorization orchestration. OAuth establishes an MCP
client identity through the single `queqiao:access` handshake scope; it does not
authorize workspace capabilities. Higher-risk actions may additionally require local user
approval or a short-lived one-time code. Every approval grant is single-use and bound
to the principal, environment, workspace, tool, and canonical request digest.

Raw approval codes are never persisted. Provider adapters own platform-specific local
prompts, secure secret storage, hashing, signing, expiry, attempt limits, and grant
revocation. Neither Gateway nor Worker business logic implements these directly.

The action digest uses deterministic JSON key ordering and SHA-256 over the complete
validated request. Both trust boundaries recompute it; a digest supplied by a client
is never accepted as authoritative.

### `packages/policy`

Pure authorization decisions. Effective capability is the intersection of workspace
profile, per-tool rules, command rules, path containment, and required
security assurance. Policy decides whether step-up is required; Security fulfills it.

### `packages/tool-runtime`

Transport-neutral tool and extension contracts. It validates extension identity,
rejects tool collisions, validates inputs, seals manifests before serving traffic,
and runs ordered interception hooks. It does not know about MCP content, HTTP, local
filesystems, or process execution. Core tools use the same registration path as
optional extensions.

### `packages/process-runtime`

Environment-native, shell-free process execution with trusted executable resolution,
bounded output, timeout and cancellation propagation, process-tree termination, and
per-Worker concurrency limits. Workspace and command authorization remain outside the
runtime and are enforced by the native Worker before invocation.

### Future runtime packages

- `packages/workspace`: safe filesystem, search, patch, process, and git primitives.
- `packages/transport`: reconnecting worker channel and request multiplexing.
- `packages/observability`: structured logs, metrics, traces, and redacted audit events.
- `packages/testkit`: contract fixtures and hostile path/command test utilities.

They will be introduced with the first vertical slice rather than as empty modules.

## Invariants

1. The Gateway never accesses a workspace filesystem directly.
2. A Worker never trusts authorization performed only by the Gateway.
3. ChatGPT cannot submit an arbitrary local root; it can select only configured IDs.
4. Every operation includes an environment-independent opaque workspace handle.
5. Public tool names and input schemas remain stable across workspace configuration.
6. Worker disconnects degrade only that environment, not the complete MCP endpoint.
7. Configuration writes are atomic, validated, versioned, and auditable.
8. Secrets never appear in workspace configuration, tool output, or normal logs.
9. OAuth authenticates the MCP client but does not automatically approve every action.
10. A step-up grant is short-lived, single-use, and valid only for the exact action.

## Production acceptance gates

- Unit tests for protocol, config migration, policy, path containment, and command rules.
- Gateway/Worker contract tests across supported protocol versions.
- End-to-end Windows and WSL tests through one Gateway endpoint.
- OAuth refresh, revocation, reconnect, cancellation, shutdown, and recovery tests.
- Resource limits for output size, file size, process count, duration, and concurrency.
- Structured health/readiness endpoints and redacted security audit records.
- Reproducible locked dependencies and explicit configuration migration procedures.
