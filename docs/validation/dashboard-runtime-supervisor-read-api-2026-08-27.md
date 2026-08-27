# Dashboard Runtime Supervisor Read API — Validation Record

Status: implementation validation record for `feat/dashboard-control-plane`.

## Scope

This slice adds an external localhost-only Runtime Supervisor transport and a Gateway management lifecycle read API.

It does not add lifecycle mutation HTTP routes, Dashboard Start/Stop/Restart controls, OS service/autostart, or public MCP / Worker Protocol changes.

## Runtime Supervisor transport

The CLI now exposes `queqiao supervisor serve [--port <port>]`.

The supervisor:

- binds only to `127.0.0.1`;
- uses a dedicated random supervisor secret, separate from the Gateway management secret;
- stores that secret in the hardened local Queqiao state directory;
- authenticates every lifecycle request with `x-queqiao-supervisor-secret`;
- resolves named Gateway / Worker layouts locally and delegates to `LocalRuntimeSupervisor`;
- never returns the reconciled managed PID over HTTP;
- rejects invalid role/name input before resolving process authority;
- applies `Cache-Control: no-store` and request rate limiting.

The default loopback port is `7564` and may be overridden for the CLI host. Gateway discovery uses `QUEQIAO_SUPERVISOR_PORT` when present.

## Gateway lifecycle read API

The Gateway management listener now exposes authenticated `GET /v1/runtime-lifecycle`.

It reads the current named Gateway plus joined Worker environment names through the external supervisor client and returns the shared readiness / health / ownership / actions projection.

When the supervisor is unavailable, the management API returns a bounded snapshot with `supervisor.reachable=false` and does not leak filesystem, secret, PID, or raw transport errors.

The route remains behind the existing management-secret / bounded Dashboard-session authorization boundary.

## Runtime identity propagation

CLI foreground/background lifecycle launch now propagates `QUEQIAO_RUNTIME_NAME` to the child runtime so the Gateway can identify its named lifecycle target without deriving identity from filesystem paths.

## Security / architecture impact

- Public MCP surface: unchanged.
- OAuth scopes / CSP: unchanged.
- Worker Protocol: unchanged.
- Workspace authority: unchanged.
- Gateway management secret is not reused by the supervisor.
- Supervisor secret is never returned by either HTTP API.
- Managed PID remains supervisor-local and is stripped from public projections.
- Gateway is a supervisor client, not the process-control authority that would stop itself.
- No lifecycle mutation endpoint is enabled in this slice.

## Validation

- Typecheck: PASS.
- Focused supervisor/lifecycle/management tests: 3 files / 21 tests PASS before final regression.
- Full test suite: 50 files / 211 tests PASS.
- Security suite: 41 files / 181 tests PASS.
- CLI setup suite: 2 files / 12 tests PASS.
- Package build: PASS.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities.
- `git diff --check`: PASS.

No Stable runtime was restarted or replaced during validation.
