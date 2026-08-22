# Dashboard Control Plane v0.8 — Slice 1C validation (2026-08-22)

## Scope

Slice 1C adds the versioned mutation side of the localhost Dashboard control plane without creating a second authority or state system.

Gateway management remains loopback-only and protected by the existing local management secret. The public MCP manifest, OAuth scopes, and native Workspace execution boundary are unchanged.

## Mutation model

### Gateway-owned membership operations

Existing enrollment semantics remain authoritative. Versioned aliases are provided for Dashboard callers while legacy CLI management routes remain compatible:

- `POST /v1/join-tokens`
- `PATCH /v1/workers/:workerId/transport`
- `DELETE /v1/workers/:workerId`

Transport updates continue to verify the Worker identity and Worker Protocol before committing membership changes. Worker removal continues to use the existing membership store and managed credential cleanup rules.

### Worker-owned Workspace operations

The Gateway does not edit Worker runtime configuration. It delegates Workspace mutations by stable `workerId` through the enrolled Worker transport:

- `POST /v1/workers/:workerId/workspaces`
- `DELETE /v1/workers/:workerId/workspaces/:workspaceId`
- `PATCH /v1/workers/:workerId/workspaces/:workspaceId/profile`
- `PATCH /v1/workers/:workerId/workspaces/:workspaceId/tools/:tool`
- `PATCH /v1/workers/:workerId/workspaces/:workspaceId/commands`

Worker Protocol 3.0 gains the optional `workspace-admin-v1` capability. A Gateway fails closed with `worker_capability_missing` when an enrolled Worker does not advertise that capability; mandatory Worker Protocol 3.0 behavior is unchanged.

The authenticated Worker endpoint is `POST /v1/admin/workspace-mutations`. The Worker:

1. validates the typed mutation contract;
2. resolves and realpaths a new Workspace root locally for `workspace.add`;
3. applies the same pure runtime-config mutation functions used by CLI commands;
4. commits through the shared atomic config store;
5. force-refreshes the same Workspace catalog used for execution.

The selected default Workspace cannot be removed until another default-selection operation exists. This preserves the runtime-config invariant instead of creating an invalid reference.

## Shared semantics

`@queqiao/operations` now owns the pure Workspace mutation semantics used by both CLI and Worker administration:

- add/remove Workspace;
- set profile;
- allow/deny tool, including the existing explicit-shell rule;
- allow/deny executable command with the existing executable-name normalization/validation.

The atomic runtime config store moved to `@queqiao/config` and the CLI re-exports it for compatibility. No Dashboard-specific configuration file or database was introduced.

## Security invariants

- Gateway management listener remains bound to `127.0.0.1` and requires `x-queqiao-management-secret`.
- Management responses retain `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- Workspace mutation authority stays on the Worker; Gateway only delegates typed operations to an enrolled Worker.
- Worker admin mutation calls require the enrolled Worker credential and capability negotiation.
- Invalid mutation input returns bounded errors; unknown Worker mutation failures return `workspace_mutation_failed` without internal paths or parse details.
- Worker credential references and secret-file paths are not added to the control-plane response model.
- No public MCP tool, MCP schema, OAuth scope, or Workspace execution capability is added.

Current trust boundary: the deployed Worker HTTP transport is loopback-only. The existing enrolled Worker credential therefore authenticates both normal Gateway-to-Worker requests and the optional `workspace-admin-v1` operation. A future non-loopback Worker transport must strengthen or separately scope the administrative control channel before exposing this capability remotely.

## Validation

Focused tests cover:

- shared mutation semantics;
- Worker atomic persistence plus immediate Workspace catalog reload;
- unauthenticated Worker admin rejection;
- default Workspace removal rejection;
- Gateway capability negotiation and fail-closed behavior;
- versioned Gateway Workspace mutation delegation;
- versioned Worker transport update/removal through existing enrollment semantics;
- existing CLI Workspace-add behavior using the shared mutation layer.

Final validation gates from the Slice 1C worktree before commit:

- `npm run typecheck` — PASS.
- `npm test` — PASS, 46 test files / 195 tests.
- `npm run test:security` — PASS, 37 test files / 165 tests.
- `npm run test:cli-setup` — PASS, 2 test files / 12 tests.
- `npm run build:package` — PASS.
- `git diff --check` — PASS.
- bounded scan across 23 changed/untracked files for machine-specific paths, tailnet hostnames, credentials, private keys, bearer material, and secret-like assignments — PASS.

This slice does not claim a Stable-runtime smoke test. It does not push, merge, or replace the Stable runtime.

## Deferred

The next slice may build the React Dashboard against the completed read + mutation control-plane surface. Non-loopback Worker administration, stronger/split remote control credentials, step-up approval runtime, and broader remote transport remain separate future work.
