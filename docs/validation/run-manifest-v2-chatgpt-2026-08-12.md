# Manifest revision 2 `run` validation through ChatGPT

- Date: 2026-08-12
- Connector: `Queqiao Run Baseline`
- Public endpoint: `https://<funnel-host>/mcp`
- OAuth handshake scope: `queqiao:access`
- Manifest: seven public tools

## Discovery

After reconnecting and rediscovering the connector, ChatGPT loaded all seven tools:

```text
workspace_info
read_file
list_workspaces
open_workspace
write_file
edit_file
run
```

The `run` schema exposed `workspaceId`, `executable`, `args`, `cwd`, and `timeoutMs`.
An initial discovery attempt had produced no tool binding. Gateway persistent logs and
an independent public MCP client confirmed the seven-tool manifest; reconnecting the
same connector then completed discovery without another server schema change.

## Workspace routing

`list_workspaces` confirmed:

- `exec-validation`: Windows, `coding`, command allowlist includes `node.exe`;
- `exec-validation-wsl`: WSL, `coding`, command allowlist includes `node`;
- `write-validation`: Windows, `editor`;
- both Windows and WSL environments were online.

The first list call encountered a transient `mcp_network_error`. Retrying the same
connector succeeded, and all subsequent process calls reached their Workers.

## Native execution

Windows execution returned:

```text
stdout: "win32"
exitCode: 0
timedOut: false
```

WSL execution returned:

```text
stdout: "linux"
exitCode: 0
timedOut: false
```

This proves one Gateway routed process execution to the workspace's native Windows or
Linux Worker rather than mediating WSL commands through Windows.

## Authorization and resource enforcement

Running `node.exe --version` in the `write-validation` editor workspace was denied:

```text
run is denied by workspace policy or profile
```

A long-running Windows Node process with `timeoutMs=100` returned:

```text
exitCode: 1
durationMs: 249
timedOut: true
```

The elapsed duration includes Windows process-tree termination overhead. The process
was terminated and the structured timeout flag was preserved through Worker, Gateway,
MCP, and ChatGPT.

## Frozen conclusions

1. Manifest revision 2 contains the frozen six coding tools plus `run`.
2. `run` preserves native Windows and WSL execution semantics.
3. A `coding` profile, tool policy, command allowlist, and contained cwd are mandatory.
4. The editor profile cannot execute commands.
5. Timeout enforcement terminates the process tree and reports `timedOut: true`.
6. OAuth remains the single `queqiao:access` connector handshake and does not grant
   process capability.
7. The seven public tool names and current input semantics are frozen. Any additional
   public tool or incompatible schema change requires a later manifest revision and
   connector migration.
