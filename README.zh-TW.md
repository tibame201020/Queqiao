# Queqiao

[English](https://github.com/tibame201020/Queqiao/blob/main/README.md) | **繁體中文**
[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/tibame201020/Queqiao/blob/main/LICENSE)
[![npm](https://img.shields.io/npm/v/@tibame201020/queqiao.svg)](https://www.npmjs.com/package/@tibame201020/queqiao)

Queqiao 是一座讓 AI client 安全連接多個本機開發環境的橋樑。
公開的 Gateway 負責 MCP ingress、驗證、路由與 Worker membership；每個 Windows、WSL、Linux
或未來的遠端環境都執行自己的 Worker，因此檔案系統與程序執行會留在真正擁有該環境的原生系統內。

## 安裝

```shell
npm install --global @tibame201020/queqiao
queqiao --version
```

## Shell Tab 自動補齊

Queqiao 可以直接由 CLI parser 使用的同一份 canonical command contract 產生 PowerShell、Bash 與 Zsh 的原生補齊 script。

```powershell
queqiao completion powershell | Out-String | Invoke-Expression
```

```bash
eval "$(queqiao completion bash)"
```

```zsh
eval "$(queqiao completion zsh)"
```

將對應指令放進 shell profile，即可讓新的 terminal 自動啟用。v0.8.4 會補齊 command hierarchy 與已記錄的 flags；
Gateway、Worker 等 runtime instance 名稱目前仍由 shell 正常輸入，不會在按 Tab 時讀取 runtime 狀態。

## 心智模型

- **Gateway** 是公開 control plane，負責 MCP endpoint、OAuth、路由與 Worker membership。
- **Worker** 是原生 execution host，負責該環境中的檔案系統與程序執行。
- **Workspace** 是 Worker 擁有的 authority boundary，用來限制 root、Tools 與可執行 commands。
- **Extension** 先安裝到本機 Extension Hub，再明確 attach 到指定 Worker。

Queqiao 不會用一個泛用的 `queqiao setup` 隱藏這些邊界。CLI 會直接呈現 runtime 中真正具有權威性的同一套模型。

## 第一次部署

### 1. 設定 Gateway

執行互動式 Gateway wizard：

![Interactive Queqiao Gateway setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/01-gateway-setup.gif)

```shell
queqiao gateway setup
```

這會建立或編輯具名 Gateway，並設定 public URL、Gateway port 與本機 management port。

### 2. 取得 Connector URL 與 approval secret

建立 AI client connector 前，先在本機查看指定 Gateway：

![Interactive Queqiao Gateway connector info](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/02-gateway-info.gif)

```shell
queqiao gateway info
queqiao gateway info --detail
queqiao gateway info --copy-url
queqiao gateway info --copy-secret
```

`gateway info` 預設不會顯示 approval secret。`--detail` 是明確的本機 reveal；兩個 copy flags 則只會把其中一個值放入剪貼簿，且不再次把內容輸出到 terminal。

### 3. 設定 Worker 與第一個 Workspace

Worker wizard 會在同一個流程建立 Worker 與第一個已授權 Workspace：

![Interactive Queqiao Worker and Access setup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/03-worker-access-setup.gif)

```shell
queqiao worker setup
```

Workspace setup 會選擇 root、display name、Access Profile、允許的 Tools；如果允許 `run`，也會設定 executable allowlist。
已完成設定的 Worker 會至少保留一個 Workspace。

### 4. 部署擴大後選擇具名 instance

當存在多個 Gateway 或 Worker 時，TTY command 會開啟共用 instance selector：

![Interactive Queqiao named-instance selector](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/04-instance-selector.gif)

```shell
queqiao gateway status
```

Automation 與 `--json` 呼叫保持 deterministic：請明確提供 `--gateway <name>` 或 `--worker <name>`，不要依賴互動式選擇。

### 5. 安裝並 attach Extensions

Extension 安裝與 Worker attachment 是兩個獨立操作：

![Interactive Queqiao Extension attachment](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/05-extension-attach.gif)

```shell
queqiao extension install <npm:package|local-path>
queqiao extension attach
```

安裝 package 不會自動 attach 到所有 Worker，也不會擴大 Workspace 的 authority。

### 6. 啟動、加入並驗證

#### 6A. 啟動 runtime

Gateway 與 Worker 使用同一套明確 lifecycle 模型：

![Interactive Queqiao runtime startup](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/06-runtime-start.gif)

```shell
queqiao worker serve --worker <worker> --bg
queqiao gateway serve --gateway <gateway> --bg
```

#### 6B. 將 Worker 加入 Gateway

在 Gateway host 產生短效 join code。Human mode 會複製到剪貼簿；`worker join` 會以不回顯 secret 的 prompt 讀取它：

![Interactive Queqiao Worker enrollment](https://raw.githubusercontent.com/tibame201020/Queqiao/main/docs/assets/cli/interactive/07-worker-enrollment.gif)

```shell
queqiao gateway join-token --gateway <gateway>
queqiao worker join --worker <worker>
```

接著驗證兩個 runtime 與 Gateway membership：

```shell
queqiao worker status --worker <worker>
queqiao gateway status --gateway <gateway>
queqiao gateway workers list --gateway <gateway>
```

到這一步，Gateway 可以把已核准的 MCP operations 路由到已加入的 Worker；Worker 仍會在本機強制執行 Workspace、Tool、command 與 Extension authority。

## 文件

| 需求 | 文件 |
| --- | --- |
| 完整 CLI command reference | [CLI reference](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/reference.md) |
| 互動式、操作流程與 component 視覺文件 | [CLI visual guide](https://github.com/tibame201020/Queqiao/blob/main/docs/cli/README.md) |
| Workspace / Access authority | [Workspace authority](https://github.com/tibame201020/Queqiao/blob/main/docs/workspace-authority.md) |
| 安裝或開發 Extensions | [Extensions](https://github.com/tibame201020/Queqiao/blob/main/docs/extensions.md) |
| Runtime lifecycle、enrollment、cleanup 與 migration | [Operations](https://github.com/tibame201020/Queqiao/blob/main/docs/operations.md) |
| Gateway / Worker / protocol architecture | [Architecture](https://github.com/tibame201020/Queqiao/blob/main/docs/architecture.md) |
| Distribution 與 cluster guarantees | [Distribution baseline](https://github.com/tibame201020/Queqiao/blob/main/docs/distribution-cluster-baseline-v1.md) |
| Security / resource guarantees | [Security and resource baselines](https://github.com/tibame201020/Queqiao/blob/main/docs/resource-safety-baseline-v1.md) |
| Release 與 acceptance evidence | [Validation index](https://github.com/tibame201020/Queqiao/blob/main/docs/validation/README.md) |

## Contributing 與 Security

歡迎貢獻。提交變更或 security report 前，請先閱讀 [CONTRIBUTING.md](https://github.com/tibame201020/Queqiao/blob/main/CONTRIBUTING.md) 與 [SECURITY.md](https://github.com/tibame201020/Queqiao/blob/main/SECURITY.md)。

## 靈感來源與獨立性

Queqiao 受到 [Waishnav DevSpace](https://github.com/Waishnav/devspace) 以及其透過 MCP 暴露指定本機 coding workspace 的方式啟發。
Queqiao 是獨立實作，與 DevSpace 無隸屬或背書關係。
