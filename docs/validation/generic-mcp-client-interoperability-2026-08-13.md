# Generic MCP client interoperability matrix — 2026-08-13

## Scope

This gate proves that the candidate is a general remote Streamable HTTP MCP substrate rather than a ChatGPT-only integration.

The matrix combines:

- the standard MCP SDK client regression suite across Queqiao's bounded protocol window;
- the official MCP Inspector CLI as a real non-ChatGPT MCP client;
- the candidate's normal OAuth authorization-code + PKCE + Dynamic Client Registration flow;
- real Windows and WSL Workspace routing through the public candidate deployment.

No client-specific behavior was added to Core. The only product defect discovered during the Inspector attempt was the native OAuth loopback redirect-port rule; that standards-level OAuth fix is recorded separately.

## Real client

Client:

- `@modelcontextprotocol/inspector@2.2.0`
- CLI mode
- Streamable HTTP transport

A repeatable validation harness is provided at `scripts/validate-mcp-inspector.mjs`. It takes the candidate base URL and approval-secret file path at invocation time, never embeds credentials or machine-specific endpoints in source, keeps the access token in a short-lived OS temporary Inspector config, and removes that temporary directory in `finally`.

## Observed public contract

The Inspector independently observed and exercised:

- exact public tool count: 17;
- exact Core + Git public tool names;
- named Git tools: 7;
- `workspace_info` includes optional `workspaceId` targeting;
- Core Manifest Revision: 6;
- Deployment Manifest Fingerprint: `sha256:68eac0d73d8efea95cfde694b33d44220049fb6180b60657b3d8b6ee0a9d59ad`;
- public tool count attestation: 17;
- Worker Protocol Version: 2.0;
- supported MCP revisions:
  - `2025-03-26`;
  - `2025-06-18`;
  - `2025-11-25`;
  - `2026-07-28`.

The Inspector called `list_workspaces`, explicitly targeted `workspace_info` in both Windows and WSL acceptance Workspaces, and called `git_status` against both native Git repositories. Windows resolved to the Windows Worker and WSL resolved to the WSL Worker.

## Standard SDK matrix

The existing standard MCP SDK matrix independently covers:

- successful legacy Streamable HTTP negotiation for `2025-03-26`, `2025-06-18`, and `2025-11-25`;
- successful modern negotiation for `2026-07-28`;
- `tools/list` and tool invocation on supported revisions;
- explicit rejection of deprecated pre-Streamable-HTTP revisions;
- explicit rejection of an unknown future revision rather than inheriting broader SDK behavior.

## Client-specific isolation

The Inspector did not require a Core, Workspace, Git, process, or MCP protocol special case. Windows launcher handling lives only in the validation harness: it invokes the installed npm `npx-cli.js` through the current Node executable rather than relying on shell execution of `npx.cmd`.

OAuth loopback dynamic-port support is not Inspector-specific. It is a native-app OAuth interoperability rule and remains constrained to explicitly permitted loopback IP origins with exact full redirect-URI binding after registration.

## Result

PASS.

The Generic MCP Client Interoperability Matrix acceptance criteria are satisfied:

- standard MCP SDK client matrix: PASS;
- non-ChatGPT real MCP client: PASS;
- supported public manifest and tool invocation: PASS;
- Windows/WSL routing through the real client: PASS;
- client quirks isolated at the validation/integration boundary: PASS.
