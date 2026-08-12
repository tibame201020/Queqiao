# Queqiao v0 validation contract

## Scope

v0 proves one production-shaped path and nothing more:

```text
ChatGPT -> OAuth -> Gateway -> authenticated local HTTP -> native Worker -> one workspace
```

## Public MCP contract

The tool schema is frozen for the validation run:

- `workspace_info()` returns `environmentId`, `workspaceId`, `root`, and OAuth scopes.
- `read_file(path, offset = 0, limit = 500)` reads UTF-8 lines from a relative path.

No write, command, multi-workspace, multi-worker, CLI, or step-up feature is part of v0.

## Automated acceptance

- OAuth protected-resource and authorization-server discovery.
- Dynamic Client Registration with an allowed redirect origin.
- Authorization Code flow with PKCE S256.
- Bearer challenge for an unauthenticated MCP request.
- MCP initialize and exact `tools/list` schema.
- `workspace_info` routed through the Worker.
- `read_file` routed through the Worker.
- absolute, parent traversal, symlink escape, binary, and oversized-file rejection.
- Worker internal API rejects an invalid credential.

## ChatGPT acceptance

Using only the new Queqiao connector:

1. connect to the public `/mcp` endpoint and complete the approval page;
2. call `workspace_info` and confirm the configured environment and root;
3. call `read_file` for a known fixture and return the requested lines;
4. confirm no tools other than `workspace_info` and `read_file` are exposed.

Only after these checks pass may v0 be tagged as the compatibility baseline.

The v0 baseline is tagged `v0.1.0-chatgpt-verified`. Multiple-workspaces behavior is a
separate compatibility layer and must retain the optional default-workspace behavior
of the original `read_file` input.
