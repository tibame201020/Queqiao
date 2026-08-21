# Dashboard Control Plane v0.8 — Slice 1B validation

Date: 2026-08-21

## Scope

This slice completes the Dashboard-facing read side needed before mutation APIs or a frontend are introduced.

Implemented behavior:

- Gateway routing and the management control plane share one `MembershipWorkerRegistry` instance.
- `GET /v1/operations` projects current Worker liveness (`reachable`, `checkedAt`, `lastSuccessAt`).
- The same snapshot projects the Worker-authoritative Workspace catalog, including default Workspace, root, profile, tool allow/deny/explicit policy, and command allowlist.
- Workspace/tool/command arrays are copied and deterministically sorted before serialization.
- Worker credential references and credential file paths remain excluded.
- Existing management authentication, loopback binding, response hardening, CLI management endpoints, public MCP manifest, OAuth behavior, and Workspace authority remain unchanged.

## Runtime model

The Dashboard does not create a second liveness monitor or independent Worker state cache. The Gateway composition root constructs one `MembershipWorkerRegistry`, passes it into `createGatewayApp`, and gives the same source to the management app. A control-plane read asks that registry for the live Worker workspace catalog; the resulting tracked reachability state is then included in the snapshot.

If a Worker is unavailable, the membership still remains visible while its liveness is false and its Workspace list is empty. The management API does not infer or synthesize Worker policy.

## Security invariants

- Management listener remains `127.0.0.1` only.
- Existing local management secret is required before any control-plane read.
- No Worker credential reference, credential path, or token is serialized.
- Workspace roots and policy appear only on the authenticated local management surface, never public `/health` or MCP deployment projection.
- No mutation route is added in this slice.
- No public MCP tool/schema, OAuth scope, or extension authority changes are introduced.

## Validation

Focused validation:

- `npm run typecheck` — PASS.
- `npx vitest run apps/gateway/src/management-app.test.ts packages/operations/src/index.test.ts` — PASS, 11/11 tests.

The management test verifies live liveness fields plus default Workspace, root, profile, tool policy, command allowlist, deterministic sorting, and continued credential-path redaction.

Final repository gates:

- `npm run typecheck` — PASS.
- `npm test` — PASS, 44 test files / 186 tests.
- `npm run test:security` — PASS, 37 test files / 161 tests.
- `npm run test:cli-setup` — PASS, 2 test files / 12 tests.
- `npm run build:package` — PASS.
- `git diff --check` — PASS.
