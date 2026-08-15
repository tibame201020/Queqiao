# Gateway / Worker Enrollment Stage 3 Validation — 2026-08-15

## Scope

This milestone implements the ADR-0011 explicit Worker enrollment lifecycle without changing the public MCP contract or cutting runtime routing over to the persistent membership registry.

Implemented management lifecycle:

- `queqiao gateway setup`
- `queqiao worker setup`
- `queqiao gateway join-token`
- `queqiao worker join`
- `queqiao worker list`
- `queqiao worker update`
- `queqiao worker remove`

The Gateway exposes a separate loopback-only management listener for privileged local administration. Public enrollment endpoints accept the one-time join transaction but are not MCP tools.

## Atomic join contract

The verified join sequence is:

1. validate and consume one join token;
2. issue a provisional daily Worker credential;
3. Worker CLI securely swaps the provisional credential into the Worker secret path while retaining crash-recovery rollback state;
4. Worker confirms within 30 seconds;
5. Gateway performs real health, stable identity, Worker Protocol, and authenticated handshake probes;
6. Gateway persists the daily credential and atomically commits Worker membership;
7. any failure leaves no membership and the Worker CLI restores/removes the provisional local credential.

A join token is consumed once a valid transaction attempt starts even if a later binding, identity, transport, or confirmation step fails. Unused join tokens are memory-only and do not survive Gateway restart.

Persistent transport descriptors can be changed only through the explicit management update path. The replacement endpoint must first prove the existing daily credential and the same Worker identity/protocol before the registry update commits.

## Security boundaries retained

- Worker authority over workspace, filesystem, process, tool, command, containment, cancellation, and limits is unchanged.
- Gateway management listener is bound to `127.0.0.1` and requires a protected local management secret.
- Current Worker transport remains loopback HTTP under Security Baseline v2.
- This milestone does **not** authorize arbitrary remote/non-loopback Worker listeners; that still requires a separate transport security review.
- Join-token values and Worker daily credentials are not written to application logs or MCP results.
- Gateway-owned membership state remains separate from `config.yaml`.
- CLI management actions use the Gateway management interface; they do not directly edit the membership registry file.

## Compatibility boundaries

- Public MCP manifest: unchanged.
- Worker Protocol: remains `2.0`.
- `/v1/hello` semantics: unchanged in this stage.
- Stable Worker identity verification uses an enrollment-only authenticated endpoint; Worker Protocol identity evolution remains Stage 4 work.
- Existing static `environments` routing remains the runtime routing authority until Stage 4. The Gateway may start with zero legacy static environments so the first Worker can be enrolled.

## Verification evidence

Local validation in the isolated Stage 3 worktree:

- `npm run typecheck`: PASS.
- `npm test`: PASS — 38 files / 146 tests.
- `npm run security:gate`: PASS — 31 security files / 123 tests and production dependency audit reports 0 vulnerabilities.
- `npm run resource:gate`: PASS.
- `git diff --check`: PASS.

Stage 3-specific evidence includes:

- join-token replay and optional binding enforcement;
- multiple independent unused tokens;
- Gateway-restart invalidation of unused tokens;
- fixed 30-second provisional confirmation expiry;
- invalid provisional credential terminates the transaction;
- unreachable or identity-mismatched Worker leaves no membership;
- real HTTP CLI join performs provisional secret swap, authenticated Gateway verification, and membership commit;
- failed CLI confirmation restores the previous Worker credential and removes provisional marker state;
- Worker observes credential replacement without process restart;
- explicit transport update commits only after existing-credential and stable-identity verification;
- incorrect replacement identity leaves the previous transport descriptor unchanged;
- Gateway and Worker setup independently without silently creating membership.

Resource Safety result:

- package: 5.59 MiB;
- Gateway idle CPU: 0 s;
- Worker idle CPU: 0 s;
- Gateway idle writes/logs: 0 / 0 bytes;
- Worker idle writes/logs: 0 / 0 bytes;
- Gateway resident after workload: 78.02 MiB;
- Worker resident after workload: 64.78 MiB;
- resource failures: none.

## Acceptance status

**Implementation validation: PASS.**

This document does not claim production promotion, Shadow deployment, or ChatGPT end-to-end acceptance. Those remain separate release/acceptance steps after PR review and merge.
