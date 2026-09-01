# Configuration & persistence

**English** | [繁體中文](configuration-persistence.zh-TW.md)

Queqiao deliberately separates four storage classes so configuration, durable data, operational state, and transient process files have different backup and security semantics.

> Prefer Workstation/CLI mutations over hand-editing live files. Secret files must never be committed, pasted into issues, or included in diagnostic bundles.

## Discover paths on the current host

```shell
queqiao doctor paths
```

This reports the current host's default config root, named Gateway/Worker discovery roots, and Extension Hub. The exact layout can also be changed by the `QUEQIAO_*` environment overrides documented below.

## Storage classes

| Class | Purpose | Backup? |
| --- | --- | --- |
| **Config** | Runtime/user configuration and Workstation presentation settings | Yes |
| **Data** | Durable identities, secrets, Gateway membership, profiles, Extension Hub/packages | Yes, but protect secrets |
| **State** | Managed-process metadata and logs | Usually optional |
| **Runtime** | Ephemeral process/runtime files | No |

## Default roots

### Windows

`<LOCAL>` below means `%LOCALAPPDATA%\Queqiao`; `<TEMP>` means `%TEMP%\Queqiao`.

| Scope | Config | Data | State | Runtime |
| --- | --- | --- | --- | --- |
| Host/default | `<LOCAL>\config` | `<LOCAL>\data` | `<LOCAL>\state` | `<TEMP>` |
| Gateway `<name>` | `<LOCAL>\gateways\<name>\config` | `<LOCAL>\gateways\<name>\data` | `<LOCAL>\gateways\<name>\state` | `<TEMP>\gateways\<name>` |
| Worker `<name>` | `<LOCAL>\workers\<name>\config` | `<LOCAL>\workers\<name>\data` | `<LOCAL>\workers\<name>\state` | `<TEMP>\workers\<name>` |

Named runtime config files are therefore:

```text
%LOCALAPPDATA%\Queqiao\gateways\<name>\config\config.yaml
%LOCALAPPDATA%\Queqiao\workers\<name>\config\config.yaml
```

### Linux / WSL

Queqiao follows XDG roots. With no XDG overrides:

| Scope | Config | Data | State |
| --- | --- | --- | --- |
| Host/default | `~/.config/queqiao` | `~/.local/share/queqiao` | `~/.local/state/queqiao` |
| Gateway `<name>` | `~/.config/queqiao/gateways/<name>` | `~/.local/share/queqiao/gateways/<name>` | `~/.local/state/queqiao/gateways/<name>` |
| Worker `<name>` | `~/.config/queqiao/workers/<name>` | `~/.local/share/queqiao/workers/<name>` | `~/.local/state/queqiao/workers/<name>` |

Named config files are:

```text
~/.config/queqiao/gateways/<name>/config.yaml
~/.config/queqiao/workers/<name>/config.yaml
```

Runtime files use `${XDG_RUNTIME_DIR}` when available; otherwise Queqiao creates a user-scoped directory under the OS temporary directory. Do not treat that location as durable storage.

WSL is a Linux host from Queqiao's point of view. Its config/data/state are independent from the Windows host unless the user explicitly overrides them. This separation is intentional: each OS owns its local Worker and filesystem authority.

## Named Gateway layout

A typical named Gateway has this logical structure:

```text
<gateway config>/
  config.yaml

<gateway data>/
  secrets/
    oauth-approval.secret
    jwt-signing.secret
  gateway/
    management.secret
    worker-memberships.json
    worker-credentials/
      <worker-id>-<random>.secret

<gateway state>/
  processes/
    gateway.pid.json
  logs/
    gateway.out.log      # Linux managed background runtime
    gateway.err.log
```

### `config.yaml`

Schema version `1`. The Gateway section persists public and local runtime configuration, including:

```yaml
version: 1
gateway:
  publicBaseUrl: https://gateway.example/stable/
  listen:
    host: 127.0.0.1
    port: 7575
  managementListen:
    host: 127.0.0.1
    port: 7574
  livenessIntervalMs: 30000
  trustProxyHops: 1
  stateDirectory: <gateway-data>/gateway
  approvalSecretFile: <gateway-data>/secrets/oauth-approval.secret
  jwtSigningSecretFile: <gateway-data>/secrets/jwt-signing.secret
  allowedRedirectOrigins:
    - https://chatgpt.com
    - http://127.0.0.1
    - http://localhost
extensions: []
workspaces: []
```

The paths above are placeholders. Do not copy a real secret value into documentation or source control.

### Gateway secret files

- `oauth-approval.secret` — local approval secret used when authorizing the MCP client.
- `jwt-signing.secret` — Gateway signing secret.
- `gateway/management.secret` — authenticates the loopback-only management API used by Queqiao CLI/Workstation.
- `gateway/worker-credentials/*.secret` — Gateway-side copies of credentials for enrolled Workers.

These files are private credentials. Preserving them in a backup preserves identity/authorization state; losing them may require re-setup or re-enrollment. Store backups encrypted/private.

### `gateway/worker-memberships.json`

Gateway-owned authoritative enrollment/routing registry:

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<uuid>",
      "environmentId": "windows",
      "transport": { "type": "http", "endpoint": "http://127.0.0.1:7576/" },
      "credentialRefs": [
        { "kind": "secret-file", "path": "<gateway-data>/gateway/worker-credentials/<credential>.secret" }
      ]
    }
  ]
}
```

The registry is durable topology. `credentialRefs` lead to secrets and must be protected with the registry.

## Named Worker layout

```text
<worker config>/
  config.yaml

<worker data>/
  secrets/
    worker-<environment-id>.secret

<worker state>/
  processes/
    worker.pid.json
  logs/
    worker.out.log       # Linux managed background runtime
    worker.err.log
```

### Worker `config.yaml`

The Worker file is the authority source for its native identity, Workspaces, and attached Extensions:

```yaml
version: 1
worker:
  workerId: <uuid>
  environmentId: windows
  listen:
    host: 127.0.0.1
    port: 7576
  tokenFile: <worker-data>/secrets/worker-windows.secret
extensions:
  - trusted: true
    source: { ... }
    activation:
      kind: global
    manifest: { ... }
workspaces:
  - id: <workspace-id>
    displayName: Project
    root: <absolute-workspace-root>
    profile: read-only
    tools:
      allow: [read_file]
      deny: []
      explicit: []
    commands:
      allow: []
    stepUp: []
```

### Workspace persistence

**Current Queqiao does not maintain a separate production `workspaces.json`.** Workspaces are persisted directly in the owning Worker's `config.yaml` under `workspaces[]`.

Each Workspace carries its own copied authority (`tools`, executable `commands`, and optional `stepUp` rules). An Access Profile is a template used to create/update that authority; it is not a live pointer that later mutates the Workspace.

### Worker credential

`worker-<environment-id>.secret` is created during Worker setup. Enrollment replaces the credential transactionally only after Gateway confirmation succeeds.

During an in-progress/recovered join, files such as these can briefly exist beside the token:

```text
<token>.join-provisional.json
<token>.join-<pid>-<timestamp>.tmp
<token>.prejoin-<timestamp>
```

They are transaction/recovery artifacts. Do not edit or delete them while a join is active.

## Host-level durable files

These are shared by the Queqiao installation on one host rather than owned by a named Gateway/Worker.

### Access Profiles

```text
Windows: %LOCALAPPDATA%\Queqiao\data\access-profiles.json
Linux:   ${XDG_DATA_HOME:-~/.local/share}/queqiao/access-profiles.json
```

Shape:

```json
{
  "version": 1,
  "profiles": [
    {
      "name": "Coding Safe",
      "tools": ["read_file", "write_file", "edit_file", "run"],
      "allowedExecutables": ["git", "npm"]
    }
  ]
}
```

### CLI setup history

```text
Windows: %LOCALAPPDATA%\Queqiao\data\setup-history.json
Linux:   ${XDG_DATA_HOME:-~/.local/share}/queqiao/setup-history.json
```

Stores a bounded history of recently entered allowed executables for setup UX:

```json
{ "allowedExecutables": ["git,npm"] }
```

This is convenience history, not an authority source.

### Extension Hub

```text
Windows: %LOCALAPPDATA%\Queqiao\data\extensions\
Linux:   ${XDG_DATA_HOME:-~/.local/share}/queqiao/extensions/
```

```text
extensions/
  hub.json
  packages/
    <managed npm installation directories>/
```

`hub.json` stores the installed Extension inventory/source/manifest. npm-backed Extensions are copied into `packages/`; a local Extension keeps a reference to its external source/module path. Worker attachment is separately persisted in each Worker `config.yaml` under `extensions[]`.

## Workstation settings

Workstation appearance is host-level config, separate from runtime authority:

```text
Windows: %LOCALAPPDATA%\Queqiao\config\workstation.yaml
Linux:   ${XDG_CONFIG_HOME:-~/.config}/queqiao/workstation.yaml
```

```yaml
version: 1
appearance:
  colors:
    accent: cyan
    modal: magenta
    success: green
    warning: yellow
    danger: red
    muted: gray
```

The actual saved color values must be from Workstation's supported palette. This file changes presentation only.

## Operational state: PIDs and logs

Managed background lifecycle metadata lives under each role's state root:

```text
state/processes/gateway.pid.json
state/processes/worker.pid.json
```

A PID record contains the managed PID, entry point, config file, and start timestamp. Queqiao reconciles it against the actual process before treating a runtime as managed.

On Linux background lifecycle, stdout/stderr are written to `state/logs/<role>.out.log` and `<role>.err.log`. These logs/PID records are operational history and can normally be recreated; they are not substitutes for config/data backups.

## Environment path overrides

The default layout can be replaced with:

| Variable | Meaning |
| --- | --- |
| `QUEQIAO_CONFIG_DIR` | Config root |
| `QUEQIAO_DATA_DIR` | Durable data root |
| `QUEQIAO_STATE_HOME` | Operational state root |
| `QUEQIAO_RUNTIME_DIR` | Ephemeral runtime root |
| `QUEQIAO_CONFIG_FILE` | Exact config file passed to a runtime entry point |

When explicit layout overrides are active, named-role discovery is intentionally unavailable because there is no unambiguous default named hierarchy to scan.

## Permissions

Queqiao creates private runtime/config/secret material with restrictive permissions. On POSIX, private directories/files use `0700`/`0600` semantics. On Windows, Queqiao removes inherited broad ACLs and grants the current user plus `SYSTEM` access; ACL hardening is fail-closed for secure runtime paths.

Do not weaken these permissions to make cross-user sharing easier. Use separate Queqiao identities/layouts instead.

## Backup and migration guidance

For a host whose identities/topology must survive reinstall or migration:

1. Back up named Gateway/Worker **config** directories.
2. Back up named Gateway/Worker **data** directories, including secrets and Gateway membership/worker credentials.
3. Back up host-level `data/access-profiles.json` and `data/extensions/`; `setup-history.json` is optional.
4. Back up `config/workstation.yaml` only if the UI color assignment matters.
5. `state/` is optional operational history; do not rely on PID metadata after migration.
6. Do **not** back up or restore the runtime/temp root.

Treat a backup containing Queqiao data as a credential-bearing backup. Encrypt it and restrict access accordingly.

After restoring to a different OS or filesystem location, inspect absolute Workspace roots and any local Extension source paths before starting Workers. Use Workstation/CLI to edit paths rather than mass search/replace in live YAML/JSON.