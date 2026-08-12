# Coding baseline validation through ChatGPT

- Date: 2026-08-12
- Connector: `Queqiao Coding Baseline`
- Public endpoint: `https://<funnel-host>/mcp`
- OAuth handshake scope: `queqiao:access`
- Workspace: `write-validation`
- Environment: `windows`
- Workspace profile: `editor`

## Verified public manifest

The newly bound ChatGPT connector discovered and invoked the frozen six-tool schema:

- `workspace_info`
- `list_workspaces`
- `open_workspace`
- `read_file`
- `write_file`
- `edit_file`

An older connector had discovered the new names without reliably updating its direct
tool recipient registry. The new connector binding resolved all six tools. Public MCP
schema changes therefore require an explicit connector migration; implementation,
workspace registry, and policy changes may continue to hot reload without changing
the public manifest.

## ChatGPT execution evidence

ChatGPT called `write_file` with `workspaceId="write-validation"`,
`path="chatgpt-test.txt"`, and `content="before\n"`:

```json
{
  "workspaceId": "write-validation",
  "path": "chatgpt-test.txt",
  "bytes": 7
}
```

ChatGPT then called `edit_file` with the exact replacement `before` to `after`:

```json
{
  "workspaceId": "write-validation",
  "path": "chatgpt-test.txt",
  "bytes": 6,
  "replacements": 1
}
```

Finally, ChatGPT called `read_file` and observed:

```text
Workspace: write-validation
Path: chatgpt-test.txt
Lines: 1-2 of 2

after
```

## Frozen conclusions

1. OAuth authenticates the connector through `queqiao:access`; it does not encode
   read, write, or execution capability.
2. Workspace profile and tool policy authorize the operation, and the native Worker
   enforces the decision again at execution time.
3. Atomic write, unique exact edit, and readback form a verified end-to-end loop.
4. The six public tool names and their current input semantics are the coding baseline.
5. Adding, removing, or incompatibly changing a public tool requires a manifest
   revision and explicit connector migration rather than relying on schema hot reload.
