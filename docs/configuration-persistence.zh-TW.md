# Configuration & Persistence

[English](configuration-persistence.md) | **繁體中文**

Queqiao 刻意把四種 storage class 分開，讓設定、durable data、operational state 與 transient process files 有不同的 backup 與 security 語意。

> Live files 應優先透過 Workstation／CLI 修改，不建議直接手改。Secret file 絕對不要 commit、貼到 issue，或放進診斷包。

## 查看目前主機路徑

```shell
queqiao doctor paths
```

這會列出目前 host 的 default config root、named Gateway／Worker discovery roots 與 Extension Hub。以下 default layout 也可由 `QUEQIAO_*` environment overrides 改寫。

## Storage classes

| 類別 | 用途 | Backup？ |
| --- | --- | --- |
| **Config** | Runtime/user 設定與 Workstation presentation settings | 是 |
| **Data** | Durable identity、secret、Gateway membership、profiles、Extension Hub/packages | 是，但必須保護 secrets |
| **State** | Managed-process metadata 與 logs | 通常可不備份 |
| **Runtime** | Ephemeral process/runtime files | 不要備份 |

## Default roots

### Windows

以下 `<LOCAL>` 代表 `%LOCALAPPDATA%\Queqiao`；`<TEMP>` 代表 `%TEMP%\Queqiao`。

| Scope | Config | Data | State | Runtime |
| --- | --- | --- | --- | --- |
| Host/default | `<LOCAL>\config` | `<LOCAL>\data` | `<LOCAL>\state` | `<TEMP>` |
| Gateway `<name>` | `<LOCAL>\gateways\<name>\config` | `<LOCAL>\gateways\<name>\data` | `<LOCAL>\gateways\<name>\state` | `<TEMP>\gateways\<name>` |
| Worker `<name>` | `<LOCAL>\workers\<name>\config` | `<LOCAL>\workers\<name>\data` | `<LOCAL>\workers\<name>\state` | `<TEMP>\workers\<name>` |

Named runtime config file：

```text
%LOCALAPPDATA%\Queqiao\gateways\<name>\config\config.yaml
%LOCALAPPDATA%\Queqiao\workers\<name>\config\config.yaml
```

### Linux / WSL

Queqiao 遵循 XDG roots；沒有 XDG override 時：

| Scope | Config | Data | State |
| --- | --- | --- | --- |
| Host/default | `~/.config/queqiao` | `~/.local/share/queqiao` | `~/.local/state/queqiao` |
| Gateway `<name>` | `~/.config/queqiao/gateways/<name>` | `~/.local/share/queqiao/gateways/<name>` | `~/.local/state/queqiao/gateways/<name>` |
| Worker `<name>` | `~/.config/queqiao/workers/<name>` | `~/.local/share/queqiao/workers/<name>` | `~/.local/state/queqiao/workers/<name>` |

Named config：

```text
~/.config/queqiao/gateways/<name>/config.yaml
~/.config/queqiao/workers/<name>/config.yaml
```

Runtime 優先使用 `${XDG_RUNTIME_DIR}`；沒有時會建立 user-scoped OS temp directory。這不是 durable storage。

Queqiao 把 WSL 視為 Linux host。除非使用者主動 override，WSL 的 config/data/state 與 Windows host 彼此獨立；這是刻意設計，因為每個 OS 擁有自己的 local Worker 與 filesystem authority。

## Named Gateway layout

```text
<gateway config>/
  config.yaml

<gateway data>/
  secrets/
    oauth-approval.secret
    jwt-signing.secret
  gateway/
    management.secret
    worker-memberships.json
    worker-credentials/
      <worker-id>-<random>.secret

<gateway state>/
  processes/
    gateway.pid.json
  logs/
    gateway.out.log      # Linux managed background runtime
    gateway.err.log
```

### `config.yaml`

Schema version `1`。Gateway section 保存 public／local runtime configuration，例如：

```yaml
version: 1
gateway:
  publicBaseUrl: https://gateway.example/stable/
  listen:
    host: 127.0.0.1
    port: 7575
  managementListen:
    host: 127.0.0.1
    port: 7574
  livenessIntervalMs: 30000
  trustProxyHops: 1
  stateDirectory: <gateway-data>/gateway
  approvalSecretFile: <gateway-data>/secrets/oauth-approval.secret
  jwtSigningSecretFile: <gateway-data>/secrets/jwt-signing.secret
  allowedRedirectOrigins:
    - https://chatgpt.com
    - http://127.0.0.1
    - http://localhost
extensions: []
workspaces: []
```

以上 path 都是 placeholder，不要把真實 secret value 複製到文件或 source control。

### Gateway secrets

- `oauth-approval.secret` — MCP client authorization 使用的 local approval secret。
- `jwt-signing.secret` — Gateway signing secret。
- `gateway/management.secret` — Queqiao CLI／Workstation 呼叫 loopback-only management API 的 credential。
- `gateway/worker-credentials/*.secret` — Gateway 持有的 enrolled Worker credentials。

這些都是 private credentials。Backup 它們會保留 identity／authorization state；遺失可能需要重新 setup／enroll。含 secrets 的 backup 必須加密且限制存取。

### `gateway/worker-memberships.json`

Gateway-owned authoritative enrollment/routing registry：

```json
{
  "version": 1,
  "workers": [
    {
      "workerId": "<uuid>",
      "environmentId": "windows",
      "transport": { "type": "http", "endpoint": "http://127.0.0.1:7576/" },
      "credentialRefs": [
        { "kind": "secret-file", "path": "<gateway-data>/gateway/worker-credentials/<credential>.secret" }
      ]
    }
  ]
}
```

Registry 是 durable topology；`credentialRefs` 會指向 secret file，因此 registry 與對應 credential 應一起保護。

## Named Worker layout

```text
<worker config>/
  config.yaml

<worker data>/
  secrets/
    worker-<environment-id>.secret

<worker state>/
  processes/
    worker.pid.json
  logs/
    worker.out.log       # Linux managed background runtime
    worker.err.log
```

### Worker `config.yaml`

Worker file 是 native identity、Workspaces 與 attached Extensions 的 authority source：

```yaml
version: 1
worker:
  workerId: <uuid>
  environmentId: windows
  listen:
    host: 127.0.0.1
    port: 7576
  tokenFile: <worker-data>/secrets/worker-windows.secret
  process:
    foregroundConcurrency: 8
    backgroundConcurrency: 8
    sessionConcurrency: 8
    jobQueueLimit: 32
    jobRetentionMs: 900000
extensions:
  - trusted: true
    source: { ... }
    activation:
      kind: global
    manifest: { ... }
workspaces:
  - id: <workspace-id>
    displayName: Project
    root: <absolute-workspace-root>
    profile: read-only
    tools:
      allow: [read_file]
      deny: []
      explicit: []
    commands:
      allow: []
    stepUp: []
```

選填的 `worker.process` 是 Worker-wide 容量：同一 Worker 的所有 Workspace 共用，不是各自獨立配額。舊有版本 1 設定未填時自動帶入上述預設值。三種 concurrency 分別支援 1–8；`jobQueueLimit` 支援 0–256 筆等待任務，`jobRetentionMs` 支援 1–86,400,000 毫秒。Background async `run`／`shell` 與 `job_start` 共用額度；修改設定需重啟 Worker，並可用 `process_capacity` 核對生效結果。

CLI 可用 `queqiao worker process --worker my-worker --json` 讀取實際生效的預設或自訂值；以 `--foreground-concurrency`、`--background-concurrency`、`--session-concurrency`、`--job-queue-limit`、`--job-retention-ms` 修改指定欄位（其餘維持原值），或用 `--defaults` 全部恢復預設。設定原子寫入；變更後需執行 `queqiao worker restart --worker my-worker` 才會套用。

`queqiao workstation`：選取 **Workers → Configure**，即可編輯相同五項欄位；舊設定未配置時會顯示 schema 預設值。儲存不會默默重啟運行中的 Worker。

`queqiao update` 更新的是**啟動該 CLI 的 npm 安裝位置**，不會錯用另一個 `npm config get prefix`（例如 WSL `~/.local/bin` 優先於 `/usr/local`）。會回報更新前後的實際安裝版號；外部管理、釘選版本的 systemd 服務仍須依其部署流程單獨更新，不會被覆寫。

### Workspace persistence

**目前 Queqiao 沒有另外維護 production `workspaces.json`。** Workspace 直接存在 owning Worker `config.yaml` 的 `workspaces[]`。

每個 Workspace 自己持有 copied authority（`tools`、executable `commands`、optional `stepUp`）。Access Profile 是建立／更新 authority 時使用的 template，不是會在之後同步修改 Workspace 的 live pointer。

### Worker credential

`worker-<environment-id>.secret` 在 Worker setup 時建立。Enrollment 只有在 Gateway confirmation 成功後才 transactionally 替換 credential。

進行中或 recovery join 期間，同目錄可能短暫出現：

```text
<token>.join-provisional.json
<token>.join-<pid>-<timestamp>.tmp
<token>.prejoin-<timestamp>
```

這些是 transaction/recovery artifacts；join 進行中不要手動編輯或刪除。

## Host-level durable files

這些資料屬於單一 host 的 Queqiao installation，而不是某個 named Gateway／Worker。

### Access Profiles

```text
Windows: %LOCALAPPDATA%\Queqiao\data\access-profiles.json
Linux:   ${XDG_DATA_HOME:-~/.local/share}/queqiao/access-profiles.json
```

```json
{
  "version": 1,
  "profiles": [
    {
      "name": "Coding Safe",
      "tools": ["read_file", "write_file", "edit_file", "run"],
      "allowedExecutables": ["git", "npm"]
    }
  ]
}
```

### CLI setup history

```text
Windows: %LOCALAPPDATA%\Queqiao\data\setup-history.json
Linux:   ${XDG_DATA_HOME:-~/.local/share}/queqiao/setup-history.json
```

保存最近輸入過的 allowed executable history，數量有上限：

```json
{ "allowedExecutables": ["git,npm"] }
```

它只是 UX convenience，不是 authority source。

### Extension Hub

```text
Windows: %LOCALAPPDATA%\Queqiao\data\extensions\
Linux:   ${XDG_DATA_HOME:-~/.local/share}/queqiao/extensions/
```

```text
extensions/
  hub.json
  packages/
    <managed npm installation directories>/
```

`hub.json` 保存 installed Extension inventory/source/manifest。npm Extension 會被安裝到 `packages/`；local Extension 則保存 external source/module path reference。Worker attachment 另外存在各 Worker `config.yaml` 的 `extensions[]`。

## Workstation settings

Workstation appearance 是 host-level config，與 runtime authority 分離：

```text
Windows: %LOCALAPPDATA%\Queqiao\config\workstation.yaml
Linux:   ${XDG_CONFIG_HOME:-~/.config}/queqiao/workstation.yaml
```

```yaml
version: 1
appearance:
  colors:
    accent: cyan
    modal: magenta
    success: green
    warning: yellow
    danger: red
    muted: gray
```

實際值必須屬於 Workstation 支援的 palette；這份檔案只改 presentation。

## Operational state：PID 與 logs

Managed background lifecycle metadata 位於各 role state root：

```text
state/processes/gateway.pid.json
state/processes/worker.pid.json
```

PID record 包含 managed PID、entry point、config file 與 startedAt。Queqiao 會對照實際 process 後才判斷它仍是 managed runtime。

Linux background lifecycle 的 stdout/stderr 位於 `state/logs/<role>.out.log` 與 `<role>.err.log`。Logs／PID 是 operational history，通常可以重新建立，不可代替 config/data backup。

## Environment path overrides

可用以下變數替換 default layout：

| Variable | 意義 |
| --- | --- |
| `QUEQIAO_CONFIG_DIR` | Config root |
| `QUEQIAO_DATA_DIR` | Durable data root |
| `QUEQIAO_STATE_HOME` | Operational state root |
| `QUEQIAO_RUNTIME_DIR` | Ephemeral runtime root |
| `QUEQIAO_CONFIG_FILE` | Runtime entry point 使用的 exact config file |

Explicit layout override 開啟時，named-role discovery 會刻意停用，因為此時沒有唯一的 default named hierarchy 可掃描。

## Permissions

Queqiao 以 restrictive permissions 建立 private runtime/config/secret material。POSIX 使用 `0700`／`0600` 語意；Windows 會移除 inherited broad ACL，只保留 current user 與 `SYSTEM`，secure runtime path 的 ACL hardening 採 fail-closed。

不要為了跨 user 分享而放寬 permission；應使用不同 Queqiao identities/layouts。

## Backup / migration 建議

如果要在 reinstall／migration 後保留 host identity 與 topology：

1. Backup named Gateway／Worker 的 **config** directories。
2. Backup named Gateway／Worker 的 **data** directories，包含 secrets、Gateway membership 與 worker credentials。
3. Backup host-level `data/access-profiles.json` 與 `data/extensions/`；`setup-history.json` 可選。
4. 只有在 UI color assignment 需要保留時 backup `config/workstation.yaml`。
5. `state/` 只是 optional operational history；migration 後不要依賴原 PID metadata。
6. **不要** backup 或 restore runtime/temp root。

Queqiao data backup 含有 credentials，必須視為 credential-bearing backup：加密並限制存取。

跨 OS 或 filesystem location restore 後，啟動 Worker 前先檢查 absolute Workspace roots 與 local Extension source paths。應透過 Workstation／CLI 修正路徑，不要對 live YAML／JSON 做 mass search/replace。