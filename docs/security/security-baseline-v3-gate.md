# Security Baseline v3 Gate — Remote Worker Transport

Security Baseline v3 extends v2 only for the optional cross-machine Worker transport. The public MCP/OAuth Gateway boundary and Worker authority model remain unchanged.

## Required invariants

1. **Native Worker remains final authority.** gRPC transport cannot increase Workspace, Tool, command, process, or Extension authority.
2. **Public MCP/OAuth listener remains loopback-only.** Remote Worker sessions use a separate Gateway listener.
3. **Non-loopback Worker sessions are TLS-only.** Remote configuration is invalid without an advertised Gateway host and certificate/key material.
4. **Gateway identity is explicitly bootstrapped.** The short-lived `qjq1:` join code carries the remote session target and Gateway certificate; the Gateway private key never leaves local secrets storage.
5. **Worker identity is authenticated independently.** A Worker credential authenticates membership/session identity; it does not grant Workspace authority.
6. **Enrollment binds one provisional transaction to one live session.** Confirmation requires health + Worker Protocol hello over the exact authenticated provisional session before membership commit.
7. **Session ownership fails closed.** Duplicate active `workerId` or `environmentId`, wrong transaction binding, malformed frames, duplicate/unknown response ids, and excess capacity are rejected.
8. **Transport resources are bounded.** Frame size, pending requests, Worker in-flight requests, request timeouts, cancellation, and disconnect cleanup are bounded.
9. **Remote Worker exposes no inbound LAN execution listener.** Its HTTP/local enrollment-control listener remains loopback-only; the Worker initiates the gRPC connection.
10. **Reconnect is recovery, not registration.** Durable sessions reconnect with bounded exponential backoff + jitter and do not create idle disk-write churn.
11. **Existing loopback HTTP remains valid.** Remote transport does not relax Security Baseline v2 HTTP constraints.
12. **Secrets remain outside the repository.** Generated private keys, credentials, join codes, machine-specific pinned certificates, and runtime paths stay in local runtime/config/secret storage.

## Required CI

The existing `Security Baseline` GitHub Actions workflow runs `security:gate` on Windows and Ubuntu. `test:security` now includes the Worker Protocol reverse-session, Gateway session registry, reverse transport, real gRPC/TLS integration, local activation control, reconnect manager, and shared Worker Protocol service tests.

Required repository gates are:

```text
npm run typecheck
npm run test:security
npm run test:cluster
npm test
npm run build:package
npm audit --omit=dev --audit-level=moderate
git diff --check
```

## Verified controls

Repository integration verifies:

- actual bidirectional `@grpc/grpc-js` transport;
- pinned-certificate TLS session establishment;
- `ready` acknowledgment only after Gateway authentication/attach;
- credential rejection;
- provisional enrollment binding and promotion;
- health/hello validation over the exact session;
- request multiplexing and fail-closed response matching;
- cancellation reaching the Worker `AbortSignal`;
- session disconnect cleanup;
- reconnect/backoff contracts without durable retry writes;
- HTTP enrollment regression compatibility.

## Release-environment validation

A repository test cannot substitute for real network topology. Before a release is claimed validated for a specific deployment, run the physical-host acceptance matrix on the intended LAN/VPN/firewall environment and record it separately. This includes at least join, Gateway restart, Worker restart, Worker offline/reconnect, representative filesystem/process operations, cancellation, and credential rejection.

This requirement does not weaken the code gate; it prevents simulated loopback evidence from being mislabeled as physical-network evidence.

## Residuals / non-goals

Baseline v3 does not provide automatic LAN discovery, Internet traversal/relay, automatic firewall configuration, multi-Gateway failover, or mutual-TLS client certificates. Worker membership remains protected by the existing long-lived Worker credential over pinned TLS.
