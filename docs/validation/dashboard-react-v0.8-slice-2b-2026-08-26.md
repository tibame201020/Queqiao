# Dashboard React v0.8 Slice 2B validation — 2026-08-26

## Scope

Slice 2B extends the Local Operations Dashboard without changing the public MCP surface or introducing a second configuration/state system.

Implemented:

- `queqiao dashboard open [--name <gateway>] [--no-open]`.
- One-time Dashboard browser-session bootstrap:
  - CLI reads the existing local Gateway management secret.
  - CLI calls authenticated `POST /v1/dashboard-sessions`.
  - Gateway creates a short-lived one-time code in memory only.
  - CLI launches `/dashboard/#session=<code>`; URL fragment is not part of the HTTP request line.
  - Dashboard exchanges the code once at `POST /dashboard/session`.
  - Gateway returns a bounded in-memory session token.
  - Dashboard sends the token only in `x-queqiao-dashboard-session`.
  - browser sessions cannot mint additional session codes and can revoke themselves.
- Manual management-secret login remains available as a local recovery path.
- Dashboard Worker management:
  - create Worker join token,
  - update loopback Worker transport,
  - remove Worker.
- Dashboard Workspace management:
  - add Workspace through Worker-authoritative `workspace-admin-v1`,
  - remove non-default Workspace,
  - existing profile/tool/command controls remain unchanged.

## Security invariants

- Management listener remains loopback-only.
- Master management secret is not returned to the browser by the launcher flow.
- Default successful CLI launcher output does not include the one-time code.
- One-time code is hashed in Gateway memory, consumed on first successful exchange, and expires quickly.
- Dashboard session token is hashed in Gateway memory, expires after a bounded interval, and is revocable.
- A Dashboard session cannot call `POST /v1/dashboard-sessions` to extend itself.
- No session/codes are written to config, membership state, repository files, URL query strings, cookies, or public MCP responses.
- Dashboard session authentication uses a custom request header, so there is no ambient cookie credential/CSRF authority.
- Existing local rate limiting, `no-store`, `nosniff`, and Dashboard CSP remain in force.
- Worker/Workspace mutations continue through the existing versioned control-plane and Worker-authoritative mutation path.

## Focused validation

- TypeScript project build/typecheck: PASS.
- Dashboard session broker tests: PASS.
- Gateway management integration tests: PASS, including one-time exchange, session-authenticated control-plane access, no session self-minting, and revoke.
- Dashboard CLI launcher test: PASS, including master-secret header use, fragment bootstrap URL, and no code in successful CLI result.
- React dashboard bundle: PASS.

## Full validation

- `npm run typecheck`: PASS.
- `npm test`: PASS — 48 test files / 201 tests.
- `npm run test:security`: PASS — 39 test files / 171 tests.
- `npm run test:cli-setup`: PASS — 2 test files / 12 tests.
- `npm run build:package`: PASS.
- `npm run build:dashboard`: PASS after final whitespace cleanup.
- `git diff --check`: PASS.
- `npm audit --omit=dev --audit-level=moderate`: PASS — 0 vulnerabilities.
- Sensitive/machine-specific scan: PASS across 13 changed/untracked files.

## Deferred

- Browser visual/E2E validation against a replaced Stable runtime is intentionally not claimed in this slice.
- Remote/non-loopback Dashboard access is not supported.
- Long-lived user accounts, cookies, refresh sessions, and remote administration are not introduced.
