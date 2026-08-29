# Interactive CLI flows

These GIFs are recordings of the real packaged Queqiao CLI running inside an isolated pseudo-terminal (PTY). The recorder opens a real shell, types the public command, waits for production prompt text, sends the same navigation/text keys a user would send, captures the raw ANSI terminal stream, and renders that stream with `agg`.

They are not synthetic component animations and they do not use hidden setup flags.

## Gateway setup

![Interactive Gateway setup](../../assets/cli/interactive/01-gateway-setup.gif)

`queqiao gateway setup` establishes the public control-plane role. The wizard selects or creates a named Gateway and collects its public URL plus local runtime ports.

## Worker, first Workspace, and Access

![Interactive Worker and Access setup](../../assets/cli/interactive/02-worker-access-setup.gif)

`queqiao worker setup` creates a native execution host and, in the same flow, its first authorized Workspace. The recording deliberately enters `Custom` Access, navigates the Tools multiselect, enables `run`, and supplies an executable allowlist. This demonstrates that Workspace authority is part of Worker setup rather than an implicit global permission.

## Named-instance selector

![Interactive named Gateway selector](../../assets/cli/interactive/03-instance-selector.gif)

When more than one named instance exists and the command is running in a TTY, the shared selector resolves the target interactively. Scripts and JSON mode still use explicit selectors.

## Extension attachment

![Interactive Extension attachment](../../assets/cli/interactive/04-extension-attach.gif)

Extension installation and Worker attachment remain separate operations. With one Worker and multiple installed Extensions, `queqiao extension attach` auto-resolves the Worker and prompts for the Extension.

## Recording contract

The interactive recorder lives at `scripts/cli-demo/record_interactive.py` and is orchestrated by `scripts/cli-demo/record-interactive.ps1`.

A recording is publishable only when:

1. The CLI comes from a staged npm package built from the same source revision.
2. The CLI runs in an isolated HOME/config/npm prefix.
3. The recorder waits for actual production prompt text before sending a key.
4. Setup uses only the public interactive command surface; no documentation-only flags are added.
5. The PTY has a fixed terminal geometry so wrapping and viewport behavior are deterministic.
6. The raw ANSI stream is captured before rendering; the GIF is a replay of that stream.
7. The external renderer is pinned (`agg` 1.9.0) and checksum-verified before use.
8. No real endpoint, credential, token, join code, or user runtime configuration is used.

Regenerate all interactive recordings on Windows with WSL available:

```powershell
npm run docs:cli:interactive
```
