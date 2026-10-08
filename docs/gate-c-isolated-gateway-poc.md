# Gate C: isolated ChatGPT → Actions Worker acceptance

Status: **not yet accepted end to end**. This is an opt-in POC, not a production deployment.

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

## Limitations

This POC is single-tenant and process-local. A Gateway restart loses its
in-memory lease registry and ownership mapping; monitor or cancel surviving
Actions runs separately. Do not run this on a shared Gateway or reuse it as a
general-purpose runtime scheduler.

The Browser Harness still depends on a continuously available authenticated
Chrome host. A local persistent profile does not function when that host is
offline. Moving it to a continuously running host requires a separate security
review and session lifecycle plan. The legacy
`CHATGPT_BROWSER_SESSION_CAPSULE` is not used by this design; revoke and remove
it only through the authorized credential cleanup procedure.
