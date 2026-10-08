# Browser Harness + GitHub Actions Worker: hybrid acceptance

## Scope and measured gates

- **Gate A — persistent browser:** an already authenticated local Chrome, accessed by Queqiao Harness Browser using loopback CDP, accepted a synthetic prompt and returned a matching assistant reply through `trigger` + `collect`. The browser was still running after the client disconnected. This was tested without transferring a ChatGPT login session to Actions.
- **Gate B — ephemeral tool execution:** manually dispatch the **Runtime Provider Phase 3 POC** workflow on protected `main`. It creates an ephemeral GitHub Actions Gateway and Worker, proves GitHub OIDC / reverse WebSocket registration, then invokes `read_file` through an authenticated MCP client on the Gateway. The result must include the expected ephemeral Worker environment routing receipt and the exact `poc-marker.txt` content. It must then dispose the lease and cancel the Worker run.
- **Gate C — full UI loop:** Browser Harness on a trusted persistent host triggers ChatGPT, which invokes the configured stable Queqiao Connector and routes the short task to an Actions Worker, returning the result to ChatGPT. **Gate C is not proven by A+B.** It requires a stable Gateway/connector identity and an actual ChatGPT-initiated tool call.

## Running Gate B

On GitHub Actions, manually run `.github/workflows/runtime-provider-poc-controller.yml` from `main`. The workflow performs:
1. Create throwaway Gateway OAuth approval and JWT signing secrets in the ephemeral controller runner, never in git or logs.
2. Start a temporary HTTPS Cloudflare tunnel to the Gateway. Management listener remains on loopback and is not publicly exposed.
3. Dispatch `runtime-provider-poc-worker.yml` through the GitHub Actions Runtime Provider.
4. Verify GitHub OIDC claim, reverse WebSocket Worker registration, ready Runtime Lease, and expected environment.
5. Register a temporary MCP OAuth client with PKCE, authorize it only using the controller's ephemeral approval secret, call `read_file` for workspace `runtime` and path `poc-marker.txt`, and validate the exact marker plus routing metadata.
6. Dispose the lease, verify the GitHub Worker run is cancelled, and clean up the public tunnel.

The assertions are unit-tested in `apps/gateway/src/poc-runtime-reader.test.ts` in ordinary CI. The manual acceptance is the real network test.

## Security and limitations

No ChatGPT credentials, profile directories, cookies, or session capsules are needed or consumed by Gate B. Do **not** forward the Chrome CDP debugging port over a public URL; CDP effectively grants full control of its browser session. Do not store OAuth approval tokens, GitHub tokens, or runtime credentials in git or Actions artifacts. Remote Worker access is bounded by Queqiao workspace policy and the Runtime Lease. Temporary runner state must be cleaned after each run. The quick-tunnel endpoint changes on every invocation and **must not** be used as a production ChatGPT Connector address.

The previous GitHub-hosted Chrome portability experiment remained blocked by ChatGPT's ordinary browser verification page; this hybrid path does not bypass that protection.

## Response format correction (2026-10-08)

The first real MCP call in GitHub Actions successfully completed OAuth and returned HTTP 200, but the POC assertion failed because it expected JSON. Queqiao core `read_file` returns a text result with the exact `Workspace`, `Path`, and `Lines` headers followed by the file content. The acceptance helper now validates that format and the worker routing receipt, and rejects a marker from another workspace, path, or environment. The result must still pass a new live manual run before Gate B is considered complete.

## GitHub Actions worker cancellation eventual consistency

On 2026-10-08, controller run `37783245944` completed the real OAuth-authenticated MCP `read_file` request, verified the ephemeral Worker routing receipt and exact marker, and disposed the Runtime Lease. Its final GitHub run-cancellation assertion failed because the POC allowed only 45 seconds, although the worker run `37783321062` eventually reached `completed/cancelled` about 77 seconds after disposal began. This is a GitHub Actions control-plane observation delay, not a failed MCP read.

The acceptance now polls cancellation for at most 120 seconds, retains the strict `disposed` and `cancelled` assertions, and has a CI contract test to prevent shrinking the wait below the observed control-plane delay. Treat the short-task execution as passing only when the full live controller run succeeds.

## Hybrid preflight evidence (2026-10-08)

A fresh manual **Runtime Provider Phase 3 POC** run [37800867392](https://github.com/tibame201020/Queqiao/actions/runs/37800867392) completed successfully on `main` at `8505a03`.

- Temporary GitHub Actions Gateway + Worker started successfully.
- The Worker joined through GitHub OIDC + reverse WebSocket and its Runtime Lease became `ready`.
- The authenticated MCP `read_file` returned `workerRead=true` from workspace `runtime` and the intended ephemeral Worker environment.
- The Runtime Lease ended in `disposed`; the Worker workflow run `37800918193` ended in `cancelled`.

The first run of this session [37800590692](https://github.com/tibame201020/Queqiao/actions/runs/37800590692) failed before enrollment because the ephemeral Cloudflare quick tunnel returned HTTP 530. This is a transient test-network dependency, not a production-ready ingress pattern.

On the persistent Browser Harness host, a read-only check of the already-authenticated Chrome profile returned `verdict=authenticated`, with the ChatGPT composer present. It did not submit a message.

**Gate C remains open.** The existing fixed Gateway did not expose the Runtime Provider management route. Its local configuration has no GitHub Actions provider configured. The new read-only preflight verified `browser=authenticated` and `reason=provider_missing`. A complete user-facing POC still needs a stable Gateway identity, an isolated/approved runtime-provider configuration and a ChatGPT-initiated MCP call which returns the Actions Worker result to the browser.

### Repeatable hybrid readiness check

Use an authenticated *persistent* Chrome on loopback CDP and a local Gateway management listener. Supply the management secret as a **file path** through `QUEQIAO_GATEWAY_MANAGEMENT_SECRET_FILE` in the operator's process environment; do not copy the secret into source, logs, issues, or workflow artifacts.

```shell
BROWSER_CDP_URL=http://127.0.0.1:9333 \
QUEQIAO_GATEWAY_MANAGEMENT_URL=http://127.0.0.1:12990 \
QUEQIAO_GATEWAY_MANAGEMENT_SECRET_FILE=/secure/path/management.secret \
npx tsx packages/browser-harness-runtime/src/hybrid-readiness-cli.ts
```

The probe checks the existing ChatGPT composer and performs only `GET /runtimes` on the **loopback** management interface. It does **not** provision, dispose, restart, or edit any Gateway. It prints only `browser`, `providerAvailable`, `ready`, and `reason` without tokens or profile data. Exit status `0` means both browser and provider are ready; `2` means at least one gate is blocked.

Tests: `packages/browser-harness-runtime/src/hybrid-readiness.test.ts`.
