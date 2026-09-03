# Worker Transport Final Acceptance — 2026-09-03

## Scope

This record closes the feature acceptance for HTTP plus Worker-initiated reverse TLS gRPC transport and the extensible routing contract introduced by Core Manifest Revision 9.

Historical validation records remain unchanged. This document records only evidence verified during the current feature line.

## Real cross-device transport acceptance

The acceptance topology used one physical Windows machine for the Gateway and a second physical Windows machine for the Worker over a private LAN.

Verified:

- reverse TLS gRPC session establishment;
- gRPC-only Worker enrollment and membership;
- real Workspace operations routed through reverse gRPC;
- a Worker with both HTTP and gRPC enabled accepts explicit HTTP and explicit gRPC routes;
- HTTP-only membership rejects explicit gRPC with `transport_not_enabled`;
- gRPC-only membership rejects explicit HTTP with `transport_not_enabled`;
- omitted transport selection is deterministic and uses the same selection logic as the Workspace routing projection;
- explicit transport selection is exact and does not silently fall back;
- Worker stop/restart causes reverse-session loss and automatic recovery;
- Gateway restart causes the Worker reverse session to reconnect;
- Gateway liveness reacts to reverse-session attach/detach rather than waiting for the previous periodic snapshot interval.

## ChatGPT and extension-chain acceptance

Verified through a real ChatGPT connector and the public MCP endpoint:

- OAuth-authenticated MCP calls can explicitly select gRPC and reach the remote Worker;
- `list_workspaces` / `workspace_info` expose enabled transports, health/mode, traits, and deterministic default routing;
- the Worker policy boundary remains authoritative: denied write/process operations stay denied regardless of transport;
- the downstream extension chain `extension` → `dev.queqiao.mcp` → Chrome DevTools executes successfully through the remote Worker path.

## Core Manifest Revision 9 selector acceptance

Revision 9 changes the optional Workspace-bound `transport` selector from a closed HTTP/gRPC enum to a dynamic identifier string matching:

```text
^[a-z][a-z0-9.-]*$
```

with length 1–64.

Verified:

- a refreshed ChatGPT connector exposes `transport` as the dynamic string contract rather than an HTTP/gRPC enum;
- a syntactically valid unknown identifier such as `webrtc` passes ChatGPT input-schema validation and reaches the Gateway;
- the Gateway returns `transport_unknown` for that unregistered provider;
- existing HTTP and gRPC explicit routes continue to work;
- callers can discover currently usable transport identifiers from Workspace discovery instead of relying on a hard-coded provider list.

This proves that adding a future provider identifier does not itself require a connector schema migration while the public dynamic-string shape remains unchanged. Implementing a new provider still requires explicit Queqiao runtime, enrollment/membership, security, and validation work.

## ChatGPT schema lifecycle observations

| Action | Observed behavior |
| --- | --- |
| Change Gateway schema only | An already-open conversation retains its existing tool-schema snapshot. |
| Refresh app/connector | ChatGPT re-discovers the live MCP tool schema. |
| Reconnect | Re-establishes connection/OAuth state but does not refresh the tool schema. |
| Uninstall | Removes the app binding from an existing conversation. |
| Reinstall same app | Can reuse cached tool metadata and does not restore the removed binding in an existing conversation. |
| OAuth link after reinstall | Restores connectivity but still does not replace schema discovery. |
| Refresh + new conversation | New conversation receives the refreshed schema. |

Operationally, use **Refresh** for a real public MCP schema migration and verify from a new conversation. Use **Reconnect** for connection/OAuth recovery.

## Documentation and onboarding evidence

The Workstation Quick Start was re-recorded against the current feature line where transport-related prompts changed.

New connector-handoff evidence:

- `docs/assets/workstation/quickstart/08-copy-mcp-url.gif` — real Workstation `c` action;
- `docs/assets/workstation/quickstart/09-copy-approval-secret.gif` — real Workstation `p` action;
- `docs/assets/workstation/quickstart/10-chatgpt-add-connector.png` — ChatGPT custom app/connector form using a non-live example endpoint.

The Workstation recorder replaces the OS clipboard with a sink, so copied MCP URLs and approval secrets are not captured in GIF frames. The ChatGPT screenshot uses `https://queqiao.example.com/mcp` and does not contain a live endpoint or credential.

The current Gateway setup and Worker join Quick Start GIFs were also re-recorded so they include the Worker-session exposure and Worker-protocol selection introduced by this feature.

## Repository gates

The following gates were executed on the feature worktree after the documentation/recorder changes and final dependency refresh:

- `npm run typecheck` — PASS;
- `npm test` — PASS, 105 files / 818 tests;
- `npm run test:security` — PASS, 66 files / 572 tests;
- `npm run test:cluster` — PASS, 17 files / 67 tests;
- `npm run test:workstation` — PASS, 15 files / 126 tests;
- `npm run dev:workstation:verify -- --smoke` — PASS, 4 files / 21 tests;
- `npx vitest run apps/cli/src/cli-visual-docs.test.ts` — PASS, 1 file / 8 tests;
- `npm run build:package` — PASS;
- `npm run resource:gate` — PASS with no resource-budget failures;
- `npm audit --omit=dev --audit-level=moderate` — PASS with 0 vulnerabilities after refreshing transitive `qs` to 6.16.0;
- `git diff --check` — PASS;
- changed-text hygiene scan — PASS with no live approval secret, OAuth/Worker token, private hostname/IP, or machine-specific path found.

## Security boundary

No live approval secret, OAuth token, Worker credential, machine-specific endpoint, private key, or runtime configuration is intentionally recorded in this validation evidence or the documentation assets.
