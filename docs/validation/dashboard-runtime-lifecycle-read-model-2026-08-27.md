# Dashboard runtime lifecycle read model — 2026-08-27

Status: implementation validation record for `feat/dashboard-control-plane`.

## Scope

This slice implements the shared Runtime Lifecycle read model and a local supervisor seam only.

It does not add Dashboard Start/Stop/Restart controls, a supervisor HTTP listener, OS service installation/autostart, or any public MCP / Worker Protocol changes.

## Shared model

`@queqiao/operations` now defines a versioned runtime lifecycle projection with three independent axes:

- configuration readiness: `ready`, `needs_setup`, `needs_workspace`;
- observed health: `healthy`, `degraded`, `identity_conflict`, `offline`;
- management ownership: `managed`, `unmanaged`, `none`.

Contextual action flags are derived from these axes. In particular, a healthy but unmanaged runtime does not receive stop/restart authority.

## Local supervisor seam

The existing CLI lifecycle implementation now exposes `LocalRuntimeSupervisor`, implementing the shared `RuntimeLifecycleSupervisor` contract.

The adapter retains existing safeguards:

- managed PID metadata is advisory only;
- a PID is reconciled against the expected Queqiao entry point before process control;
- stale/reused PID metadata is removed rather than killed;
- restart refuses a runtime that is not proven managed by Queqiao;
- Worker identity mismatch is represented explicitly as an identity conflict;
- ordinary unhealthy Worker responses remain degraded rather than being mislabeled as an identity conflict.

CLI `serve`, `stop`, and `status` behavior remains available through the existing functions; the new structured lifecycle projection is additive and prepares a future external supervisor boundary.

## Security / architecture impact

- Public MCP manifest: unchanged.
- Worker Protocol: unchanged.
- OAuth/CSP: unchanged.
- Workspace and Worker execution authority: unchanged.
- No runtime secret/config material is exposed through the shared projection.
- No Dashboard lifecycle mutation endpoints are added in this slice.

## Validation

- Typecheck: PASS.
- Focused lifecycle tests: 2 files / 13 tests PASS.
- Full test suite: 49 files / 207 tests PASS.
- Security suite: 40 files / 177 tests PASS.
- CLI setup suite: 2 files / 12 tests PASS.
- Self-contained package build: PASS.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities.
- `git diff --check`: PASS.
- Changed-file machine-specific / secret-material review: PASS.
