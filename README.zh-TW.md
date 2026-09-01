# Queqiao

[English](README.md) | **繁體中文**
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

![Queqiao Workstation overview](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/01-overview.gif)

第一次部署可以完全在 Workstation 內完成：

1. **Gateway (`1`)** — 選 **Set up Gateway**，設定 public URL 與 ports，再執行 **Start**。
2. **Worker (`2`)** — 選 **Set up Worker**，建立第一個 Workspace 與 authority policy，再執行 **Start**。
3. **Gateway (`1`)** — 執行 **Create join code**。可用剪貼簿時會直接複製；失敗時 Workstation 會顯示可手動複製的 fallback。
4. **Worker (`2`)** — 執行 **Join Gateway**，輸入短效 join code。
5. **Gateway (`1`)** — 註冊 AI client connector 時使用 **Copy MCP URL** 與 **Copy approval secret**。
6. **Diagnostics (`6`)** — 驗證 Core runtimes、Gateway routing 與 Extension Hub health。

Workstation 與 leaf CLI 共用同一套 domain model。`1..6` 切換 domain；方向鍵移動 pane／選取項目；`Enter` inspect／執行選定 action；`i` 開啟 Detailed Info；`?` 開 Help；`,` 開 Appearance Settings；`q` 離開。簡單 action 直接執行，只有需要輸入或具破壞性的操作才開 form／確認畫面。

### Workstation controls

<details><summary><b>Gateway — lifecycle、connector 資訊、membership</b></summary>

![Gateway control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/02-gateway.gif)

設定、啟停 Gateway，複製 MCP URL／approval secret、產生 join code，並檢視已 enroll 的 Worker membership。
</details>

<details><summary><b>Worker — native runtime 與 enrollment</b></summary>

![Worker control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/03-worker.gif)

設定、啟停 native Worker，檢視 identity／health、加入 Gateway，並管理本機 execution boundary。
</details>

<details><summary><b>Workspace — filesystem 與 tool authority</b></summary>

![Workspace control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/04-workspace.gif)

建立與編輯 Worker-owned roots，明確指定 Tool 與 executable-command authority；已設定的 Worker 至少保留一個 Workspace。
</details>

<details><summary><b>Access Profile — 可重用 authority template</b></summary>

![Access Profile control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/05-access-profile.gif)

建立可重用的 Tool／command template。套用 profile 會把 policy 複製到 Workspace；之後修改 profile 不會暗中改寫既有 Workspace。
</details>

<details><summary><b>Extension — Hub inventory 與 Worker attachment</b></summary>

![Extension control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/06-extension.gif)

把 package 安裝到本機 Extension Hub，再明確 attach／detach 到 Worker。單純安裝不會擴大 Workspace authority。
</details>

<details><summary><b>Diagnostics — runtime、routing、Hub health</b></summary>

![Diagnostics control](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/workstation/07-diagnostics.gif)

使用與 `queqiao doctor` 相同的 authoritative diagnostics，顯示結構化 warning 與 remediation，而不是建立第二套 health model。
</details>

## Configuration 與 Persistence

Queqiao 刻意把 **config**、**durable data**、**operational state** 與 **ephemeral runtime files** 分開。Named Gateway／Worker 設定不放在 repository 裡；目前正式模型中 Workspace 直接持久化在各 Worker 的 `config.yaml`，不是另一份 `workspaces.json`。

可先用以下命令查看目前主機的主要路徑：

```shell
queqiao doctor paths
```

完整 Windows／Linux／WSL 路徑、檔案內容、secret、Extension Hub、membership registry、logs/PID、backup 建議與 `QUEQIAO_*` override，請見 **[Configuration & Persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.zh-TW.md)**。

## 文件

- [Workstation 詳細指南](https://github.com/tibame201020/Queqiao/blob/main/docs/workstation/README.zh-TW.md) — layout、各 control、Detailed Info、actions/modal、responsive 行為與實際錄製畫面。
- [Classic / leaf CLI 指南](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) — 適合 script／automation 的命令式流程與真實 PTY 錄製。
- [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) — 完整 public command surface、JSON／selector 規則。
- [Configuration & Persistence](https://github.com/tibame201020/Queqiao/blob/main/docs/configuration-persistence.zh-TW.md) — on-disk model、secret、backup／migration boundary、Windows／Linux／WSL 路徑。
- [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) · [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) · [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) · [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md)
- [Validation evidence](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md) · [Contributing](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) · [Security](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md)

Shell completion 與完整 non-interactive command surface 請見 [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md)。Queqiao 受到 [Waishnav DevSpace](https://github.com/Waishnav/devspace) 啟發，但為獨立實作，與 DevSpace 無隸屬或背書關係。