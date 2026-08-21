# Dashboard Control Plane v0.8 — Slice 1A validation

Date: 2026-08-21

## Scope

This slice establishes the first Dashboard-facing control-plane read model without adding a Dashboard frontend, changing the public MCP manifest, or broadening Workspace authority.

Implemented behavior:

- Gateway deployment diagnostics are assembled through one shared `gatewayOperationsDiagnostics()` path used by MCP deployment attestation and the management control plane.
- The loopback-only authenticated Gateway management listener exposes `GET /v1/operations`.
- The response contains the existing operations diagnostics plus a deterministic redacted Worker projection containing only Worker identity, environment identity, and the configured loopback transport descriptor.
- Worker credential references and credential file paths are excluded from the control-plane response.
- Management responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- Existing unversioned CLI management endpoints remain unchanged for compatibility.

## Security invariants

- The management listener remains loopback-only.
- The existing local management secret remains mandatory before the new route is reachable.
- No public MCP tool or schema is added or changed.
- No OAuth scope or callback/CSP behavior is changed.
- No Workspace, tool, command, filesystem, process, extension, or Worker authority boundary is broadened.
- Public health remains separate from the authenticated control-plane projection.

## Validation

Executed from the isolated `feat/dashboard-control-plane` worktree:

- `npm ci` — PASS, 0 vulnerabilities reported by npm audit during install.
- `npm run typecheck` — PASS.
- `npm test` — PASS, 44 test files / 186 tests.
- `npm run test:security` — PASS, 37 test files / 161 tests.
- `npm run build:package` — PASS.
- `git diff --check` — PASS.

The management-app security test verifies that `/v1/operations` rejects unauthenticated callers, emits `no-store`, preserves Core Manifest Revision 6 / Worker Protocol 3.0 diagnostics, and does not serialize `credentialRefs` or Worker credential file paths.

During one final full-suite rerun, an existing enrollment CLI integration test transiently failed with `worker_unreachable: fetch failed`. The same test had passed in the earlier full suites, passed immediately when rerun in isolation (9/9), and the subsequent full suite passed 186/186. No Control Plane code path is involved in that test.

## Deferred to the next control-plane slice

- shared live Worker liveness in the control-plane snapshot;
- Workspace/profile/tool/command-policy read projections;
- versioned mutation operations for Dashboard management;
- Dashboard frontend.
