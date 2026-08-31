# Worker-initiated gRPC transport validation — 2026-08-30

## Scope

Feature worktree: `feat/worker-grpc-transport`.

Validated change: transport-neutral Worker Protocol execution plus optional Worker-initiated TLS gRPC/HTTP2 sessions for cross-machine membership routing. Existing loopback HTTP behavior remains supported.

## TDD / integration evidence

Implemented tests cover:

- shared `WorkerProtocolService` used by HTTP and gRPC;
- reverse-session frame schema/codec and bounded frame size;
- Gateway request multiplexing, timeout/cancel, capacity, duplicate/unknown request ids;
- Worker in-flight bounds and cancellation propagation;
- session registry uniqueness, provisional transaction ownership, promote/revoke/detach;
- dynamic routing through the current session after reconnect;
- cached hello invalidation when the session changes;
- real bidirectional gRPC operations;
- `ready` acknowledgment after Gateway authentication/session attachment;
- invalid Worker credential rejection;
- real pinned-certificate TLS transport;
- exact-session provisional enrollment followed by membership promotion;
- local authenticated Worker activation endpoint;
- persistent reconnect with bounded exponential backoff + jitter;
- remote join CLI ordering and post-commit durable target/CA persistence;
- legacy loopback HTTP enrollment regressions.

## Repository gates

Final feature-worktree results:

```text
test:cluster     17 files / 63 tests passed
test:security    66 files / 560 tests passed
npm test         82 files / 652 tests passed
typecheck        passed
build:package    passed
npm audit        0 vulnerabilities
git diff --check passed
```

The existing `.github/workflows/security-baseline.yml` runs `security:gate` on Windows and Ubuntu. The new transport/session tests are included in `test:security`; cluster-specific coverage is also included in `test:cluster`.

## Security properties exercised

- no plaintext non-loopback production gRPC configuration;
- Gateway TLS identity trust supplied by the join code and persisted locally after commit;
- private Gateway key remains local;
- provisional credential/session cannot be borrowed by a different transaction;
- duplicate active stable identities fail closed;
- Gateway confirmation executes health + hello through the exact provisional session;
- cancellation crosses the gRPC stream into Worker execution;
- failed/disconnected sessions reject pending requests and release registry ownership;
- reconnect does not mutate membership or generate durable retry state.

## Physical-network evidence

This worktree did **not** fabricate a separate-physical-host result. Real desktop↔laptop Wi-Fi/VPN/firewall acceptance must be recorded from the target deployment after this branch is integrated or installed on both hosts.

The required physical acceptance should verify join, Gateway restart, Worker restart, offline/reconnect, representative read/write/run operations, cancellation, and invalid-credential rejection.
