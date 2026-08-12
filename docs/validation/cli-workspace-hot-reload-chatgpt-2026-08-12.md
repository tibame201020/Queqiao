# CLI workspace hot-reload ChatGPT validation

- Date: 2026-08-12
- Result: PASS
- Connector: existing `Queqiao Multiple Workspaces`
- Connector reconnect: not performed
- Gateway restart after CLI mutation: not performed
- Worker restart after CLI mutation: not performed

## CLI mutation

The Windows CLI atomically added:

```text
workspaceId: queqiao-docs
displayName: Queqiao Docs
root: <windows-queqiao-root>\docs
```

## Calls verified through ChatGPT

1. `list_workspaces` immediately returned `queqiao-docs` as an online Windows workspace.
2. `open_workspace({ "workspaceId": "queqiao-docs" })` resolved the configured root.
3. `read_file` read lines 1-2 of `architecture.md` and returned `# Architecture`.

## Proven path

```text
CLI -> lock + validated atomic rename -> Worker last-known-good hot reload
    -> Gateway dynamic workspace routing -> existing ChatGPT connector
```

The public MCP tool schema did not change. This proves workspace configuration can be
changed without rebuilding or reconnecting the ChatGPT connector.
