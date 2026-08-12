# Manifest revision 3 ChatGPT validation evidence

Date: 2026-08-12

Status: PASS — frozen

## Public manifest

A newly created ChatGPT connector discovered the frozen seven-tool baseline followed
by the two Revision 3 additions:

```text
workspace_info
read_file
list_workspaces
open_workspace
write_file
edit_file
run
list_directory
search_text
```

Reconnect and reauthorization of the prior connector did not reliably load the new
schemas. Creating a new connector binding did. Public schema revisions are therefore
treated as connector manifest migrations.

## Native environment validation

- Windows `queqiao`: `list_directory` returned repository entries.
- Windows `queqiao`: `search_text` found expected `README.md` matches.
- WSL `irispipe`: `list_directory` returned native Linux workspace entries.
- WSL `irispipe`: `search_text` found expected `CHANGELOG.md` matches.
- One transient `mcp_network_error` occurred before a Windows search; retrying the
  same connector and arguments succeeded.

## Policy hot reload

The `queqiao-docs` allow list initially contained only `read_file`. Calling
`search_text` returned:

```text
search_text is not allowed by workspace policy
```

The CLI atomically added `search_text` to the allow list. Without reconnecting or
reauthorizing, the same connector immediately found `Architecture` in
`architecture.md`. This verifies the full deny-to-allow path:

```text
CLI -> atomic config -> Worker hot reload -> Gateway -> existing connector
```

## Production constraint

- Implementation, workspace registry, and policy changes may hot reload behind a
  stable public schema.
- A public MCP tool schema change creates a new manifest revision and requires a new
  ChatGPT connector binding/migration.
