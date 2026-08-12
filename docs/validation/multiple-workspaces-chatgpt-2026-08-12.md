# Multiple workspaces ChatGPT validation

- Date: 2026-08-12
- Result: PASS
- Connector: `Queqiao_Multiple_Workspaces`
- Public endpoint: `https://<funnel-host>/mcp`
- Environment: `windows`

## Configured workspaces

- `interview` -> `<windows-interview-root>` (default)
- `queqiao` -> `<windows-queqiao-root>`

## Calls verified through ChatGPT

1. `list_workspaces` returned exactly both configured workspace descriptors.
2. `open_workspace({ "workspaceId": "queqiao" })` resolved the configured Queqiao root.
3. `read_file` with `workspaceId="queqiao"`, `path="README.md"`, `offset=0`, and
   `limit=5` returned lines 1-5 and the expected Queqiao heading and description.

ChatGPT never supplied a local root path. All routing used the configured opaque
workspace ID.

## Transient transport observation

The first ChatGPT `read_file` attempt reported `mcp_network_error`. Gateway logs proved
that request never reached Queqiao. Gateway, Worker, and Funnel remained healthy, and
ten consecutive public end-to-end smoke runs passed. Retrying the identical tool call
from the same connector succeeded. There is no evidence of a handler, workspace route,
or connector configuration defect.

## Proven path

```text
ChatGPT -> one public Funnel -> Gateway -> Windows Worker
                                  |-> interview workspace
                                  `-> queqiao workspace
```

This document is the human acceptance evidence for the multiple-workspaces baseline.
