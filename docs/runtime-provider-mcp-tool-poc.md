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
