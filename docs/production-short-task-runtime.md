# Production short tasks — Issue #115, internal runtime slice

**State: internal engine + authenticated opt-in Preview API; NOT production enabled.**
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

The Preview MCP adapter binds the principal to the validated OAuth Client ID from
the existing Gateway token middleware (never to an input argument). The service
receives a host-held keyed-HMAC secret and a
40-digit revision identifier. It never accepts a caller-supplied principal
from an MCP tool argument. The trusted source revision is propagated as a validated 40-digit SHA via
the Runtime Provider's `source_revision` workflow input. The GitHub
Actions Worker checks out that SHA and verifies `git rev-parse HEAD`
matches **before** npm install/build. Older POC dispatches that omit the
optional SHA input retain their existing checkout behavior. This is a
verified code contract, not yet a production live task acceptance.

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

## Authenticated MCP Preview (explicitly disabled by default)

The runtime config accepts an optional provider setting:

```yaml
runtimeProviders:
  githubActions:
    # ... trusted repository, workflow, tokenFile and ref
    mcpPocEnabled: false
    shortTasksPreview:
      enabled: true
      sourceRevision: 0123456789abcdef0123456789abcdef01234567
```

The Preview setting requires a lowercase 40-hex revision and cannot
coexist with `mcpPocEnabled: true`. **Do not enable it on an actual public
Production Gateway yet.** When explicitly configured on an isolated
acceptance Gateway, the four authenticated OAuth MCP tools are:

- `short_task_submit({taskId:"gateway-vitest", idempotencyKey})`
- `short_task_status({id})`
- `short_task_execute({id})`
- `short_task_cancel({id})`

The Gateway restores the private task journal and records interrupted
tasks as failed *after* the Runtime Coordinator has disposed orphan leases.
The coordinator uses its private checkpoint in Preview mode. This is
still a **single-process file journal**, not a multi-host transactional
task DB. The Gateway OAuth client ID is a client/application principal,
not a verified human end-user identity. For multi-tenant access, end-user
identity and fine-grained task authorization remain outstanding.

## Verified test coverage

`apps/gateway/src/short-task-runtime.test.ts` covers:
deduplicated dispatch including concurrent submits, per-owner quota and
cross-owner denial, exact argv and routing, exit code success and failure,
idempotency conflict, recovery after restart, corrupt snapshot fail-closed,
failed cancellation retaining correlation, and no stored raw OAuth ID.
`actions-mcp-poc.integration.test.ts` asserts that no task controls are
advertised without the Preview flag, while a real OAuth token can use the
Preview API with distinct-client ownership isolation, and Preview cannot
enable legacy `actions_worker_*` POC tools at the same time.

The security CI includes the short-task unit tests.

## Blocking work before activation

1. **Production identity and authorization**: the Preview uses existing
   OAuth client identity with `queqiao:access` and bounded quotas.
   Production requires a dedicated task scope, authenticated end-user /
   tenant mapping, per-catalog authorization, rate/budget controls, and
   an approval boundary. Preview and POC switches remain independent.
2. **Workflow provenance**: checkout SHA pinning and Runner-side HEAD
   verification are now implemented for the trusted task metadata.
   Remaining: verify the dispatched workflow's immutable revision with OIDC
   and ensure only approved workflow/configuration refs can handle an
   authorized task. Record and test an end-to-end SHA-pinned run.
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

The default production config advertises no Preview task controls.
This PR provides a deliberately isolated, explicitly enabled Preview API,
not a production deployment. No local user credentials or private data
belong in the repository.
