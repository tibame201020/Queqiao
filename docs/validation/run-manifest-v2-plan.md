# Manifest revision 2: `run` validation plan

## Status

Completed. See
[ChatGPT validation evidence](run-manifest-v2-chatgpt-2026-08-12.md).

## Contract

Revision 2 retains the frozen six tools unchanged and adds one public tool:

```text
run(workspaceId, executable, args = [], cwd = ".", timeoutMs = 30000)
```

The input is an executable basename plus an argument array. It is never a shell
command string. The maximum timeout is 120 seconds.

## Pre-ChatGPT evidence

- 28 automated tests pass across protocol, OAuth, policy, safe workspace, process
  runtime, Worker authority, Gateway routing, and MCP contracts.
- Windows private Worker execution returned `platform: "win32"` from the isolated
  `exec-validation` coding workspace.
- WSL private Worker execution returned `platform: "linux"` from the isolated
  `exec-validation-wsl` coding workspace.
- Public MCP execution returned `win32` through Gateway and Funnel.
- Public MCP execution denied the same tool in the `write-validation` editor profile.
- Public MCP timeout terminated a long-running Node process and returned
  `timedOut: true`.
- The OAuth token contained only `queqiao:access`.

## ChatGPT acceptance

Because `run` changes the public manifest, validation must use a new connector binding.
The revision is frozen only after ChatGPT demonstrates:

1. discovery and direct invocation of all seven tools;
2. Windows native execution in `exec-validation`;
3. WSL native execution in `exec-validation-wsl`;
4. editor-profile denial in `write-validation`;
5. timeout termination with a structured `timedOut: true` result.
