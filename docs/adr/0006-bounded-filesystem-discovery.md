# ADR 0006: Bounded filesystem discovery tools

Status: Accepted

## Context

A coding agent must discover repository structure and locate relevant text before it
can use `read_file`, `edit_file`, or `run` effectively. Requiring an allowlisted shell
command for these read-only operations would make behavior platform-dependent and
would unnecessarily grant process execution.

## Decision

Manifest revision 3 appends two stable core tools:

- `list_directory` returns deterministic, paginated directory entries with bounded
  recursion. It does not follow symbolic links.
- `search_text` performs literal text search in bounded UTF-8 files. It supports a
  constrained glob filter, result and time limits, skips common generated/vendor
  directories, binary files, oversized files, and symbolic links.

Both tools run inside the native Worker and require only the read profile capability.
They use the same workspace containment and per-workspace allow/deny policy as the
other filesystem tools. `run` remains a shell-free executable primitive and is not
renamed to `bash`, because Windows, Linux, and future environments do not share a
shell contract.

## Consequences

An agent can inspect and search a workspace without process permission. Adding these
public schemas is a manifest revision and requires ChatGPT connector rediscovery or a
new binding; configuration and workspace policy changes remain hot reloadable. ChatGPT
testing established that reconnecting or reauthorizing an existing connector does not
reliably migrate its public tool binding. A public schema revision therefore requires a
new connector binding; implementations, workspace registries, and policies do not.
