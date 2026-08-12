# Multi-environment ChatGPT validation

- Date: 2026-08-12
- Result: PASS
- Connector: `Queqiao Multiple Workspaces`
- Public endpoint: `https://<funnel-host>/mcp`
- Public tunnels: one Tailscale Funnel

## Environments and workspaces

- Windows (`online: true`)
  - `interview` -> `<windows-interview-root>`
  - `queqiao` -> `<windows-queqiao-root>`
- WSL (`online: true`)
  - `irispipe` -> `<wsl-irispipe-root>`

## Calls verified through ChatGPT

1. `list_workspaces` returned both environments and all three configured workspaces.
2. `open_workspace({ "workspaceId": "irispipe" })` returned `environmentId="wsl"`
   and `<wsl-irispipe-root>`.
3. `read_file` read lines 1-5 of WSL `irispipe/CHANGELOG.md` through the native WSL
   Worker and returned the expected Changelog heading and content.
4. The immediately following `read_file` read lines 1-2 of Windows
   `queqiao/README.md` and returned the expected Queqiao heading.

This proves that one ChatGPT connector can route consecutive requests between native
WSL and Windows Workers through one Gateway and one Funnel.

## Transient transport observation

The first `list_workspaces` attempt reported one `mcp_network_error`. Retrying from the
same connector succeeded without reconnecting or changing configuration. This matches
the previously observed pre-Gateway transient transport behavior and is not evidence
of a Gateway, Worker, or routing defect.

## Proven path

```text
ChatGPT -> one Funnel -> Gateway -> WSL Worker -> <wsl-workspace-root>
                         Gateway -> Windows Worker -> <windows-workspace-root>
```

This document is the human acceptance evidence for the multi-environment baseline.
