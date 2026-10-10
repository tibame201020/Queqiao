# Production short tasks - Issue #115

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
receives a separate host-held keyed-HMAC owner key and a
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
- `cancel(clientId, id)`: enforce ownership, persist `cancelling`,
  abort the Worker request and dispose the lease without holding the
  journal transaction during GitHub cancellation. Concurrent cancellation
  calls share one result. Provider failures retain a retryable
  `cancel_failed` status.
- `restore()` followed by `reconcileAfterRuntimeRecovery()`: after
  the existing Coordinator has cancelled orphans, retain history and
  mark unfinished tasks `gateway_restart` (never auto re-dispatch).
  Failed cancellation retains the lease/run identity for reconciliation.

### Concurrent execution and cancellation

The service persists a short `running` transition, then releases the
journal transaction while the Worker executes. The MCP owner may query
status, reject duplicates or cancel the task during an active CLI. Cancellation
persists `cancelling` before issuing an AbortSignal and cancelling the GitHub
Actions lease. When the provider is slow, status remains available and
duplicate cancels share the same cleanup promise. A successful late Worker
response cannot overwrite `cancelled`. Aborting during Worker preflight
prevents launching a command with an already-aborted signal.

A failing provider cancellation preserves `cancelling`, lease identity,
GitHub Run ID and `cancel_failed` for operator or owner retry. Restart
recovery converts nonterminal tasks to `gateway_restart` only *after*
the Coordinator has recovered and cancelled orphan Workers. Task submission
and final disposal still perform some remote operations while holding the
single-process transaction. This is not a distributed task scheduler.

### Owner key continuity

Preview requires `ownerKeyFile` (a separate, random, >=32-byte secret,
outside the repository) and refuses to use the JWT signing key as task owner
identity. Keep this key consistent across Gateway restarts and JWT rotations.
Task journals include a **non-secret keyed verification value** and reject
startup with a mismatched owner key if persisted tasks exist. This deliberately
avoids silently losing access to existing task history after key rotation.

Old Preview journals created before the owner-key proof existed are **not
silently migrated**. Before upgrading an isolated Preview deployment, cancel
and reconcile outstanding GitHub Actions leases, safely archive the earlier
journal and use a fresh isolated Preview state directory. Real deployments
require a reviewed, explicit migration path and backup process.
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
      ownerKeyFile: /etc/queqiao/short-task-owner.secret
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
failed cancellation retaining correlation, concurrent status while the CLI is
running, cancellation deduplication, abort before dispatch, owner key stability
and rejection of mismatched journal owner keys, and no stored raw OAuth ID.
`actions-mcp-poc.integration.test.ts` asserts that no task controls are
advertised without the Preview flag, while a real OAuth token can use the
Preview API with distinct-client ownership isolation, and Preview cannot
enable legacy `actions_worker_*` POC tools at the same time.

The security CI includes the short-task unit tests.

## Isolated real OAuth MCP → GitHub Actions Preview acceptance (2026-10-09)

**PASS in one controlled single-host Preview session**:

- [GitHub Actions Run 37929140957](https://github.com/tibame201020/Queqiao/actions/runs/37929140957)
  executed source SHA `8b1fa8aeef6b4e46095f2a956cf5a661095d4305`
  on the isolated acceptance branch.
- A privately stored OAuth MCP test client used
  `short_task_submit` → `short_task_status` → `short_task_execute`
  → `short_task_status` (not the test-only `actions_worker_*` methods).
  The Gateway was bound to localhost and used a disposable HTTPS Quick Tunnel.
- The Workflow **Verify source revision** step passed, and OIDC enrollment
  plus reverse WebSocket readiness succeeded. The MCP routing receipt's
  environment `gha_5f26221cb69f43218f465d74` matched the lease.
- The Runner executed the exact catalogued Node/Vitest command under
  `/home/runner/work/Queqiao/Queqiao`. Result: `8 passed`,
  `exitCode: 0`, empty `stderr`; durable Task Journal recorded
  `completed` with the same GitHub Run ID and exit code.
- Runtime lease disposal was confirmed. GitHub finished
  `completed / cancelled`; **Cleanup** step `success`.
- The private task journal did not include the raw OAuth client ID,
  access token, approval secret or other identity material.

**Boundary:** this is a controlled Preview E2E by an independently
authenticated OAuth MCP client. It is **not** a ChatGPT Browser Harness
execution of the new Preview API, not a live managed cloud deployment,
and not a multi-instance recovery acceptance. See the separate isolated
real-Runner cancellation, restart, and client-disconnect tests below.
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
5. **Final production E2E**: a Preview real OAuth MCP → SHA-pinned
   Actions Worker → durable result → Cleanup run passed. Still required:
   ChatGPT Browser Harness with the new API, host powered off, forced
   Gateway restart mid-task, disconnected client recovery, cross-tenant
   identity, and orphan reconciliation.

The default production config advertises no Preview task controls.
This PR provides a deliberately isolated, explicitly enabled Preview API,
not a production deployment. No local user credentials or private data
belong in the repository.
## Controlled in-flight cancellation acceptance task

Only on isolated, explicitly enabled Preview Gateways, the immutable
`gateway-cancel-smoke` catalog task runs:

```text
node scripts/runtime-cancel-smoke.mjs
```

The checked-in script writes `runtime-cancel-smoke.started` with the
non-sensitive marker `QUEQIAO_ACTIONS_CLI_STARTED` in the Runner workspace,
then holds a bounded 85-second process. Its exact argv, cwd, sync mode and
105-second timeout are allowlisted in the ephemeral Actions POC Worker.
The task has a 240-second Runtime Lease TTL and accepts no arguments.

**Live acceptance must** obtain an actual GitHub Run ID, poll the Worker
until ready, call `short_task_execute` while separately polling the
Worker's marker via `read_file`, and only then send `short_task_cancel`.
Verify that execute terminates as cancelled, Task Journal stays
`cancelled`, Lease disposes, GitHub Actions concludes cancelled, and
Workflow Cleanup succeeds. Mere acceptance of a cancel request before the
remote script starts does **not** pass the in-flight test.

The marker file is created at runtime on the disposable GitHub-hosted Runner;
it is not checked into the repository. Never run this task with user data
or broad credentials. This is not a general-purpose CLI catalog.
## Isolated real Runner lifecycle acceptance (2026-10-09)

The following acceptance tests used a real authenticated OAuth MCP Preview
client, an isolated Gateway, a temporary public HTTPS ingress, a fixed
Actions Worker checkout at reviewed SHA `56dac780f8127ad809e55d55e485b22810135a62`,
and the bounded `gateway-cancel-smoke` task. All run receipts were checked
against the Gateway's private Task Journal and the GitHub Actions job steps.
No user/browser credentials or local session data were committed.

| Acceptance | Actions run | Durable task outcome | GitHub outcome |
| --- | --- | --- | --- |
| Cancel **after remote CLI started** | [37936357139](https://github.com/tibame201020/Queqiao/actions/runs/37936357139) | `cancelled`; original execute returned an error | `completed / cancelled`; Cleanup success |
| Force-stop **Gateway OS process while remote CLI is running** | [37936682417](https://github.com/tibame201020/Queqiao/actions/runs/37936682417) | `failed`, reason `gateway_restart`; Run ID retained; checkpoint lease cleared on new Gateway process | `completed / cancelled`; Cleanup success |
| Kill **OAuth MCP Client** while remote CLI runs; reconnect as same client | [37937027779](https://github.com/tibame201020/Queqiao/actions/runs/37937027779) | `completed`, exit code 0; reconnected client retrieved completed marker and matched routing | `completed / cancelled`; Cleanup success |

For cancellation and restart, the testing client read
`runtime-cancel-smoke.started` from the **actual GitHub-hosted Worker**
with the leased environment ID, then verified Task Journal state `running`
**before** terminating either the Client/Task or the Gateway. The restart
test also confirmed the lease was present in the durable runtime checkpoint
before terminating the old Gateway process, then recovered it with the new
OS process. For disconnection, the original client process was force-killed,
while Gateway remained healthy; a fresh MCP connection using the same
authorized client identity observed `running` and later `completed`.

**Verdict: PASS** for these three controlled single-Gateway real-Runner
failure scenarios. This does **not** test distributed Gateway instances,
simultaneous lease owners, revocation/key rotation mid-flight, hosted Gateway
availability when the local PC is off, or arbitrary user-supplied code.
The exact command policy is a test-only fixed-script allowlist and not a
general-purpose code execution sandbox.
## Single-host Gateway state ownership - Issue #115 safety gate

The JSON Task Journal and GitHub Actions checkpoint are **single-process**
stores. The Gateway CLI now acquires an exclusive local OS socket before
calling recoverPending() or accepting clients. The socket binds to a
deterministic loopback port **30000-45999** derived from the canonical
real filesystem path of the Gateway state directory. A competing process
with the same state directory (including symlink aliases) fails closed,
even when the HTTP management/worker listener ports are different.

The OS releases the socket after SIGKILL; a new Gateway can reconcile
orphaned leases using the private checkpoint. Graceful shutdown releases
ownership only after Gateway network servers close. No stale PID file
needs manual deletion or ambiguous stale-file races.

**Scope:** this is a single-host safety guard, **not** a distributed lock,
election, or transactional scheduler. Another host or network namespace
can still access the same shared state. Unrelated local programs using
the deterministic port can also block startup (fail closed). Operators
must not share the JSON state directory between multiple Gateway hosts.
Production multi-instance dispatch still requires a central transactional
store, fenced leases, and orphan-run reconciliation.

**Actual Gateway OS acceptance (2026-10-09, isolated local test):**
Gateway A with HTTP port 14110 and Gateway B with HTTP port 14120
were configured against the same private state directory. A's OAuth
metadata returned HTTP 200. While A was alive, B exited with
"Gateway state directory already owned", and A remained healthy.
After force-killing A, B launched with the same state directory and
returned HTTP 200. Result: **PASS**. Both instances and their private
test credentials were stopped/cleared after verification. This remains
a same-host guard, not a multi-host coordination test.
TDD and cross-process tests cover competing owners, symlink aliases,
separate state directories, graceful release and actual process SIGKILL.
The new cases run in the GitHub Actions Security baseline.
## Shared PostgreSQL task coordination ledger (Issue #115, first database slice)

An independent, non-public transactional Ledger now exists in
apps/gateway/src/postgres-task-ledger.ts. It uses the runtime pg dependency
and PostgreSQL 16+. This Ledger is NOT wired into the Gateway OAuth MCP
tool handler, Runtime Coordinator, or Worker WebSocket routing. The
existing JSON-based single-host path stays unchanged for now.

The coordination contract works across two separate Gateway DB pools:

- Atomic reservation: an advisory transaction lock serializes quota
  checks with insertion. A unique owner + idempotency digest prevents
  replay from reserving twice. One active task per owner, 16 active
  globally, and a hard cap of 256 retained rows.
- Fenced ownership: queued work can be claimed exactly once. PostgreSQL
  bigint fencing epochs, Gateway UUIDs and database-clock expiries
  protect Run ID binding, renewal, and result updates. JavaScript carries
  fencing values as strings to avoid loss of integer precision.
- Cancellation: a verified owner can request cancel; the state becomes
  cancelling and the old fence is invalidated. Late completions fail.
- Expiry: already-claimed tasks move to reconciling, NEVER queued.
  Cancellation and reconciliation cleanup can be claimed exclusively;
  expired cleanup claims can be taken over with a larger fence.
  Cleanup acknowledgment is an internal API that MUST be called only
  after independent verification of GitHub Actions disposal/nonexistence.
- Privacy: store only keyed owner/idempotency digests, trusted catalog
  names, immutable source SHA and runtime correlation IDs. No raw OAuth
  client identity, browser state, credentials or user-supplied commands.

Real PostgreSQL integration tests in
apps/gateway/src/postgres-task-ledger.test.ts use private temporary
schemas. They exercise 24 concurrent requests through two independent
connection pools, quota races, exclusive claims, cancellation fencing,
expired lease reconciliation, cleanup ownership and timed takeover.
GitHub Actions Security Baseline includes a PostgreSQL 16 container job.
Its credentials are ephemeral test-only fixtures, not production secrets.

Remaining production requirements: versioned schema migrations, managed
PostgreSQL credentials/TLS/backups, safe horizontal Gateway routing,
transactionally paired GitHub Actions dispatch, unknown-run discovery,
fenced cross-host cancellation/reconciliation, tenant authorization and
live multi-Gateway outage testing. This database slice alone must not be
exposed as production multi-Gateway task dispatch.
## Fenced PostgreSQL to GitHub Actions dispatch adapter (Issue #115 follow-on)

The internal PostgresActionsDispatch adapter in
apps/gateway/src/pg-actions-dispatch.ts connects the PostgreSQL
transactional Ledger to the existing GitHubActionsRuntimeCoordinator.
It is **not registered as an MCP tool**; the public/Preview deployment
still uses the earlier single-Gateway journal path.

- The Ledger first issues an exclusive, fenced claim. The task UUID
  is passed as the trusted leaseId to RuntimeCoordinator.provision.
  The Coordinator now accepts an optional pre-allocated UUID. GitHub's
  workflow_dispatch lease_id, Worker OIDC claim and PostgreSQL task
  reference the same immutable ID.
- Only the trusted catalog source revision is sent to the provider.
  The returned GitHub Run ID, original lease UUID and expected Worker
  environment are checked before binding the run to the still-valid
  fencing token in PostgreSQL.
- Two Gateways racing for the same task result in **one** provider call.
  Cancellation or expiry before bind invalidates the fence and causes
  a compensating GitHub cancellation attempt by the originating Gateway.
- Lost/malformed provider responses or failed bindings quarantine the
  task as reconciling if its fence remains valid. Tasks cancelled by
  another Gateway remain cancelling. Automatic redispatch is forbidden.
  A failed remote cancellation is NOT treated as confirmed disposal.

TDD uses two independent PostgreSQL connection pools and checks
concurrent dispatch, a real Runtime Coordinator with fake GitHub API,
OIDC registration and Run ID matching, cancellation racing a provider
response, provider failure, malformed receipts and failed compensation.
The GitHub Actions Security Baseline PostgreSQL 16 job runs these tests.

**Remaining blocker:** GitHub workflow dispatch and PostgreSQL commit
cannot be atomic. If GitHub accepts a run and the response is lost,
the task is quarantined without a confirmed Run ID. A trusted GitHub
run-discovery and reconciliation implementation is still needed.
Distributed Worker transport/affinity, formal end-user/tenant scope,
cloud hosting, network partition recovery and a real multi-Gateway
GitHub Actions E2E are NOT complete. Do not enable this adapter as
production task dispatch before those gates pass.
## Unknown GitHub Actions Run identification (Issue #115 discovery slice)

A workflow_dispatch request can be accepted by GitHub but lose the
response before the Gateway stores its Run ID. The PostgreSQL task stays
in reconciling. It MUST NOT be blindly redispatched.

The isolated GitHub Actions POC workflow now sets run-name to
"Queqiao Runtime <lease UUID>". The new read-only
GitHubActionsRunDiscovery uses GitHub's per-workflow REST list endpoint
and checks ALL of these against trusted server-side metadata: exact
run title, repository, workflow path, workflow_dispatch event, configured
branch, expected dispatch actor, run attempt 1, and a bounded creation
window based on the persisted task creation timestamp (minus 2 minutes,
plus 20 minutes). The scan uses up to 10 pages of 100 runs with a
fail-closed pagination and 1000-result ceiling. Zero candidates yields
not_found, more than one yields ambiguous; listing errors or incomplete
results are never considered successful.

PostgresUnknownRunInspector only allows the original HMAC task owner to
perform this read-only lookup on a reconciling task without a recorded
runId. It uses PostgreSQL created_at, not a caller-provided timestamp.
No OAuth identity, GitHub token or workflow input is committed to the
repository.

SECURITY LIMIT: GitHub run-name/display_title is user-configurable,
not a cryptographic dispatch attestation. Even a unique candidate is
ONLY an investigation lead. This discovery code never persists the
candidate as a verified Run ID, cancels it, authorizes Worker OIDC, or
marks a task disposed. Production still needs an authenticated
run-provenance verification and final-state/disposal reconciler, then
a multi-Gateway worker routing/failover E2E. Existing production/Preview
dispatch remains unchanged and disabled by default where configured.
