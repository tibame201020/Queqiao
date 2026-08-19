# Queqiao 0.7.0 interoperability acceptance — 2026-08-19

## Scope

This release gate verifies that Queqiao 0.7.0 is not bound to ChatGPT and that the Gateway/Worker runtime model is not bound to Windows or WSL-specific execution.

The gate covers:

- real Claude Code remote HTTP MCP discovery and OAuth;
- generic MCP client compatibility already covered by the MCP Inspector and standard MCP SDK matrix;
- Windows and Linux Gateway runtime support;
- Windows and Linux Worker runtime support;
- WSL as the Linux runtime path rather than a Windows-only Worker adapter;
- explicit non-support for unimplemented lifecycle platforms such as macOS in 0.7.0.

## Claude Code real-client acceptance

Validated client:

- Claude Code `2.1.235`;
- remote HTTP MCP transport;
- public Shadow MCP endpoint;
- OAuth 2.0 Dynamic Client Registration;
- Authorization Code + PKCE S256;
- native loopback callback.

The initial real-client attempt reached Queqiao OAuth discovery and Dynamic Client Registration but failed with:

```text
redirect_uris contain an invalid URI
```

Claude Code registered a native loopback callback of the form:

```text
http://localhost:<ephemeral-port>/callback
```

Queqiao already accepted explicitly configured `127.0.0.1` and `[::1]` loopback origins with dynamic ports, but did not apply the same explicitly-configured loopback-origin rule to `localhost`.

The release candidate now accepts dynamic ports for `localhost` only when `http://localhost` is present in `allowedRedirectOrigins`. The redirect remains exact-bound after registration, and non-loopback hosts such as `127.0.0.2` remain rejected. PKCE, resource binding, approval-secret checks, authorization-code single use, refresh-token replay protection, and the existing OAuth adversarial gate remain intact.

Client-facing OAuth copy was also made generic:

- default dynamic client name: `MCP client`;
- approval heading: `Allow this MCP client to use Queqiao?`.

After the fix, the isolated Claude Code acceptance flow completed successfully and reported:

```text
Authenticated with "queqiao-shadow". Its tools are now available in Claude Code.
```

A subsequent real-client health check reported:

```text
queqiao-shadow: <public MCP endpoint> (HTTP) - Connected
```

The temporary Claude Code validation home, OAuth credentials, and browser-helper material were removed after the acceptance run. No OAuth token, approval secret, or join token is retained in repository evidence.

## MCP client neutrality

This gate complements the existing `generic-mcp-client-interoperability-2026-08-13.md` acceptance, which exercised the public tool manifest and real tool calls through the MCP Inspector, plus the standard MCP SDK compatibility matrix across Queqiao's bounded protocol revisions.

The combined evidence therefore covers:

- ChatGPT real-client acceptance;
- Claude Code real-client discovery/DCR/PKCE/OAuth/connection acceptance;
- MCP Inspector real-client tool-list and tool-invocation acceptance;
- standard MCP SDK protocol-window regression coverage.

No Core tool, Workspace routing, Worker protocol, or Git behavior is specialized for Claude Code or ChatGPT.

## Gateway platform acceptance

The Gateway lifecycle implementation has explicit Windows and Linux branches. Unsupported platforms fail explicitly rather than silently using the wrong process-management implementation.

Release CI exercises the packed npm artifact on Ubuntu with a real Gateway process and Worker process. The `Linux Gateway and Worker handshake` job:

1. packs the release artifact;
2. installs it into a clean temporary location;
3. starts `queqiao-worker` on Linux;
4. starts `queqiao-gateway` on Linux;
5. verifies Gateway health and routed Worker reachability;
6. verifies authenticated Worker `/v1/hello`;
7. verifies Worker Protocol `3.0`;
8. verifies the Worker reports `platform: linux`;
9. verifies unauthenticated Worker access is rejected.

Windows release behavior is independently covered by Windows CI, package tests, CLI setup-flow gates, and the Stable/Shadow production deployments.

## Worker platform acceptance

Worker execution is native to the host environment rather than implemented as a Windows-only service with WSL translation.

The process runtime contains explicit platform behavior:

- Windows native executable resolution and termination;
- POSIX/Linux executable permission checks and detached process behavior;
- platform-specific minimal child environment construction;
- no shell for the safer `run` primitive;
- shell selection only through the explicit `shell` tool contract.

Real deployments additionally demonstrate simultaneous Windows and WSL environments behind one Gateway. WSL uses the Linux runtime code path and Linux-native filesystem/process semantics.

## Supported platform statement for 0.7.0

| Component | Windows | Linux | WSL | macOS |
| --- | --- | --- | --- | --- |
| Gateway runtime/lifecycle | PASS | PASS | PASS via Linux | Not supported in 0.7.0 |
| Worker runtime/lifecycle | PASS | PASS | PASS via Linux | Not supported in 0.7.0 |
| Packed npm integration | PASS | PASS | PASS via Linux | Not claimed |

Queqiao 0.7.0 therefore claims Windows and Linux runtime support. WSL is treated as Linux. It does not claim all-operating-system support.

## Result

PASS for the 0.7.0 release candidate, subject to the normal PR CI gate.

Release conclusions:

- Queqiao is not ChatGPT-only: PASS;
- Claude Code remote HTTP MCP OAuth connection: PASS;
- generic MCP tool interoperability: PASS from existing Inspector/SDK evidence;
- Gateway is not Windows-bound: PASS;
- Worker is not Windows/WSL-bound: PASS;
- Windows + Linux supported-platform contract is explicit: PASS;
- macOS support is not claimed: PASS.