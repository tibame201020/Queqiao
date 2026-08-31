# Worker gRPC Transport Implementation Plan

- Status: Implemented
- Date: 2026-08-30
- Architecture: ADR-0011 + ADR-0013
- Security: Security Baseline v3
- Public MCP manifest impact: none
- Compatibility: existing loopback HTTP memberships remain valid

## Result

Queqiao now has one transport-neutral Worker Protocol execution path with two bindings:

```text
same host:   Gateway -> authenticated loopback HTTP -> WorkerProtocolService
cross host:  Gateway -> active reverse-session registry
                              ^
                              | pinned TLS gRPC/HTTP2
                              | Worker initiated
                         remote Worker
                              |
                         WorkerProtocolService
```

The gRPC binding does not duplicate Workspace/policy/process/Extension authority.

## Completed phases

### Phase 0 — transport-neutral Worker service

Implemented `WorkerProtocolService`; HTTP and gRPC share it.

### Phase 1 — reverse-session contracts

Implemented bounded frame schemas, Gateway session registry, multiplexed reverse transport, Worker request dispatcher, cancellation, capacity, timeout, duplicate/unknown id rejection, and disconnect cleanup.

### Phase 2 — concrete gRPC/HTTP2

Implemented `@grpc/grpc-js` bidirectional streaming with an explicit `ready` acknowledgment. Real integration tests execute Worker Protocol operations and cancellation over the stream.

### Phase 3 — enrollment and lifecycle

Implemented provisional-session authentication bound to one join transaction, exact-session health/hello verification, membership promotion, rollback/revoke, dynamic reconnect routing, local authenticated activation, and persistent Worker reconnect with bounded backoff + jitter.

### Phase 4 — Security Baseline v3

Implemented TLS-only non-loopback configuration, advertised Gateway identity, self-signed certificate generation in local secrets storage, pinned certificate bootstrap in the `qjq1:` join code, and CI security coverage on Windows/Ubuntu via the existing security workflow.

### Phase 5 — CLI integration

Existing workflow remains:

```text
Gateway host: create join code
Worker host:  setup -> serve -> join
```

When remote Worker transport is configured, the same join code carries the TLS endpoint and trust anchor. The CLI activates the running Worker with a provisional session and persists the durable reverse-session config only after Gateway membership commits.

## Validation

Repository evidence is in `docs/validation/worker-grpc-transport-2026-08-30.md`.

Final implementation gates:

```text
test:cluster     63 passed
test:security    560 passed
npm test         652 passed
typecheck        passed
build:package    passed
npm audit        0 vulnerabilities
git diff --check passed
```

## Release-environment acceptance still required

Physical-host validation is intentionally not simulated. Run and record the target deployment matrix after installation on separate hosts:

```text
Gateway Windows -> Worker Windows
Gateway Windows -> Worker Linux/WSL/VM
Gateway Linux   -> Worker Windows
```

For each supported topology verify join, Gateway/Worker restart, offline/reconnect, representative filesystem/process operations, cancellation, credential rejection, and unchanged public MCP manifest.

## Constraints preserved

- Workstation development remains in its separate worktree.
- No local hostname/path/token/private key or personal data belongs in the repository.
- HTTP loopback validation is not relaxed.
- Worker policy/tool/process execution is not duplicated in transport code.
- New tests are included in normal/security CI gates.
