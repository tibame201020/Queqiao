# Production short tasks — Issue #115, internal runtime slice

**State: internal engine implemented, NOT exposed as a production MCP API.**
The authenticated Gate C marker and fixed Vitest short-task POCs established
that GitHub Actions Worker execution works. They were intentionally opt-in
test integrations. Do not enable those `actions_worker_*` endpoints in
production.

## Bounded contract implemented

`apps/gateway/src/short-task-runtime.ts` implements `ShortTaskService` and
`ShortTaskJournal`. The only registered task ID in the internal immutable
catalog is `gateway-vitest`: `node node_modules/vitest/vitest.mjs run
apps/gateway/src/actions-mcp-poc.test.ts --maxWorkers=2`, `cwd: "."`,
`mode: sync`, `timeoutMs: 45000`. Clients cannot choose a command,
additional argv, cwd, mode, environment ID, or source revision.

The constructor takes an authenticated principal ID supplied by a future
verified OAuth server entrypoint, a host-held keyed-HMAC secret, and a
40-digit revision identifier. It never accepts a caller-supplied principal
from an MCP tool argument. The source revision is an **audit field only** in
this slice: GitHub Actions checkout is not yet guaranteed to use that
revision. This MUST be fixed before production dispatch.

The service provides an internal lifecycle:

- `submit(clientId, { taskId, idempotencyKey })`: serialize the
  idempotency reservation to a private file **before** provisioning a
  temporary Worker; enforce 1 active task per owner, 16 active globally,
  and a hard cap of 256 persisted task records.
- `status(clientId, id)`: enforce ownership and reconcile readiness.
- `execute(clientId, id)`: invoke the exact command through the pinned
  leased Worker environment, verify the routing receipt, bound
  stdout/stderr to 8192 characters each, record exit code, and confirm
  runtime disposal.
- `cancel(clientId, id)`: enforce ownership and attempt lease cleanup.
- `restore()` followed by `reconcileAfterRuntimeRecovery()`: after
  the existing Coordinator has cancelled orphans, retain history and
  mark unfinished tasks `gateway_restart` (never auto re-dispatch).
  Failed cancellation retains the lease/run identity for reconciliation.

A single-process private journal uses atomic file replacement, fsync on
supported hosts, and restricted file/directory permissions. Stored owner
and idempotency identities are keyed HMAC digests. Raw OAuth client IDs,
idempotency keys, browser sessions, bearer tokens, and GitHub credentials
are never serialized; public return values omit internal owner digests.

## Verified test coverage

`apps/gateway/src/short-task-runtime.test.ts` covers:
deduplicated dispatch including concurrent submits, per-owner quota and
cross-owner denial, exact argv and routing, exit code success and failure,
idempotency conflict, recovery after restart, corrupt snapshot fail-closed,
failed cancellation retaining correlation, and no stored raw OAuth ID.
`actions-mcp-poc.integration.test.ts` asserts that the new tools **are not
advertised** by the existing public MCP API.

The security CI includes the short-task unit tests.

## Blocking work before activation

1. **Separate production MCP API and authorization**: explicit OAuth scopes,
   per-principal ownership, task catalog authorization, rate/quota budgets,
   and anti-CSRF/approval rules. Do not reuse the test-only POC toggle.
2. **Immutable source**: pin the actual GitHub Actions checkout SHA and
   verify OIDC workflow revision before accepting a task; merely storing
   the requested revision is insufficient.
3. **Durable multi-host lifecycle**: move from single-process file snapshot
   and coarse serialization to a transactional database with an ownership
   lease/lock; handle remote cancellations while a task is running,
   unexpected disconnects, retry/reconciliation, failed partial writes,
   and remote orphan discovery. The current service lock serializes
   execution; it is not a scalable job scheduler.
4. **Isolation**: exact argv cannot sandbox a malicious checked-in script.
   Use a locked-down ephemeral Worker with restricted egress, permissions,
   immutable source, and no personal data or broad cloud token.
5. **Live E2E**: after connecting the reviewed API, run the complete
   ChatGPT → OAuth → immutable task → Actions Worker → results → cleanup
   process; kill/restart the Gateway mid-task, test disconnected clients,
   cross-principal access and lost-run reconciliation.

No new public task dispatch is enabled by this PR. No local user
credentials or private data belong in the repository.
