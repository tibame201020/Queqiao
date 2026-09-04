# Queqiao

[English](https://github.com/tibame201020/Queqiao/blob/main/README.md) | **繁體中文**
[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@tibame201020/queqiao.svg)](https://www.npmjs.com/package/@tibame201020/queqiao)

Queqiao 是 AI client 與本機開發環境之間的安全橋接層。公開 Gateway 負責 MCP ingress、驗證、路由與 Worker membership；Windows、WSL、Linux 或遠端環境各自執行自己的 Worker，讓檔案系統與程序操作留在實際擁有它們的環境內。

## 安裝

需求：Node.js `>=22.19 <25`、npm `>=9`。

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

## 開始前

若 AI client 不在 Gateway 主機上，請先準備一個可以連到 Gateway 的 HTTPS URL。Gateway setup 會要求輸入這個 URL，後續複製的 MCP endpoint 也會以它為基礎。

Worker 的連線方式是另一件事：

- **Worker 與 Gateway 同一台主機** — 保持 **Worker connectivity: Local only**。
- **Worker 在另一台主機** — 選 **Remote workers**，並讓該 Worker 能連到 Gateway 專用的 pinned-TLS gRPC Worker-session listener。Remote Worker 主動建立 outbound session，不需要暴露 inbound execution port。

## Quick Start — Workstation

啟動持續運作的管理介面：

```shell
queqiao workstation
```

第一次部署的完整路徑是 Gateway → Worker → membership → AI client。

### 1. 設定並啟動 Gateway

選 **Gateway (`1`) → Set up Gateway**，輸入 public URL、Gateway port 與本機 management port。依照上面的 topology 選 **Local only** 或 **Remote workers**。完成後選取 Gateway 並執行 **Start**。

![Gateway setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/01-gateway-setup.gif)

### 2. 設定並啟動 Worker

選 **Worker (`2`) → Set up Worker**。Setup 會一起建立 Worker、第一個 Workspace 與 authority policy。完成後選取 Worker 並執行 **Start**。

![Worker setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/03-worker-setup.gif)

### 3. 讓 Worker 加入 Gateway

在 Gateway 執行 **Create join code**。接著在 Worker 執行 **Join Gateway**，可以選本機 Gateway，或貼上其他主機產生的 self-contained join code。

Remote join code 已包含 pinned Gateway certificate 與 Worker-session target，Worker 可據此建立 outbound TLS gRPC session。

![Worker join](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/06-worker-join.gif)

### 4. 驗證部署狀態

回到 Gateway Inspector 按 `i`。**Detailed Info** 應該可以看到：

- Gateway runtime healthy；
- Worker 已 enrolled；
- Worker transport 是 **Local only** 或 **Remote · TLS gRPC**；
- 公開 Gateway 的 connector 資訊。

若其中一項不存在，先不要進 ChatGPT connector 設定；請先使用 **Diagnostics (`6`)** 或依 Workstation 顯示的 remediation 修正。

### 5. 在 ChatGPT 新增 Queqiao

在 Gateway Inspector：

1. 按 `c` — **Copy MCP URL**；
2. 按 `p` — **Copy approval secret**；
3. 在 ChatGPT 建立 custom app/connector，貼上 MCP URL，驗證方式選 **OAuth**；
4. 連線後，只在 Queqiao OAuth approval 頁貼上 approval secret。

不要把 approval secret 放進文件、log、repository 或 issue。

![在 ChatGPT 新增 Queqiao connector](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/quickstart/10-chatgpt-add-connector.png)

完成後的第一條完整路徑應為：

```text
AI client → HTTPS Gateway → enrolled Worker → Workspace
```

若未來版本修改公開 MCP tool schema，請在 ChatGPT 使用 **Refresh**，並從新對話驗證。**Reconnect** 是 connection/OAuth recovery，不負責 schema discovery。

## 下一步

- 在 **Workspace (`3`)** / **Access Profile (`4`)** 調整 Workspace authority。
- 從 **Extension (`5`)** 安裝並 attach 額外 Worker capability。請見 [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md)。
- topology、membership 或 Extension 改動後，執行 **Diagnostics (`6`)**。
- script／CI 請使用 [Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md)，不要驅動 TUI。

`1..6` 切換 domain；方向鍵移動／選取；`Enter` inspect 或執行 action；`i` 開 Detailed Info；`?` 開 Help；`,` 開 Appearance Settings；沒有 modal 取得 input 時可按 `q` 離開。

Root README 只保留需要說明多步驟或 topology 的錄製畫面；各 control、Appearance 與 Detailed Info 的 screenshot/GIF 請見 [Workstation 詳細指南](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.zh-TW.md)。

## Configuration 與 Persistence

Queqiao 將 **config**、**durable data**、**operational state** 與 **ephemeral runtime files** 分離。Named Gateway／Worker 設定不放在 repository；Workspace 直接持久化在各 Worker 的 `config.yaml`，不是另一份 production `workspaces.json`。

```shell
queqiao doctor paths
```

Windows／Linux／WSL 路徑、secrets、membership、Extension Hub、logs/PID、backup 與 `QUEQIAO_*` overrides，請見 [Configuration & Persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.zh-TW.md)。

## 文件

- [Workstation](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.zh-TW.md) — operator UI、controls、Appearance、Detailed Info、actions/modal 與實際錄製畫面。
- [Classic / leaf CLI](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) — command-oriented workflows 與 real PTY recordings。
- [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) — 完整 command surface、selector、JSON output 與 shell completion。
- [Configuration & Persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.zh-TW.md) — on-disk model、secrets、backup 與 cross-OS paths。
- [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) · [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) · [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) · [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md)
- [Validation evidence](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md) · [Contributing](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) · [Security](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md)

Queqiao 受到 [Waishnav DevSpace](https://github.com/Waishnav/devspace) 啟發，但為獨立實作，與 DevSpace 無隸屬或背書關係。
