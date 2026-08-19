# CLI lifecycle and enrollment Shadow acceptance — 2026-08-19

**Result: PASS (current branch candidate)**

## Accepted CLI contract

- Named role-local layouts: `gateway --name <name>` and `worker --name <name>`.
- Explicit lifecycle only: `serve [--bg]`, `stop`, and `status`; no OS service install or autostart management.
- Worker setup creates identity/listener state only; Workspace authority is added separately with `workspace add --worker <name>`.
- Human enrollment uses `gateway join-token --copy` plus a single versioned `qjq1:` join code consumed by interactive `worker join`.
- Scripted `--gateway` + `--token` enrollment remains available.
- `worker list|update|remove --name <gateway>` resolves the named Gateway role context.
- `--help` short-circuits before role configuration is required.

## Transport and enrollment invariants

The join code carries only the Worker CLI → Gateway enrollment destination and one-time token. It does not expose or authorize the Gateway → Worker runtime transport.

Worker HTTP transport remains loopback-only. A Gateway membership registry rejects duplicate Gateway-visible Worker transport endpoints with `409 worker_transport_conflict`. Transport updates enforce the same invariant.

A Worker listener port can be changed without recreating Worker identity or Workspace state:

```text
queqiao worker stop --name <worker>
queqiao worker port --name <worker> --port <port>
queqiao worker serve --name <worker> --bg
queqiao worker update --name <gateway> --worker-id <id> --endpoint http://127.0.0.1:<port>/
```

## Lifecycle correctness

PID records are advisory managed-process metadata, not authority to kill an arbitrary process. Status/start/stop reconcile the recorded PID against the expected Queqiao entry point. A dead or reused unrelated PID is removed as stale and is never killed.

## Shadow topology verified

Final tested topology:

```text
Shadow Gateway
├─ windows -> http://127.0.0.1:7577/
└─ linux   -> http://127.0.0.1:7576/
```

The Linux Worker is WSL-local and remains bound to WSL loopback. Windows sees that endpoint through the Windows WSL localhost relay; Queqiao does not publish the Worker through the Gateway public base URL.

Observed after topology repair:

- Shadow Gateway: active, healthy, identity match, HTTP 200.
- Windows Worker: active, healthy, identity match, HTTP 200.
- WSL Worker enrollment committed with stable Worker identity.
- Gateway membership contains unique transport endpoints for Windows and Linux Workers.
- `worker list --name shadow` returns both memberships.
- `worker join --name definitely-missing --help` prints help without requiring Worker config.

## Validation gates

Final branch validation after lifecycle/enrollment and documentation cleanup:

- TypeScript typecheck: PASS.
- Full test suite: 184/184 PASS.
- Security/adversarial suite: 159/159 PASS.
- Cluster suite: 28/28 PASS.
- Build: PASS.
- Self-contained package build: PASS.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities.
- Resource gate: PASS; idle Gateway/Worker CPU 0, write bytes 0, log bytes 0.
- `git diff --check`: PASS.
- `npm pack` package acceptance: PASS; generated archive inspected and removed from the worktree after validation.

## Contract impact

- Public MCP manifest: unchanged — Core Manifest Revision 6 / 17 public tools.
- Worker Protocol: unchanged — 3.0.
- Worker execution authority: unchanged.
- Gateway remains routing/auth/control-plane only.
