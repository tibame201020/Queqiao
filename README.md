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

## What you are building

```text
AI client
   ↓ HTTPS / MCP
Gateway
   ↓ enrolled Worker
Worker
   ↓ authorized root
Workspace
```

- **Gateway** — public MCP endpoint, OAuth, routing, and Worker membership.
- **Worker** — native execution host for one OS/environment.
- **Workspace** — Worker-owned authority boundary for filesystem roots, Tools, and executable commands.
- **Access Profile** — reusable Workspace authority template.
- **Extension** — optional capability installed into the host Extension Hub, then attached to a Worker.

## Before you start

For an AI client outside the Gateway host, prepare an HTTPS URL that reaches the Gateway. This public URL is entered during Gateway setup and later becomes the MCP endpoint copied into ChatGPT or another AI client.

Choose Worker connectivity before setup:

| Topology | Gateway setting | Worker behavior |
| --- | --- | --- |
| Gateway and Worker on the same host | **Local only** | Gateway reaches the local Worker directly. |
| Worker on another machine | **Remote workers** | Worker connects outbound to the Gateway pinned-TLS gRPC session listener. |

A remote Worker does **not** expose an inbound execution port.

## Quick start — Workstation

First working deployment:

```shell
queqiao workstation
```

Complete these steps in order. Each recording below demonstrates only the task named by that step.

### 1. Set up the Gateway

Open **Gateway (`1`) → Set up Gateway**. Enter the public URL, Gateway service port, local management port, and the Worker connectivity mode chosen above.

![Set up Gateway](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/01-gateway-setup.gif)

**Done when:** the Gateway appears in the Gateway inventory as configured.

### 2. Start the Gateway

Select the configured Gateway and run **Start**.

**Done when:** its runtime state becomes running/healthy. If Start fails, read the Workstation result/remediation before continuing.

### 3. Set up the Worker

Open **Worker (`2`) → Set up Worker**. Setup creates the Worker plus its first Workspace authority in one task.

![Set up Worker](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/03-worker-setup.gif)

**Done when:** the Worker appears in Worker inventory and its Workspace is listed under **Workspace (`3`)**.

### 4. Start the Worker

Select the configured Worker and run **Start**.

**Done when:** the Worker runtime is healthy. For a remote Worker, this does not enroll it yet; enrollment happens next.

### 5. Create a join code

Return to **Gateway (`1`)**, select the running Gateway, and run **Create join code**.

Use the generated code immediately. For a remote Worker, the self-contained join code carries the pinned Gateway certificate and Worker-session target.

**Done when:** Workstation reports that a join code was created/copied.

### 6. Join the Worker to the Gateway

Open **Worker (`2`) → Join Gateway**. Choose the local Gateway or paste the join code produced on another host.

![Join Worker](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/06-worker-join.gif)

**Done when:** the Gateway shows the Worker as enrolled/reachable.

### 7. Verify the complete path

Return to the Gateway Inspector and press `i` for **Detailed Info**. Verify all of the following before adding an AI client:

- Gateway runtime is healthy;
- the Worker is enrolled and reachable;
- Worker transport is **Local only** or **Remote · TLS gRPC** as expected;
- connector information is present for the public Gateway.

If any item is missing, run **Diagnostics (`6`)** first. Do not compensate for a broken Gateway/Worker path by changing ChatGPT connector settings.

### 8. Add Queqiao to ChatGPT

In the Gateway Inspector:

1. press `c` — **Copy MCP URL**;
2. press `p` — **Copy approval secret**;
3. in ChatGPT, create a custom app/connector with the copied MCP URL and **OAuth** authentication;
4. connect, then paste the approval secret only into Queqiao's OAuth approval page.

Never put the approval secret in documentation, logs, repositories, or issue reports.

![Add Queqiao connector in ChatGPT](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/10-chatgpt-add-connector.png)

**Done when:** the AI client can reach Queqiao and a Worker-backed tool call can reach the expected Workspace.

The finished route is:

```text
AI client → HTTPS Gateway → enrolled Worker → Workspace
```

If a future Queqiao release changes the public MCP tool schema, use ChatGPT's **Refresh** action and validate from a new conversation. **Reconnect** is for connection/OAuth recovery, not schema discovery.

## What to do next

- Adjust Workspace authority from **Workspace (`3`)** / **Access Profile (`4`)**.
- Install and attach optional Worker capabilities from **Extension (`5`)**. See [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md).
- Run **Diagnostics (`6`)** after topology, membership, or Extension changes.
- For scripts/CI, use the [Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) instead of driving the TUI.

Workstation navigation: `1..6` switch domains, arrows move/select, `Enter` inspects or runs an action, `i` opens Detailed Info, `?` opens Help, `,` opens Appearance Settings, and `q` exits when no modal owns input.

The root README keeps only recordings needed to explain a task that benefits from motion. Per-control recordings, Appearance behavior, and Detailed Info references live in the [Workstation guide](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.md).

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
