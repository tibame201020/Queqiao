# GitHub Actions Worker: Production readiness

Status: **Not production-ready**. The [Gate C POC](gate-c-isolated-gateway-poc.md)
proves a real OAuth MCP call to an ephemeral GitHub Actions Worker, a Node/Vitest
short task, streamed process results, and disposal. It does not establish a
durable, always-on multi-tenant service.

## Execution policy (Issue #111)

Workers interpret `commands.allow` as an executable allowlist. This alone is
**not** sufficient for executing Node: `node -e` could run arbitrary script.

A Workspace may now opt into `commands.exact`. If present, even as `[]`, Core
`run` and `job_start` must also match an approved record:

- `executable`: literal executable name, case-insensitively compared
- `args`: exact ordered argument vector, no shell interpolation or wildcards
- `cwd`: exact workspace-relative literal, without path traversal
- `mode`: `sync`, `async`, or `job` (durable job_start)
- `maxTimeoutMs`: positive upper bound on the invocation timeout

Example isolated POC policy (not a general-purpose production command runner):

```json
{
  "profile": "coding",
  "tools": {
    "allow": ["workspace_info", "read_file", "list_workspaces", "run"],
    "deny": [],
    "explicit": []
  },
  "commands": {
    "allow": ["node"],
    "exact": [{
      "executable": "node",
      "args": [
        "node_modules/vitest/vitest.mjs", "run",
        "apps/gateway/src/actions-mcp-poc.test.ts", "--maxWorkers=2"
      ],
      "cwd": ".",
      "mode": "sync",
      "maxTimeoutMs": 45000
    }]
  }
}
```

The policy is checked **in the Worker** before a process starts, including
the durable-job API. Every other Node argument vector, async execution, and
job startup is rejected. Pre-existing Workspaces omitting `commands.exact`
retain legacy behavior for backward compatibility. Opt in deliberately.

**Security boundary:** Exact argv is not a sandbox. The checked-in test,
Node runtime, dependencies, and repository revision must be trusted. Never
execute unreviewed pull-request code or user-supplied files with credentials,
GitHub OIDC request tokens, browser sessions, or personal data available.
The extension runtime is a distinct trusted authority and is not constrained
by Core command rules. Production task isolation needs sandbox/container
restrictions, restricted egress and process environment, immutable source
revisions, and a signed/audited task catalog.

## GitHub Actions exact-policy live acceptance (2026-10-09)

[GitHub Actions Run 37924307569](https://github.com/tibame201020/Queqiao/actions/runs/37924307569)
executed the exact-policy branch on a real Ubuntu Actions Runner.
The private OAuth MCP client dispatched it through the isolated Gateway and
selected the resulting Worker by its runtime environment ID.

- OIDC enrollment + reverse WebSocket routing: `ready`, route
  `gha_e0984c5daa46466bbfdd3716` matches the lease.
- Negative tests: `python --version`, arbitrary `node -e`, and `mode: async`
  with the otherwise allowed command were all rejected.
- Exact approved Node/Vitest command: `8 passed`, exit code `0`,
  stdout collected from `/home/runner/work/Queqiao/Queqiao`, empty stderr.
- `_meta["dev.queqiao/routing"].selectedTransport` = `websocket`,
  and the receipt environment ID equals the leased environment.
- Client requested cancellation, received `Lease: disposed`.
  GitHub Run ended `completed / cancelled`, OIDC claim succeeded,
  and the Actions `Cleanup` step completed successfully.

**Verdict: PASS** for one specific, trusted, bounded CLI task and for
deny-by-policy cases on a real Actions Worker. This is not evidence that
arbitrary user-supplied scripts are safely sandboxed.
## Persistent-host starter templates
A provider-neutral Linux Gateway + named HTTPS Tunnel host starter lives in
[`deploy/systemd/`](../deploy/systemd/README.md). It includes systemd units,
external secret-file paths and a stable-origin configuration template, with
contract tests in the CI security gate. It is **not deployed** and leaves the
test-only Actions MCP controls disabled.

### Source SHA pin for the task-catalog path

The runtime provider accepts an optional, **validated lowercase 40-hex
`sourceRevision`** in trusted metadata and maps it to the Actions
`source_revision` dispatch input. The Workflow checks out this SHA and
verifies the checkout HEAD before running npm or starting the Worker. A
missing input preserves existing POC behavior. This is not yet a
multi-principal production workload API or a full OIDC workflow-revision
attestation.
## Production acceptance gates

| Gate | Acceptance criteria | Current state |
| --- | --- | --- |
| Stable ingress | Fixed HTTPS origin; OAuth issuer/redirect does not change on restart; public TLS, restricted admin/worker ports | **Not verified** |
| Gateway supervision | Persistent independent host, restart policy, health probes, alert on downtime | **Not deployed** |
| Lease lifecycle | Restart checkpoint recovery plus durable ownership, orphan reconciliation and multi-instance safety | Restart recovery POC only |
| Task execution | Fixed task catalog, exact validated argv, cwd/time limits, restricted credentials and egress | Exact argv policy implemented; isolation pending |
| Observability | Correlated MCP request, GitHub Run, lease, task exit code, bounded stdout/stderr and cleanup | POC evidence only |
| Availability | Local PC powered off; ChatGPT runs new task and receives results; runner terminated; repeated on multiple days | **Not verified** |

### Required deployment decision

Select a persistent host and a fixed HTTPS ingress under an owned domain.
A Cloudflare **Quick Tunnel** hostname is not stable, and a local
`gh-cli` credential is not an acceptable hosted production credential.
Prefer a narrowly scoped GitHub App installation credential or dedicated
short-lived token, stored in a managed secret store with rotation/revocation.
Do not add domain ownership data or secrets to the repository.

For any production deployment, first enable the new policy in the isolated
Worker, verify the deny/allow tests in GitHub Actions, and run an independent
live end-to-end test with recorded Run ID. These test credentials must never
be published in CI output.
