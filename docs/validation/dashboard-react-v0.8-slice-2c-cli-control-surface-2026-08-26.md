# Dashboard React v0.8 Slice 2C — CLI control surface validation

Date: 2026-08-26
Branch: `feat/dashboard-control-plane`

## Scope

This slice expands the localhost Operations Dashboard from topology/status and Workspace mutations into a graphical control surface over existing CLI operational semantics.

Dashboard navigation now exposes:

- Diagnostics (`queqiao doctor`)
- Deployment Manifest (`queqiao manifest show`)
- Tool composition (`queqiao tool explain`)
- Extension state/composition diagnostics (`queqiao extension list|doctor`)
- Cross-Workspace permission inventory (`queqiao permissions show`)

Gateway/Worker `setup`, `serve`, and `stop` remain intentionally deferred. The Dashboard is hosted by the Gateway process, so self-lifecycle control needs an external local supervisor/process boundary rather than a handler that terminates its own host.

## Shared operations model

`doctorGateway` moved into `@queqiao/operations`; the CLI compatibility module re-exports the shared implementation. Dashboard diagnostics therefore do not implement a separate health algorithm.

Manifest, tool, extension, and permission views consume existing structured deployment/control-plane projections. No Dashboard-specific database or configuration state was introduced.

## Authenticated management reads

Two read-only endpoints were added behind the existing management-secret / bounded Dashboard-session middleware:

- `GET /v1/manifest`
- `GET /v1/doctor`

The public MCP manifest, OAuth scope, public health response, Worker protocol authority, and Workspace authorization model are unchanged.

## Security boundaries

- The Dashboard remains loopback-only.
- New operational reads require existing control-plane authentication.
- Worker policy remains authoritative for Workspace permissions.
- No Worker credentials, runtime secret paths, OAuth material, or approval/JWT secrets are projected.
- No public MCP tool/schema revision was introduced.

## Validation

Executed from the isolated `feat/dashboard-control-plane` worktree:

- `npm run typecheck` — PASS
- `npm run build:dashboard` — PASS
- focused management/doctor/operations tests — 3 files / 18 tests PASS
- `npm test` — 48 files / 202 tests PASS
- `npm run test:security` — 39 files / 172 tests PASS
- `npm run test:cli-setup` — 2 files / 12 tests PASS

- `npm run build:package` — PASS after stopping the branch-only Shadow Gateway that held a Windows lock on `dist`; Shadow was restarted from the rebuilt branch package and is reachable again
- `npm audit --omit=dev` — 0 vulnerabilities
- `git diff --check` — PASS
- changed-file sensitive/machine-specific scan — 9 files PASS
- packaged Dashboard assets (`index.html`, `app.js`, `app.css`) — present

Stable runtime was not stopped, restarted, or replaced.
