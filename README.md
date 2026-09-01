# Queqiao

**English** | [繁體中文](README.zh-TW.md)
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

![Queqiao Workstation overview](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/01-overview.gif)

A first deployment can be completed without leaving Workstation:

1. **Gateway (`1`)** — choose **Set up Gateway**, configure its public URL and ports, then **Start** it.
2. **Worker (`2`)** — choose **Set up Worker**, create its first Workspace and authority policy, then **Start** it.
3. **Gateway (`1`)** — **Create join code**. The code is copied when clipboard access is available; otherwise Workstation displays a copyable fallback.
4. **Worker (`2`)** — **Join Gateway** and enter the short-lived join code.
5. **Gateway (`1`)** — **Copy MCP URL** and **Copy approval secret** when registering the connector in the AI client.
6. **Diagnostics (`6`)** — verify Core runtimes, Gateway routing, and Extension Hub health.

Workstation keeps the same domain model as the leaf CLI. `1..6` switch domains, arrow keys move spatially/select rows, `Enter` inspects/runs the selected action, `i` opens Detailed Info, `?` opens Help, `,` opens Appearance Settings, and `q` exits. Simple actions execute directly; forms and destructive confirmation appear only when the operation requires input or review.

### Workstation controls

<details><summary><b>Gateway — lifecycle, connector values, membership</b></summary>

![Gateway control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/02-gateway.gif)

Set up/start/stop Gateways, copy the MCP URL or approval secret, issue join codes, and inspect enrolled Worker membership.
</details>

<details><summary><b>Worker — native runtime and enrollment</b></summary>

![Worker control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/03-worker.gif)

Set up/start/stop a native Worker, inspect its identity and health, join it to a Gateway, and manage its local execution boundary.
</details>

<details><summary><b>Workspace — filesystem and tool authority</b></summary>

![Workspace control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/04-workspace.gif)

Create and edit Worker-owned roots with explicit Tool and executable-command authority. A configured Worker always retains at least one Workspace.
</details>

<details><summary><b>Access Profile — reusable authority templates</b></summary>

![Access Profile control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/05-access-profile.gif)

Create reusable Tool/command templates. Applying a profile copies policy into a Workspace; later profile changes do not silently rewrite existing Workspaces.
</details>

<details><summary><b>Extension — Hub inventory and Worker attachment</b></summary>

![Extension control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/06-extension.gif)

Install packages into the local Extension Hub and explicitly attach/detach them from Workers. Installation alone does not expand Workspace authority.
</details>

<details><summary><b>Diagnostics — runtime, routing, and Hub health</b></summary>

![Diagnostics control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/07-diagnostics.gif)

Run the same authoritative diagnostics used by `queqiao doctor`, with structured warnings and remediation rather than a second health model.
</details>

## Configuration and persistence

Queqiao intentionally separates **config**, **durable data**, **operational state**, and **ephemeral runtime files**. Named Gateway/Worker configuration is not stored in the repository, and Workspaces are persisted inside each Worker's `config.yaml` rather than a separate current `workspaces.json`.

Use this command to discover the host-level roots on the current machine:

```shell
queqiao doctor paths
```

See **[Configuration & persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.md)** for exact Windows/Linux/WSL paths, file contents, secrets, Extension Hub storage, membership registry, logs/PIDs, backup guidance, and `QUEQIAO_*` path overrides.

## Documentation

- [Workstation guide](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.md) — layouts, controls, Detailed Info, actions/modals, responsive behavior, and recorded UI.
- [Classic / leaf CLI guide](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) — command-oriented workflows and real PTY recordings for scripting and automation.
- [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) — complete public command surface and JSON/selector rules.
- [Configuration & persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.md) — on-disk model, secrets, backup/migration boundaries, Windows/Linux/WSL paths.
- [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) · [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) · [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) · [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md)
- [Validation evidence](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md) · [Contributing](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) · [Security](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md)

Shell completion and the full non-interactive command surface are documented in the [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md). Queqiao was inspired by [Waishnav DevSpace](https://github.com/Waishnav/devspace) but is an independent implementation with no affiliation or endorsement.