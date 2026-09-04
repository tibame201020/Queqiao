# Queqiao

**English** | [繁體中文](https://github.com/tibame201020/Queqiao/blob/main/README.zh-TW.md)
[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@tibame201020/queqiao.svg)](https://www.npmjs.com/package/@tibame201020/queqiao)

Queqiao is a secure bridge between AI clients and local coding environments. A public Gateway owns MCP ingress, authentication, routing, and Worker membership; each Windows, WSL, Linux, or remote environment runs its own Worker so filesystem and process execution stays inside the environment that owns it.

## Install

Requirements: Node.js `>=22.19 <25` and npm `>=9`.

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

## Before you start

For an AI client outside the Gateway host, prepare an HTTPS URL that reaches the Gateway. The URL is entered during Gateway setup and becomes the MCP endpoint copied later.

Worker networking is separate:

- **Same-host Worker** — keep **Worker connectivity: Local only**.
- **Worker on another machine** — choose **Remote workers** and expose the dedicated pinned-TLS gRPC Worker-session listener to that Worker. The remote Worker connects outbound; it does not expose an inbound execution port.

## Quick start — Workstation

Launch the persistent operator UI:

```shell
queqiao workstation
```

The complete first deployment is Gateway → Worker → membership → AI client.

### 1. Set up and start the Gateway

Choose **Gateway (`1`) → Set up Gateway** and enter the public URL, Gateway port, and local management port. Select **Local only** or **Remote workers** according to the topology above. Then select the configured Gateway and run **Start**.

![Gateway setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/01-gateway-setup.gif)

### 2. Set up and start the Worker

Choose **Worker (`2`) → Set up Worker**. Setup creates the Worker and its first Workspace/authority policy together. Then select the Worker and run **Start**.

![Worker setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/03-worker-setup.gif)

### 3. Join the Worker to the Gateway

On the Gateway, run **Create join code**. On the Worker, run **Join Gateway** and either choose the local Gateway or paste a self-contained join code from another host.

Remote join codes carry the pinned Gateway certificate and Worker-session target, so the Worker can establish its outbound TLS gRPC session.

![Worker join](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/06-worker-join.gif)

### 4. Verify the deployment

Return to the Gateway Inspector and press `i`. **Detailed Info** should show:

- Gateway runtime healthy;
- the Worker enrolled;
- Worker transport as **Local only** or **Remote · TLS gRPC**;
- connector information for the public Gateway.

If one of these is missing, do not continue to connector setup; use **Diagnostics (`6`)** or the Workstation result/remediation text first.

### 5. Add Queqiao to ChatGPT

In the Gateway Inspector:

1. press `c` — **Copy MCP URL**;
2. press `p` — **Copy approval secret**;
3. in ChatGPT, create a custom app/connector with the copied MCP URL and **OAuth** authentication;
4. connect, then paste the approval secret only into Queqiao's OAuth approval page.

Never put the approval secret in documentation, logs, repositories, or issue reports.

![Add Queqiao connector in ChatGPT](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/10-chatgpt-add-connector.png)

A successful first deployment now has the complete path:

```text
AI client → HTTPS Gateway → enrolled Worker → Workspace
```

If a future Queqiao release changes the public MCP tool schema, use ChatGPT's **Refresh** action and validate from a new conversation. **Reconnect** is for connection/OAuth recovery, not schema discovery.

## Next steps

- Add or adjust Workspace authority from **Workspace (`3`)** / **Access Profile (`4`)**.
- Install and attach optional Worker capabilities from **Extension (`5`)**. See [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md).
- Run **Diagnostics (`6`)** after topology, membership, or Extension changes.
- For scripts/CI, use the [Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) instead of driving the TUI.

`1..6` switch domains, arrows move/select, `Enter` inspects or runs an action, `i` opens Detailed Info, `?` opens Help, `,` opens Appearance Settings, and `q` exits when no modal owns input.

The root README intentionally keeps only the recordings that explain multi-step or topology-sensitive flows. Per-control recordings, Appearance behavior, and Detailed Info screenshots/GIFs live in the [Workstation guide](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.md).

## Configuration and persistence

Queqiao separates **config**, **durable data**, **operational state**, and **ephemeral runtime files**. Named Gateway/Worker configuration is outside the repository, and Workspaces are persisted inside each Worker's `config.yaml` rather than a separate production `workspaces.json`.

```shell
queqiao doctor paths
```

See [Configuration & persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.md) for Windows/Linux/WSL paths, secrets, membership, Extension Hub storage, logs/PIDs, backup guidance, and `QUEQIAO_*` path overrides.

## Documentation

- [Workstation](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.md) — operator UI, controls, Appearance, Detailed Info, actions/modals, and recorded UI.
- [Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) — command-oriented workflows and real PTY recordings.
- [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) — complete command surface, selectors, JSON output, and shell completion.
- [Configuration & persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.md) — on-disk model, secrets, backups, and cross-OS paths.
- [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) · [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) · [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) · [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md)
- [Validation evidence](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md) · [Contributing](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) · [Security](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md)

Queqiao was inspired by [Waishnav DevSpace](https://github.com/Waishnav/devspace) but is an independent implementation with no affiliation or endorsement.
