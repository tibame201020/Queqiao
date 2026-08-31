# ADR-0013: Worker-initiated gRPC transport for cross-machine Workers

- Status: Accepted
- Date: 2026-08-30
- Refines: ADR-0011
- Security baseline: v3 for non-loopback Worker sessions
- Public MCP contract: unchanged

## Context

ADR-0011 separates Worker Protocol semantics from transport. The original verified binding was authenticated loopback HTTP, which is still valid for same-host deployments. Queqiao also needs one Gateway to route to Workers on different physical hosts and operating systems without exposing a general-purpose Worker listener or moving filesystem/process authority into the Gateway.

## Decision

### One Worker Protocol, two transport bindings

Worker execution semantics remain transport-neutral:

```text
Worker Protocol
      |
      +--> authenticated loopback HTTP
      |
      +--> Worker-initiated TLS gRPC/HTTP2
```

Both bindings dispatch through the same `WorkerProtocolService`. Workspace containment, Access Profile policy, tool/command authority, process limits, extension lifecycle, and cancellation remain Worker-owned and are not duplicated in the gRPC adapter.

### Worker initiates the remote connection

A remote Worker opens one outbound bidirectional gRPC stream to the Gateway. The Gateway is still the logical caller and multiplexes Worker Protocol requests over that stream.

```text
Client -> Gateway -> logical Worker request -> Worker
                  ^                         |
                  +---- TLS gRPC stream ----+
                       Worker initiated
```

The remote Worker continues to expose only its loopback HTTP/local-control listener. Persistent membership therefore does not depend on the Worker's DHCP address, NAT state, or inbound firewall rules.

### Dedicated Gateway Worker-session listener

The public MCP/OAuth Gateway listener remains loopback-only behind the existing reverse-proxy/Funnel boundary. Remote Worker sessions use a separate listener.

- loopback Worker-session binding may use insecure gRPC for local/test use;
- non-loopback Worker-session binding requires TLS;
- remote configuration requires an advertised Gateway host plus certificate/key material;
- Gateway setup generates a private-key/certificate pair only in the local runtime secrets area when remote Worker sessions are explicitly enabled.

### Join-code trust bootstrap

The existing `qjq1:` join code remains the user-facing enrollment artifact. When remote Worker transport is enabled it additionally carries:

```text
Gateway Worker-session target
Gateway certificate / trust anchor
```

The private key never leaves the Gateway host. The Worker stores the trusted certificate locally only after successful membership commit. Subsequent reconnects use the persisted target and pinned certificate.

### Runtime session registry

The Gateway owns an in-memory session registry keyed by stable `workerId` and `environmentId`. At most one active session may own either identity. Session state is not authoritative membership data.

Persistent membership contains stable identity, transport descriptor, and credential references. Runtime-only state includes the current gRPC stream/session id, pending request map, hello/instance identity, and reachability.

Each `WorkerClient` routes through the currently active session. A reconnect changes the transport revision and invalidates the cached Worker hello so stable identity/protocol are verified again.

### Bounded bidirectional protocol

The gRPC stream uses bounded JSON-encoded Worker-session frames:

```text
connect
ready
request
response
error
cancel
```

`ready` is sent only after Gateway authentication and session attachment succeed; the Worker does not report the connection as active before receiving it.

The binding enforces:

- maximum frame size;
- bounded pending/in-flight requests;
- unique active request ids;
- fail-closed unknown/duplicate response ids;
- request timeouts;
- cancellation propagation to Worker `AbortSignal`;
- pending-work rejection on disconnect;
- duplicate Worker/session rejection.

### Enrollment remains transactional

Remote enrollment is:

```text
1. CLI consumes the one-time join authority.
2. Gateway creates a provisional transaction and credential.
3. CLI installs the provisional credential locally.
4. CLI asks the already-running Worker through its authenticated loopback control endpoint to open the pinned TLS gRPC session.
5. Gateway authenticates the exact provisional session and sends `ready`.
6. CLI confirms the transaction.
7. Gateway runs health + hello over that exact session and verifies workerId/environmentId/protocol.
8. Gateway commits membership and promotes the session to membership authority.
9. Only after Gateway commit does the Worker host persist the reverse-session target and pinned certificate.
```

Failed pre-commit transactions revoke the provisional session and restore the prior local credential. A committed Gateway membership is never silently rolled back to the bootstrap credential because of a later local persistence error.

### Reconnection is transport recovery

After successful enrollment, Worker startup remains available even when the Gateway is offline. A durable reverse session reconnects with bounded exponential backoff and jitter, capped at 30 seconds. Reconnection does not create membership, issue a join token, or write idle recovery state to disk.

A provisional session is one-shot and does not acquire automatic reconnect behavior before the enrollment transaction commits.

### HTTP remains supported

Existing loopback HTTP memberships remain valid and are not silently migrated. The HTTP binding continues to satisfy the same-host Security Baseline v2 invariants.

## Security Baseline v3

Non-loopback Worker transport is authorized only through the reviewed constraints in `docs/security/security-baseline-v3-gate.md`:

- TLS-only non-loopback session transport;
- explicit Gateway identity trust bootstrap through the join code;
- Worker credential authentication;
- exact provisional-session binding before membership commit;
- duplicate-session and request-confusion fail-closed behavior;
- bounded frames, concurrency, cancellation, and reconnect behavior;
- local-only Worker control endpoint;
- no expansion of Worker filesystem/process authority;
- CI coverage on Windows and Ubuntu through the existing security workflow.

## Non-decisions

This ADR does not add:

- mDNS/LAN discovery;
- WebRTC, ICE, STUN, or TURN;
- Internet relay/traversal service;
- multi-Gateway failover;
- replicas sharing one `environmentId`;
- a public third-party gRPC API;
- automatic OS firewall rules or OS service installation.

## Consequences

- Cross-machine Workers require no inbound Worker port.
- The Gateway needs one separately configured Worker-session port reachable from remote Workers.
- A Gateway DNS name or IPv4 address used for the session must be reachable from the Worker host.
- Worker Protocol and Worker authority stay shared across HTTP and gRPC.
- Gateway restart preserves membership but waits for Workers to reconnect.
- Worker restart can recover a committed remote session without re-enrollment.
- The public MCP manifest and OAuth contract do not change.

## Validation

Implementation evidence is recorded in `docs/validation/worker-grpc-transport-2026-08-30.md`. Repository integration exercises real TLS gRPC, enrollment, routing, reconnect contracts, cancellation, package build, and security gates. Separate-physical-host Wi-Fi acceptance remains a release-environment validation step rather than simulated evidence.
