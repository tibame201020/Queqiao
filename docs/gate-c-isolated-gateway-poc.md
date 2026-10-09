# Gate C: isolated ChatGPT → Actions Worker acceptance

Status: **Gate C end-to-end POC PASS (2026-10-09)** on an isolated temporary HTTPS ingress. This is not a production deployment or a persistent-host acceptance.

## Why a separate Gateway is required

The existing public MCP `read_file` call only routes to an already registered Worker.
The GitHub Actions Runtime Provider was previously callable only from the Gateway's
loopback management API, so enabling the provider alone cannot satisfy Gate C.

This slice adds four **experimental** MCP tools, enabled only when
`gateway.runtimeProviders.githubActions.mcpPocEnabled: true`:
- `actions_worker_start`: dispatch one Worker using a fixed 180-second TTL.
- `actions_worker_status`: read the requesting OAuth client's lease state.
- `actions_worker_read_marker`: read only `runtime/poc-marker.txt`, assert the
  exact `QUEQIAO-GITHUB-CONNECTOR-OK` marker and expected environment, then dispose.
- `actions_worker_cancel`: dispose a requesting client's unfinished lease.

The control is bound to the authenticated OAuth `client_id`. Only one POC
lease may be active at a time; a Gateway process can dispatch at most three runs.
The Worker workflow now provisions a **read-only** Workspace with a narrow tool
allowlist and no command execution. Runtime expiry cleanup remains active.

## Isolated Gateway setup

Prepare a separate, persistent host and a **stable HTTPS public URL**. Use a
different state directory, three unused ports, OAuth credentials, and a
fine-grained GitHub token with the workflow dispatch/cancel permissions.

The configuration must live **outside the repository**. Example structure
(placeholders are not runnable values):

```yaml
version: 1
gateway:
  publicBaseUrl: https://<stable-gateway-domain>/
  listen: {host: 127.0.0.1, port: 13010}
  managementListen: {host: 127.0.0.1, port: 13011}
  workerSessionListen: {host: 127.0.0.1, port: 13012}
  stateDirectory: <private-absolute-state-path>
  approvalSecretFile: <private-absolute-approval-secret-path>
  jwtSigningSecretFile: <private-absolute-jwt-secret-path>
  allowedRedirectOrigins: [https://chatgpt.com]
  runtimeProviders:
    githubActions:
      owner: tibame201020
      repo: Queqiao
      workflowId: runtime-provider-poc-worker.yml
      ref: main
      tokenFile: <private-absolute-github-token-path>
      mcpPocEnabled: true
extensions: []
workspaces: []
```

Use `QUEQIAO_CONFIG_FILE` to start a **separate** Gateway process. Do not
replace the existing Gateway configuration, state or OAuth identity.
Keep its management listener and the Browser Harness CDP port bound to loopback.
Do not commit any tokens, cookies, browser profile, state or config with secrets.

## Gate C live acceptance

1. Register **another** ChatGPT Queqiao connector pointing to the stable
   isolated `/mcp` URL. Complete normal OAuth authorization.
2. On the trusted persistent browser, use the manual Harness profile (no schedule).
   Prompt ChatGPT to invoke `actions_worker_start`, then
   `actions_worker_status` until `ready`, then `actions_worker_read_marker`.
3. Capture the **same ChatGPT conversation** showing the tool invocation and
   exact marker, plus the tool result's `routing.environmentId` receipt.
4. Verify that the corresponding Gateway lease is `disposed` and the GitHub
   Actions Worker run reaches `completed/cancelled` (eventually consistent).
5. On any interruption, invoke `actions_worker_cancel` or use the local
   authenticated management API and verify cancellation.

A passing MCP integration test alone **is not Gate C PASS**. The real acceptance
requires a ChatGPT Web-triggered tool invocation, stable ingress, OIDC Worker
enrollment, marker returned to the browser, and verified cancellation.

## Live acceptance progress (2026-10-09, local POC host)

- **PASS — isolated process/config**: built and launched the #110 Gateway on
  loopback ports 13010 (MCP), 13011 (management), and 13012 (gRPC);
  state, generated signing secrets, and runtime YAML remained outside git.
- **PASS — HTTPS routing smoke test**: an account-less Cloudflare Quick Tunnel
  forwarded a real public HTTPS GET of
  `/.well-known/oauth-authorization-server` to the isolated Gateway.
  Local and external requests both returned HTTP 200 while both processes
  stayed alive in the same controlled execution. The isolated OAuth issuer
  matched the tunnel hostname. The processes were stopped after this check.
- **EXPECTED LIMITATION — ephemeral ingress**: Quick Tunnel hostname changes
  when restarted and provides no uptime guarantee. This proves ingress
  connectivity only; it does **not** meet the stable-host Gate C criterion.
- **NOT TESTED — GitHub dispatch**: the local config uses an intentionally
  nonfunctional GitHub token placeholder. The connector's authenticated
  credential is not exported by the assistant. The target workflow is
  active on GitHub and the POC branch exists, but this is not dispatch proof.
- **NOT TESTED — ChatGPT connector end-to-end**: no new ChatGPT OAuth MCP
  connector was registered or used, so no genuine
  `actions_worker_start → status → read_marker` ChatGPT UI transcript or
  matching Actions cancellation record exists yet.

An earlier attempt using separate background processes returned Cloudflare
HTTP 530 after both managed processes disappeared. The subsequent
same-lifetime controlled test returned HTTP 200. The exact source of the
background process termination has not been established; do not label it
a Cloudflare or Gateway defect without further evidence.

Before final acceptance, use a stable, owned HTTPS hostname, a separately
authorized fine-grained GitHub credential stored outside git, and a new
ChatGPT OAuth MCP connector. Preserve the exact Worker run ID, verified
marker, and disposal/cancellation receipt.

## Limitations

This POC is single-tenant. When `mcpPocEnabled` is true, the isolated Gateway
saves non-secret run correlation data to a private checkpoint and performs
fail-closed cancellation of any recorded unfinished Actions Worker **before**
binding listeners on restart. An existing OAuth client's in-flight lease is
**not resumed**; the restarted Gateway requires a fresh dispatch. Do not run
this on a shared Gateway or reuse it as a general-purpose runtime scheduler.

A remaining crash window exists **between a successful GitHub dispatch and
the first durable checkpoint write**. The Worker workflow's TTL is the final
backstop in that case. Production operation still requires remote orphan
reconciliation, persistent ingress, credential rotation, and availability
supervision.

The Browser Harness still depends on a continuously available authenticated
Chrome host. A local persistent profile does not function when that host is
offline. Moving it to a continuously running host requires a separate security
review and session lifecycle plan. The legacy
`CHATGPT_BROWSER_SESSION_CAPSULE` is not used by this design; revoke and remove
it only through the authorized credential cleanup procedure.

## Continuation: verified runtime, pending ChatGPT OAuth user approval (2026-10-09)

The previous snapshot above is superseded by this execution evidence:

- **PASS — GitHub CLI credential provider**: isolated opt-in config supports
  `auth: gh-cli` only with `mcpPocEnabled: true`. The Gateway invokes
  `gh api` using the machine's existing authenticated credential manager
  without copying or exporting the GitHub token.
- **PASS — true OAuth MCP client, not a mock**: DCR registration, PKCE approval,
  MCP initialization and four opt-in tool registrations succeeded.
- **PASS — GitHub Actions dispatch and live OIDC enrollment**: workflow
  [run 37830611693](https://github.com/tibame201020/Queqiao/actions/runs/37830611693)
  returned a registered, reachable Worker, with environment ID
  `gha_c3c630ca59fe4f0e91b01d6c`.
- **PASS — real MCP routing and marker**: `actions_worker_read_marker`
  returned `QUEQIAO-GITHUB-CONNECTOR-OK`, `selectedTransport: websocket`,
  and lease `state: disposed`.
- **PASS — GitHub resource recovery**: run `37830611693` eventually reached
  `completed/cancelled`; its workflow `Cleanup` step succeeded.
- **PARTIAL — ChatGPT UI entry point**: the signed-in Chrome session opened
  ChatGPT Plugins and created a temporary plugin named
  `Queqiao Gate C E2E POC` pointing at the isolated public HTTPS Gateway.
  ChatGPT registered an OAuth client with the Gateway and navigated to its
  `/oauth/authorize` page. The human owner must complete approval in
  the browser. **No ChatGPT conversation has yet invoked the Worker tool.**

For the ephemeral local POC, private config and approval material are under
`%LOCALAPPDATA%/Queqiao/gate-c-poc-110`, outside the git worktree. The public
Quick Tunnel URL is session-bound and is not a persistent production ingress.
Once the owner authorizes the ChatGPT connector, the final acceptance must
capture the **ChatGPT conversation's own** tool invocation, actual marker,
routing receipt and correlated cancelled Actions run. Do not claim full Gate C
acceptance based solely on the local OAuth MCP client.

## Gate C native ChatGPT connector acceptance — PASS (2026-10-09)

This section supersedes the historical "pending ChatGPT OAuth" notes above.
The owner completed the isolated ChatGPT connector's OAuth authorization.
The subsequent calls were made **from the ChatGPT conversation itself**
through the installed `Queqiao Gate C E2E POC` connector, not via a test
client, a mock Coordinator, or a local CLI.

| Evidence | Observed result |
| --- | --- |
| MCP `actions_worker_start` | `state: provisioning`, GitHub Actions run `37880094019` |
| MCP `actions_worker_status` | `state: ready`, `ready: true` |
| MCP `actions_worker_read_marker` | `QUEQIAO-GITHUB-CONNECTOR-OK` |
| Runtime Lease disposal | `state: disposed` |
| Worker route receipt | `routing.environmentId: gha_65d4fd92e52949049acb7ab0`, `selectedTransport: websocket` |
| Dispatch environment | `gha_65d4fd92e52949049acb7ab0` (exact route match) |
| GitHub run terminal state | `completed / cancelled` |
| GitHub workflow `Cleanup` step | `completed / success` |

GitHub Actions run:
https://github.com/tibame201020/Queqiao/actions/runs/37880094019

**Verdict:** The Gate C native ChatGPT → OAuth MCP → isolated Gateway →
GitHub Actions Worker → reverse WebSocket → marker → disposal/cancellation
**end-to-end proof is PASS**.

**Scope limitation:** The endpoint is a Cloudflare Quick Tunnel on a local
machine, not a reserved hostname or continuously available hosting service.
This proves a live end-to-end session, **not** production availability.
The experimental MCP tools, per-process dispatch budget, process-local
lease ownership, and 180-second TTL are POC-only. Promote separately with
stable ingress, restart-safe ownership, operational monitoring, and
credential lifecycle controls.

No OAuth tokens, approval secrets, browser cookies or user-specific browser
state belong in this repository.
## Gate C+ restart recovery acceptance (2026-10-09)

A follow-up TDD slice adds a private atomic checkpoint for unfinished
GitHub Actions runtime leases, scoped to the explicitly enabled
`mcpPocEnabled` Gateway. It stores only validated runtime lease descriptors,
not OAuth principals, cookies, browser profiles or access tokens.

On startup, the Gateway reads the checkpoint, cancels each outstanding
correlated run using GitHub Actions, and clears the checkpoint only after
success. Corrupt data or an unverified cancellation stops Gateway startup
before the MCP listener can accept requests. Journal writes are serialized to
prevent an older snapshot from overwriting a newer one. The `gh-cli` adapter
uses bounded retries and checks the exact GitHub run's terminal status when
cancellation is temporarily rejected.

**Real provider recovery smoke test** (two separate Coordinator instances
using a private local checkpoint, **not** a full OS Gateway process restart):

- [Run 37881977813](https://github.com/tibame201020/Queqiao/actions/runs/37881977813):
  initial immediate cancellation failed; a later GitHub cancellation request
  succeeded, and the repaired recovery path subsequently cleared the record.
- [Run 37882127066](https://github.com/tibame201020/Queqiao/actions/runs/37882127066):
  a new Coordinator read one persisted run, submitted cancellation, and
  verified the checkpoint was empty.
- Both Actions runs reached `completed / cancelled`.
- Unit tests cover checkpoint corruption, failed cancellation retaining
  the record, concurrent checkpoint writes, compensation after write failure,
  and the CLI adapter's eventual-consistency retry behavior.

**Result:** Gateway-restart cancellation logic and real GitHub cancellation
are verified separately. A real OS-level crash-and-restart test and stable
HTTPS host remain outside this acceptance slice.
## Gate C++ OS restart and browser UI smoke (2026-10-09)

Two tests now distinguish the previous Coordinator-only restart simulation from
a real Gateway process lifecycle.

**Real OS Gateway restart acceptance — PASS:**

1. Start an isolated Gateway with a private state directory and an active
   temporary Cloudflare HTTPS tunnel (local MCP and management ports remain
   loopback-only).
2. Dispatch [Actions run 37911245452](https://github.com/tibame201020/Queqiao/actions/runs/37911245452)
   via the loopback management API. Confirm the Worker registers by OIDC and
   reaches `ready`, with its lease durably recorded.
3. Forcefully terminate the Gateway process (without stopping the tunnel).
   Confirm the Gateway listener closes while the checkpoint survives.
4. Start a **new Gateway OS process** with the same private configuration and
   checkpoint. Confirm it opens its listeners and the prior run is removed
   from the checkpoint after cancellation is accepted.
5. GitHub Actions run reaches `completed/cancelled`. Worker claim succeeded;
   `Cleanup` finished successfully.

The first OS restart attempt used an offline, expired Quick Tunnel hostname,
so the Actions job failed its join step before a meaningful cancellation
could be observed; see
[run 37911026800](https://github.com/tibame201020/Queqiao/actions/runs/37911026800).
This attempt is **not** counted as a recovery PASS.

**Browser Harness adapter UI smoke — PASS (separate)**:

The original installed Harness v0.3.0 expects legacy
`#prompt-textarea`; current ChatGPT uses a visible contenteditable textbox
and a composer form submit button. A dedicated test-first fix is on
[Browser Harness PR #8](https://github.com/tibame201020/queqiao-harness-browser/pull/8).
A direct invocation of its built ChatGPT adapter against an authenticated
local Chrome CDP session submitted a harmless ChatGPT prompt and collected
`QUEQIAO-BROWSER-HARNESS-OK` from the resulting conversation. Its local
`npm run check` passed 55 tests, typecheck, build and package import.
## Gate C+++ Browser Harness -> ChatGPT -> MCP -> GitHub Actions PASS (2026-10-09)

This acceptance resolves the previously outstanding Browser Harness integration.
The isolated Gateway used an ephemeral public HTTPS tunnel with a private
GitHub CLI-backed Actions provider and the disabled-by-default POC tools.

Execution evidence:

1. Install the locally staged Browser Harness v0.4.0 from
   [Harness PR #8](https://github.com/tibame201020/queqiao-harness-browser/pull/8)
   on the isolated `tunnel-worker` Extension Hub. The trigger can select an
   already-installed ChatGPT plugin and its collector waits for a configurable
   stable, non-generating answer.
2. ChatGPT's new custom OAuth MCP plugin performs metadata discovery, DCR and
   user-approved OAuth authorization. Gateway log records successful
   `/oauth/authorize` (303), `/oauth/token` (200), MCP `server/discover`
   and `tools/list` calls (200).
3. Call the **installed** Browser Harness `harness_run(trigger)` with a bounded
   POC prompt. It navigates to the selected plugin and submits a new chat.
   ChatGPT invokes the actual MCP `actions_worker_start`, repeatedly
   `actions_worker_status`, then `actions_worker_read_marker`. Each
   call appears in the isolated Gateway's MCP request log.
4. `harness_run(collect)` returns `status: completed` with the actual
   GitHub Actions run ID `37915098339`, `ready: true`, fixed marker
   `QUEQIAO-GITHUB-CONNECTOR-OK`, transport `websocket`, and lease
   `disposed`. This result is cross-checked against backend records, not
   accepted solely from the ChatGPT response.
5. [GitHub Actions run 37915098339](https://github.com/tibame201020/Queqiao/actions/runs/37915098339)
   reaches `completed / cancelled`. Its OIDC lease claim succeeds,
   `Keep runtime alive` is cancelled, and `Cleanup` finishes successfully.

**Verdict: PASS** for the combined native Browser Harness -> authenticated
ChatGPT UI -> OAuth MCP -> Gateway -> ephemeral Actions Worker -> reverse
WebSocket marker -> disposal/cleanup chain.

One earlier automated chat attempted the same connector before OAuth consent
and correctly failed with internal tool errors, with no new Worker run. That
attempt is excluded from acceptance. The remedial human OAuth authorization
succeeded before the passing run.

The actual browser session, plugin identifier, OAuth credentials, cookies and
human conversation identifiers stay in the local private harness/Gateway state
and are **not committed**. This does not prove persistent HTTPS availability,
unattended login renewal, restart recovery of the ChatGPT OAuth session or
production multi-tenant orchestration. No production deployment is approved
by this POC.

## Gate C short-task CLI acceptance (2026-10-09)

The dedicated GitHub Actions POC Worker has an opt-in `runtime` workspace
with the `run` tool enabled and **only the `node` binary allowlisted**;
no `shell` tool is granted. This is not a production-grade command/argument
sandbox: a Node process can run arbitrary JavaScript. Use this ephemeral,
single-tenant POC Worker **only** for an explicitly approved short task,
with no user secrets, private data, or write credentials in the runner.

The intended acceptance call is the Queqiao MCP connector's existing
`run` tool, pinned to the leased Actions `environmentId` and workspace
`runtime`. Execute a bounded checked-in Vitest suite using
`node node_modules/vitest/vitest.mjs run apps/gateway/src/actions-mcp-poc.test.ts --maxWorkers=2`
from `cwd: "."`. The contract checks nonzero exit, records bounded stdout
and stderr, verifies the response routing environment matches the leased
runtime, and cancels/disposes the ephemeral Worker after the result.

Do **not** consider the existing static marker test as evidence of CLI
execution. The GitHub Actions Run ID, actual remote process output, exit
code, routing receipt, final Actions Run conclusion, and Cleanup step must
be recorded separately after the live test.
