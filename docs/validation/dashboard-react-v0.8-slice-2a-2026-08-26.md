# Dashboard v0.8 Slice 2A — React Local Operations

Date: 2026-08-26
Branch: `feat/dashboard-control-plane`
Base slice: `aa80587` (`Add Dashboard control-plane mutations`)

## Scope

This slice adds the first browser UI over the existing v0.8 control plane without introducing a second state or authority system.

- New private React workspace: `apps/dashboard`.
- Dashboard assets are built into `dist/dashboard` and shipped with the existing package artifact.
- The Gateway loopback management listener serves `/dashboard/` static assets.
- `GET /v1/operations` remains the read model.
- Workspace profile, tool allow/deny, and command allow/remove controls call the existing versioned mutation routes.
- Worker and Workspace state is always refreshed from the control plane after a successful mutation.

## Authentication and trust boundary

Static Dashboard assets are inert and may be loaded from the loopback management listener without the management header. All `/v1/*` management APIs remain protected by the existing `x-queqiao-management-secret` check.

The first UI slice asks the operator for that existing management secret and stores it only in browser `sessionStorage`. The secret is not compiled into JavaScript/CSS/HTML, is not placed in a URL, and is not persisted by the Dashboard.

Dashboard static responses inherit `Cache-Control: no-store` and `X-Content-Type-Options: nosniff` and add a restrictive CSP:

- `default-src 'self'`
- `script-src 'self'`
- `style-src 'self'`
- `connect-src 'self'`
- `object-src 'none'`
- `base-uri 'none'`
- `frame-ancestors 'none'`

No public MCP tool/schema, OAuth scope, Worker credential model, or Workspace authority rule is changed.

## UI coverage

The first React surface shows:

- deployment health / Core Manifest Revision;
- Worker Protocol and MCP compatibility count;
- deployment fingerprint;
- Worker reachability and transport projection;
- Workspace identity/root/default marker;
- Workspace profile mutation;
- public tool policy state with explicit Allow/Deny actions;
- command allowlist add/remove;
- explicit refresh and browser-session disconnect.

The tool view preserves the distinction between explicit policy and inherited/default policy. Existing Queqiao semantics still apply: an empty tool allowlist is not equivalent to an explicit per-tool allow entry.

## Packaging

`npm run build:dashboard` produces:

- `dist/dashboard/index.html`
- `dist/dashboard/app.js`
- `dist/dashboard/app.css`

`npm run build:package` invokes the Dashboard build after bundling the CLI/Gateway/Worker executables, so the published `dist/` tree is self-contained.

## Validation

Focused validation completed before the final regression gate:

- `npm run typecheck` — PASS
- `npm run build:dashboard` — PASS
- `vitest run apps/gateway/src/management-app.test.ts` — PASS (6 tests)
- `npm run build:package` — PASS
- packaged Dashboard assets present in `dist/dashboard`

Final validation:

- `npm run typecheck` — PASS
- `npm test` — PASS (46 files / 197 tests)
- `npm run test:security` — PASS (37 files / 167 tests)
- `npm run test:cli-setup` — PASS (2 files / 12 tests)
- `npm run build:dashboard` — PASS
- `npm run build:package` — PASS
- `npm audit --omit=dev --audit-level=moderate` — PASS (0 vulnerabilities)
- `git diff --check` — PASS
- sensitive/machine-specific material review — PASS

During integration, the Dashboard's three-state tool-policy UI exposed that a reversible explicit policy needs an `inherit` reset. `WorkspaceToolDecision` therefore now supports `allow | inherit | deny`; CLI behavior remains unchanged because the CLI continues to issue only allow/deny. The same pass also identified a missing TypeScript project reference from `apps/worker` to `packages/operations`; adding that explicit reference removes stale declaration ordering from the Worker build graph.

## Explicitly deferred

- automatic browser launch;
- one-time Dashboard bootstrap/session exchange;
- Worker enrollment/removal/transport UI;
- Workspace add/remove UI;
- browser E2E / visual regression harness;
- non-loopback Dashboard exposure.

This slice does not claim browser visual validation or Stable-runtime smoke testing. Stable runtime is not replaced or restarted by this work.
