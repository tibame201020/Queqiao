# Gateway / Worker Routing Stage 4 Validation — 2026-08-15

## Scope

Stage 4 cuts Gateway runtime Worker routing over to Gateway-owned persistent membership and evolves the private Worker Protocol identity contract. The public MCP tool/schema contract is unchanged.

## Worker Protocol 3.0

Worker Protocol 3.0 makes stable Worker identity part of the mandatory hello contract:

- `workerId` is stable cluster identity;
- `environmentId` remains unique routing identity;
- `instanceId` remains per-process runtime identity;
- mandatory functionality is owned by the protocol version;
- `capabilities` advertises optional Worker operations only.

Protocol 2.0 parsing remains temporarily available only for the legacy static-endpoint rolling-upgrade path. Membership-backed routing requires Protocol 3.0 and exact stable `workerId` equality.

The HTTP route family remains `/v1`; the protocol bump reflects handshake/identity semantics rather than a URL-family change.

## Routing-source cutover

Gateway routing now composes Worker clients from persistent membership records:

```text
workerId
+ unique environmentId
+ persisted transport descriptor
+ credential reference
        ↓
Worker transport
        ↓
Protocol 3.0 identity handshake
        ↓
Workspace routing / invocation
```

Compatibility is fail-closed:

- when no membership file exists, the existing static `environments` source may serve as a rolling-upgrade fallback;
- the first committed membership makes the membership store authoritative;
- once a membership file exists, even an empty membership store remains authoritative;
- legacy static endpoints cannot be resurrected by config reload after `worker remove` empties membership;
- membership routing rejects Protocol 2.0 Workers, mismatched stable `workerId`, mismatched `environmentId`, malformed credentials, and unsupported transport descriptors.

Persistent membership remains Gateway-owned. Ordinary health or invocation does not write registry state.

## Validation evidence

Local Windows validation on the isolated Stage 4 worktree:

- `npm run typecheck` — PASS;
- targeted protocol/routing/enrollment matrix — PASS;
- `npm test` — **152 / 152 PASS**;
- `npm run security:gate` — **133 / 133 PASS**, runtime dependency audit **0 vulnerabilities**;
- `npm run test:cluster` — **26 / 26 PASS**;
- `npm run resource:gate` — PASS;
  - package: **5.59 MiB**;
  - Gateway idle writes: **0 bytes**;
  - Worker idle writes: **0 bytes**;
  - Gateway idle log growth: **0 bytes**;
  - Worker idle log growth: **0 bytes**;
  - failures: `[]`.

The membership-routing integration test starts a real Worker with a stable `workerId`, persists a Gateway membership and credential reference, materializes the Gateway registry from that membership, then successfully lists and routes the Workspace through Worker Protocol 3.0.

## Compatibility / release note

This stage intentionally changes the private Worker Protocol Version from `2.0` to `3.0`. That value is visible in Queqiao deployment diagnostics, but the public MCP tools and their schemas are not changed.

Stable promotion still requires the later Shadow/final acceptance stage; this document is implementation-stage evidence and does not rewrite prior production acceptance history.
