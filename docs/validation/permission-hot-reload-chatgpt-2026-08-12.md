# Permission hot-reload ChatGPT validation

- Date: 2026-08-12
- Result: PASS
- Connector: existing `Queqiao Multiple Workspaces`
- Connector reconnect: not performed
- Workspace recreation: not performed

## Policy under test

Workspace `queqiao-docs` remained visible and openable while `read_file` changed
between denied and allowed states.

The CLI also set:

```text
profile: read-only
command allowlist: git
```

The command rule is configuration-only in this baseline; no command execution tool is
exposed yet.

## Deny verification

1. `list_workspaces` returned `queqiao-docs` and its current policy.
2. `open_workspace` succeeded.
3. `read_file` returned `read_file is denied by workspace policy`.
4. Direct Worker API regression tests independently proved authoritative Worker deny.

## Allow verification

The CLI atomically moved `read_file` from deny to allow. Without restarting or
reconnecting anything, the same ChatGPT connector read lines 1-2 of
`queqiao-docs/architecture.md` and returned `# Architecture`.

## Proven model

```text
OAuth scope
  ∩ workspace profile
  ∩ per-tool allow/deny
  ∩ Gateway early enforcement
  ∩ Worker authoritative enforcement
```

This is the human acceptance evidence for bidirectional permission hot reload.

