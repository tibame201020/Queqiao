# Queqiao

[English](https://github.com/tibame201020/Queqiao/blob/main/README.md) | **繁體中文**
[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/tibame201020/Queqiao/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/@tibame201020/queqiao.svg)](https://www.npmjs.com/package/@tibame201020/queqiao)

Queqiao 是 AI client 與多個本機開發環境之間的安全橋接層。公開 Gateway 負責 MCP ingress、驗證、路由與 Worker membership；Windows、WSL、Linux 或未來遠端環境各自執行 Worker，讓檔案系統與程序操作留在實際擁有該環境的主機。

## 安裝
```shell
npm install --global @tibame201020/queqiao
queqiao --version
```

## Shell tab completion

PowerShell、Bash、Zsh completion 都由 CLI parser 使用的同一份 canonical command contract 產生：

```powershell
queqiao completion powershell | Out-String | Invoke-Expression
```

```bash
eval "$(queqiao completion bash)"
```

```zsh
eval "$(queqiao completion zsh)"
```

把對應命令加入 shell profile 即可；Gateway、Worker 等 runtime value 仍由 shell 正常輸入。

## 核心模型

- **Gateway**：公開 control plane，負責 MCP endpoint、OAuth、routing 與 Worker membership。
- **Worker**：原生 execution host，擁有該環境內的 filesystem/process execution。
- **Workspace**：Worker 擁有的 authority boundary，限制 root、Tools 與 executable commands。
- **Extension**：先安裝到本機 Extension Hub，再明確 attach 到 Worker。

Queqiao 不用通用 `queqiao setup` 隱藏這些邊界；CLI 與 runtime 使用同一套 ownership model。

## 第一次部署

### 1. 設定 Gateway

![Interactive Queqiao Gateway setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/01-gateway-setup.gif)

```shell
queqiao gateway setup
```

建立或編輯具名 Gateway，設定 public URL、Gateway port 與本機 management port。

### 2. 取得 connector URL 與 approval secret

![Interactive Queqiao Gateway connector info](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/02-gateway-info.gif)

```shell
queqiao gateway info
queqiao gateway info --detail
queqiao gateway info --copy-url
queqiao gateway info --copy-secret
```

`gateway info` 預設隱藏 approval secret；`--detail` 明確顯示，copy flags 則只把指定值放進剪貼簿，不再次輸出到 terminal。

### 3. 設定 Worker 與第一個 Workspace

![Interactive Queqiao Worker and Access setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/03-worker-access-setup.gif)

```shell
queqiao worker setup
```

Workspace setup 會設定 root、display name、Access Profile、Tools，以及在允許 `run` 時的 executable allowlist。已設定的 Worker 至少保留一個 Workspace。

### 4. 管理 Workspaces 與 Access Profiles

![Interactive Queqiao Workspace Management](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/04-workspace-management.gif)

```shell
queqiao worker workspace
```

TUI 把 Worker-owned Workspaces 與 reusable Access Profiles 分開。套用 profile 時會把 Tools 與 executable allowlist 複製到 Workspace；之後 edit、rename 或 delete profile 不會暗中修改已套用的 Workspace。Automation 可使用 CLI reference 中明確的 `workspace ...` 與 `workspace profiles ...` 子命令。

### 5. 多 instance 時選擇具名 Gateway / Worker

![Interactive Queqiao named-instance selector](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/05-instance-selector.gif)

```shell
queqiao gateway status
```

TTY 可使用共用 selector；automation 與 `--json` 應明確提供 `--gateway <name>` 或 `--worker <name>`。

### 6. 安裝並 attach Extensions

![Interactive Queqiao Extension attachment](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/06-extension-attach.gif)

```shell
queqiao extension install <npm:package|local-path>
queqiao extension attach
```

安裝 package 不會自動 attach 到所有 Worker，也不會擴大 Workspace authority。

### 7. 啟動、enroll、驗證

#### 7A. 啟動 runtimes

![Interactive Queqiao runtime startup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/07-runtime-start.gif)

```shell
queqiao worker serve --worker <worker> --bg
queqiao gateway serve --gateway <gateway> --bg
```

#### 7B. Enroll Worker

![Interactive Queqiao Worker enrollment](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/08-worker-enrollment.gif)

```shell
queqiao gateway join-token --gateway <gateway>
queqiao worker join --worker <worker>
```

接著驗證 runtime 與 Gateway membership：

```shell
queqiao worker status --worker <worker>
queqiao gateway status --gateway <gateway>
queqiao gateway workers list --gateway <gateway>
```

Gateway 此時可把核准的 MCP operation 路由到已 enroll 的 Worker；Worker 仍在本機強制執行 Workspace、Tool、command 與 Extension authority。

## 文件

- [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) — 完整 public command surface。
- [CLI visual guide](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) — interactive / operational / component visuals。
- [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) — Workspace 與 Access policy。
- [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) — Extension Hub 與 authoring。
- [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) — lifecycle、enrollment、cleanup、migration。
- [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md) 與 [validation evidence](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md)。

Contributing 與安全回報請參考 [CONTRIBUTING.md](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) 與 [SECURITY.md](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md)。Queqiao 受 [Waishnav DevSpace](https://github.com/Waishnav/devspace) 啟發，但為獨立實作，與 DevSpace 無隸屬或背書關係。
