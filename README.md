# Queqiao

**English** | [繁體中文](https://github.com/tibame201020/Queqiao/blob/main/README.zh-TW.md)
[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/tibame201020/Queqiao/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/@tibame201020/queqiao.svg)](https://www.npmjs.com/package/@tibame201020/queqiao)

Queqiao is a secure bridge between AI clients and multiple local coding environments.
A public Gateway handles MCP ingress, authentication, routing, and Worker membership. Each
Windows, WSL, Linux, or future remote environment runs its own Worker, so filesystem and
process execution stays inside the native environment that owns it.

## Install
```shell
npm install --global @tibame201020/queqiao
queqiao --version
```

## Shell tab completion

Queqiao can generate native completion for PowerShell, Bash, and Zsh directly from the same
canonical command contract used by the CLI parser:

```powershell
queqiao completion powershell | Out-String | Invoke-Expression
```

```bash
eval "$(queqiao completion bash)"
```

```zsh
eval "$(queqiao completion zsh)"
```

Put the matching line in your shell profile. v0.8.4 completes the command hierarchy and documented
flags; runtime values such as named Gateways and Workers remain normal shell input.
## Mental model

- **Gateway** is the public control plane. It owns the MCP endpoint, OAuth, routing, and Worker membership.
- **Worker** is a native execution host. It owns filesystem/process execution for its environment.
- **Workspace** is a Worker-owned authority boundary. It limits roots, Tools, and executable commands.
- **Extension** is installed into the local Extension Hub, then explicitly attached to a Worker.

Queqiao intentionally does not hide these boundaries behind a generic `queqiao setup`. The
CLI teaches the same model that remains authoritative at runtime.

## First deployment

### 1. Configure the Gateway

Run the interactive Gateway wizard:

![Interactive Queqiao Gateway setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/01-gateway-setup.gif)

```shell
queqiao gateway setup
```

This creates or edits a named Gateway and configures its public URL, Gateway port, and local
management port.

### 2. Get the connector URL and approval secret

Before creating an AI-client connector, inspect the named Gateway locally:

![Interactive Queqiao Gateway connector info](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/02-gateway-info.gif)

```shell
queqiao gateway info
queqiao gateway info --detail
queqiao gateway info --copy-url
queqiao gateway info --copy-secret
```

`gateway info` keeps the approval secret hidden by default. `--detail` explicitly reveals it
for local manual copy, while the copy flags place exactly one value on the clipboard without
echoing that value again.
### 3. Configure the Worker and first Workspace

The Worker wizard creates the Worker and its first authorized Workspace in one flow:

![Interactive Queqiao Worker and Access setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/03-worker-access-setup.gif)

```shell
queqiao worker setup
```

Workspace setup chooses the root, display name, Access Profile, allowed Tools, and - when
`run` is allowed - the executable allowlist. A configured Worker always retains at least one
Workspace.

### 4. Select named instances when the deployment grows

When multiple Gateways or Workers exist, TTY commands open the shared instance selector:

![Interactive Queqiao named-instance selector](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/04-instance-selector.gif)

```shell
queqiao gateway status
```

Automation and `--json` calls stay deterministic: provide `--gateway <name>` or
`--worker <name>` explicitly instead of relying on interactive selection.

### 5. Install and attach Extensions

Extension installation and Worker attachment are separate operations:

![Interactive Queqiao Extension attachment](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/05-extension-attach.gif)

```shell
queqiao extension install <npm:package|local-path>
queqiao extension attach
```

Installing a package does not silently attach it to every Worker and does not expand a
Workspace's authority.

### 6. Start, enroll, and verify

#### 6A. Start the runtimes

Both roles use the same explicit lifecycle model:

![Interactive Queqiao runtime startup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/06-runtime-start.gif)

```shell
queqiao worker serve --worker <worker> --bg
queqiao gateway serve --gateway <gateway> --bg
```

#### 6B. Enroll the Worker

Generate a short-lived join code on the Gateway host. Human mode copies it to the clipboard;
`worker join` prompts for it without echoing the secret:

![Interactive Queqiao Worker enrollment](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/07-worker-enrollment.gif)

```shell
queqiao gateway join-token --gateway <gateway>
queqiao worker join --worker <worker>
```

Then verify both runtimes and Gateway membership:

```shell
queqiao worker status --worker <worker>
queqiao gateway status --gateway <gateway>
queqiao gateway workers list --gateway <gateway>
```

At this point the Gateway can route approved MCP operations to the enrolled Worker while the
Worker continues to enforce Workspace, Tool, command, and Extension authority locally.

## Documentation

| Need | Guide |
| --- | --- |
| Complete CLI command reference | [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) |
| Interactive, operational, and component visuals | [CLI visual guide](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) |
| Workspace / Access authority | [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) |
| Install or author Extensions | [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) |
| Runtime lifecycle, enrollment, cleanup, and migration | [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) |
| Gateway / Worker / protocol architecture | [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md) |
| Distribution and cluster guarantees | [Distribution baseline](https://github.com/tibame201020/Queqiao/blob/main/docs/distribution-cluster-baseline-v1.md) |
| Security / resource guarantees | [Security and resource baselines](https://github.com/tibame201020/Queqiao/blob/main/docs/resource-safety-baseline-v1.md) |
| Release and acceptance evidence | [Validation index](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md) |

## Contributing and security

Contributions are welcome. See [CONTRIBUTING.md](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) and
[SECURITY.md](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md) before submitting changes or security reports.

## Inspiration and independence

Queqiao was inspired by [Waishnav DevSpace](https://github.com/Waishnav/devspace) and its
approach to exposing selected local coding workspaces through MCP. Queqiao is an independent
implementation and is not affiliated with or endorsed by DevSpace.
