# Queqiao

**English** | [繁體中文](https://github.com/tibame201020/Queqiao/blob/main/README.zh-TW.md)
[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@tibame201020/queqiao.svg)](https://www.npmjs.com/package/@tibame201020/queqiao)

Queqiao is a secure bridge between AI clients and local coding environments. A public Gateway owns MCP ingress, authentication, routing, and Worker membership; each Windows, WSL, Linux, or remote environment runs its own Worker so filesystem and process execution stays inside the environment that owns it.

## Install

```shell
npm install --global @tibame201020/queqiao
queqiao --version
```

## Mental model

- **Gateway** — public control plane: MCP endpoint, OAuth, routing, Worker membership.
- **Worker** — native execution host for one OS/environment.
- **Workspace** — Worker-owned authority boundary for roots, Tools, and executable commands.
- **Access Profile** — reusable authority template copied into a Workspace when applied.
- **Extension** — installed in the host Extension Hub, then explicitly attached to Workers.

## Quick start — Workstation

Launch the persistent operator UI:

```shell
queqiao workstation
```

Complete the first deployment entirely inside Workstation.

### 1. Set up the Gateway

Choose **Gateway (`1`) → Set up Gateway**, then enter its public URL, Gateway port, and local management port.

![Gateway setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/01-gateway-setup.gif)

### 2. Start the Gateway

Select the configured Gateway and run **Start**.

![Gateway start](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/02-gateway-start.gif)

### 3. Set up the Worker

Choose **Worker (`2`) → Set up Worker**. Setup creates the Worker and its first Workspace/authority policy together.

![Worker setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/03-worker-setup.gif)

### 4. Start the Worker

Select the configured Worker and run **Start**.

![Worker start](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/04-worker-start.gif)

### 5. Create a join code

Return to **Gateway (`1`)** and run **Create join code**. The short-lived code is copied when clipboard access is available.

![Create join code](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/05-create-join-code.gif)

### 6. Join the Worker

Open **Worker (`2`) → Join Gateway** and choose the local Gateway or paste a self-contained join code from another host.

![Worker join](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/06-worker-join.gif)

### 7. Verify Gateway details

Return to the Gateway Inspector and press `i`. Detailed Info exposes runtime status, connector information, and enrolled Workers without leaving Workstation.

![Gateway Detailed Info](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/07-gateway-detail.gif)

`1..6` switch domains, arrows move/select, `Enter` inspects or runs an action, `i` opens Detailed Info, `?` opens Help, `,` opens Appearance Settings, and `q` exits when no modal owns input.

For every control, action behavior, Appearance, and per-domain Detailed Info screenshots/GIFs, see the **[Workstation guide](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.md)**. For deterministic scripting/automation, use the **[Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md)**.

## Configuration and persistence

Queqiao separates **config**, **durable data**, **operational state**, and **ephemeral runtime files**. Named Gateway/Worker configuration is outside the repository, and Workspaces are persisted inside each Worker's `config.yaml` rather than a separate production `workspaces.json`.

```shell
queqiao doctor paths
```

See **[Configuration & persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.md)** for Windows/Linux/WSL paths, secrets, membership, Extension Hub storage, logs/PIDs, backup guidance, and `QUEQIAO_*` path overrides.

## Documentation

- [Workstation](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.md) — operator UI, controls, Appearance, Detailed Info, actions/modals, and recorded UI.
- [Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) — command-oriented workflows and real PTY recordings.
- [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) — complete command surface, selectors, JSON output, and shell completion.
- [Configuration & persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.md) — on-disk model, secrets, backups, and cross-OS paths.
- [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) · [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) · [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) · [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md)
- [Validation evidence](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md) · [Contributing](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) · [Security](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md)

Queqiao was inspired by [Waishnav DevSpace](https://github.com/Waishnav/devspace) but is an independent implementation with no affiliation or endorsement.
