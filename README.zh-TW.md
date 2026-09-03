# Queqiao

[English](https://github.com/tibame201020/Queqiao/blob/main/README.md) | **繁體中文**
[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@tibame201020/queqiao.svg)](https://www.npmjs.com/package/@tibame201020/queqiao)

Queqiao 是 AI client 與本機開發環境之間的安全橋接層。公開 Gateway 負責 MCP ingress、驗證、路由與 Worker membership；Windows、WSL、Linux 或遠端環境各自執行自己的 Worker，讓檔案系統與程序操作留在實際擁有它們的環境內。

## 安裝

```shell
npm install --global @tibame201020/queqiao
queqiao --version
```

## 核心模型

- **Gateway** — 公開 control plane：MCP endpoint、OAuth、routing、Worker membership。
- **Worker** — 單一 OS／環境的 native execution host。
- **Workspace** — Worker 擁有的 authority boundary，限制 root、Tools 與可執行命令。
- **Access Profile** — 可重複使用的 authority template；套用時複製到 Workspace。
- **Extension** — 安裝到主機的 Extension Hub，再明確 attach 到 Worker。

## Quick Start — Workstation

啟動持續運作的管理介面：

```shell
queqiao workstation
```

第一次部署可以完全在 Workstation 內完成。

### 1. 設定 Gateway

選 **Gateway (`1`) → Set up Gateway**，輸入 public URL、Gateway port 與本機 management port。**Worker connectivity** 預設為 **Local only**；若另一台主機要加入，選 **Remote workers**，再輸入 Gateway 的 DNS 名稱或 LAN IP，以及專用 TLS gRPC port。

![Gateway setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/01-gateway-setup.gif)

### 2. 啟動 Gateway

選取已設定 Gateway，執行 **Start**。

![Gateway start](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/02-gateway-start.gif)

### 3. 設定 Worker

選 **Worker (`2`) → Set up Worker**。Setup 會一起建立 Worker、第一個 Workspace 與 authority policy。

![Worker setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/03-worker-setup.gif)

### 4. 啟動 Worker

選取已設定 Worker，執行 **Start**。

![Worker start](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/04-worker-start.gif)

### 5. 建立 join code

回到 **Gateway (`1`)** 執行 **Create join code**。Clipboard 可用時會直接複製短效 join code。

![Create join code](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/05-create-join-code.gif)

### 6. Worker 加入 Gateway

開 **Worker (`2`) → Join Gateway**，可選本機 Gateway，或貼上其他主機產生的 self-contained join code。Remote join code 已包含 pinned Gateway certificate 與 Worker-session target，Worker 會主動建立 outbound TLS gRPC session，不需要暴露 LAN inbound execution port。

![Worker join](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/06-worker-join.gif)

### 7. 確認 Gateway Detailed Info

回到 Gateway Inspector 按 `i`。Detailed Info 直接顯示 runtime status、connector 資訊、enrolled Workers，以及 Worker transport 是 **Local only** 或 **Remote · TLS gRPC**。

![Gateway Detailed Info](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/07-gateway-detail.gif)

`1..6` 切換 domain；方向鍵移動／選取；`Enter` inspect 或執行 action；`i` 開 Detailed Info；`?` 開 Help；`,` 開 Appearance Settings；沒有 modal 取得 input 時可按 `q` 離開。

各 control、action 行為、Appearance，以及每個 domain 的 Detailed Info 截圖／GIF，請見 **[Workstation 詳細指南](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.zh-TW.md)**。需要 script／automation 時請使用 **[Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md)**。

## Configuration 與 Persistence

Queqiao 將 **config**、**durable data**、**operational state** 與 **ephemeral runtime files** 分離。Named Gateway／Worker 設定不放在 repository；Workspace 直接持久化在各 Worker 的 `config.yaml`，不是另一份 production `workspaces.json`。

```shell
queqiao doctor paths
```

Windows／Linux／WSL 路徑、secrets、membership、Extension Hub、logs/PID、backup 與 `QUEQIAO_*` overrides，請見 **[Configuration & Persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.zh-TW.md)**。

## 文件

- [Workstation](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.zh-TW.md) — operator UI、controls、Appearance、Detailed Info、actions/modal 與實際錄製畫面。
- [Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) — command-oriented workflows 與 real PTY recordings。
- [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) — 完整 command surface、selector、JSON output 與 shell completion。
- [Configuration & Persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.zh-TW.md) — on-disk model、secrets、backup 與 cross-OS paths。
- [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) · [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) · [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) · [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md)
- [Validation evidence](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md) · [Contributing](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) · [Security](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md)

Queqiao 受到 [Waishnav DevSpace](https://github.com/Waishnav/devspace) 啟發，但為獨立實作，與 DevSpace 無隸屬或背書關係。
