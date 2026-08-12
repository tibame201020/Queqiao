# CLI environment and WSL-native management ChatGPT validation

- Date: 2026-08-12
- Result: PASS
- Connector: existing `Queqiao Multiple Workspaces`
- Connector reconnect: not performed

## Runtime changes

- Gateway Worker registry became reloadable with last-known-good fallback.
- `environment add/remove` uses the same locked atomic JSON store as workspace changes.
- Worker credentials are read from a token file and are never printed by CLI output.
- The WSL Worker is managed by a systemd user service.
- WSL workspace configuration is owned by Linux at
  `$HOME/.config/queqiao/workspaces.json`.

## WSL-native CLI mutation

The Queqiao CLI ran under WSL Node and added:

```text
workspaceId: devspace-openai
root: <wsl-devspace-root>
environmentId: wsl
```

No Gateway or connector restart followed this mutation.

## Calls verified through ChatGPT

1. `list_workspaces` immediately returned `devspace-openai`, its Linux root, and
   `online: true` under the WSL environment.
2. `open_workspace({ "workspaceId": "devspace-openai" })` resolved the Linux root.
3. `read_file` returned lines 1-3 of `<wsl-devspace-root>/README.md`.

## Proven path

```text
WSL CLI -> Linux atomic config -> WSL Worker hot reload
        -> Gateway reloadable environment registry -> existing ChatGPT connector
```

This is the human acceptance evidence for environment registry hot reload and
WSL-native CLI management.
