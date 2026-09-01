# Queqiao Workstation

[English](README.md) | **繁體中文**

Workstation 是 Queqiao 的 persistent interactive operator UI。它組合的仍是 leaf CLI 使用的 Gateway、Worker、Workspace、Access Profile、Extension 與 Diagnostics application functions；不是第二套設定或 authority model。

```shell
queqiao workstation
```

![Workstation overview](../assets/workstation/01-overview.gif)

本頁 GIF 都由 packaged Queqiao CLI 在 isolated PTY 中錄製，使用 disposable config/data/state/runtime roots；不會讀取或操作開發者正在使用的 Queqiao runtime 與 secrets。

## Layout

Workstation 依 terminal 寬度調整 layout，但固定 viewport 下不允許內容改變 pane 寬度：

| 寬度 | Layout | 行為 |
| --- | --- | --- |
| `>=120` | Wide | Control + Inventory + Inspector |
| `80–119` | Standard | Inventory + Inspector |
| `60–79` | Narrow | 一次顯示一個 primary pane |
| `<60` 或 `<18` rows | Too small | 顯示 resize 畫面；active form 暫停輸入 |

過長 path、URL、package id、名稱會在穩定欄位內 truncate。Inventory、action list、Detailed Info 與 form selector 超過可視高度時會捲動。

## Navigation contract

- `1..6` — Gateway、Worker、Workspace、Access Profile、Extension、Diagnostics。
- `←` / `→` — 空間式移動 pane，不 wrap；Narrow 同樣用方向鍵進入／離開 Inspector。
- `↑` / `↓` — 選 row／action；長 Detailed Info／result 依畫面提示支援 `PageUp`、`PageDown`、`Home`、`End`。
- `Tab` — 在目前可見 pane 間循環 focus。
- `Enter` — inspect entity 或執行目前選取的 Inspector action。
- `i` — 開 contextual Detailed Info；`i`／`Esc` 關閉。
- `?` — Help。
- `,` — Appearance Settings。
- `r` — 可用時手動 refresh。
- `q` — 當 modal／form 沒有取得 input ownership 時離開。

Color 只作語意輔助，不是唯一訊號；focus、healthy/success、warning、danger/error、muted 都同時有文字／glyph 差異。

## Gateway control

![Gateway control](../assets/workstation/02-gateway.gif)

Gateway 是 public control plane。Inspector 顯示 lifecycle、public URL、service／management ports、health 與 enrolled Worker 數量。Actions 包含 setup/configure、Start/Stop、Copy MCP URL、Copy approval secret、Create join code、membership management 與 remove。

Workstation 會在執行前判斷 precondition。例如 managed Gateway 還在執行時不可 Remove；Create join code 需要可達的 Gateway。不可執行的 action 會直接解釋原因與 remediation，不會只顯示 generic failure。

Clipboard action 會明確回報是否成功複製。若 join-code clipboard 失敗，result modal 仍保留短效 code 供手動複製，不會把它丟掉。

## Worker control

![Worker control](../assets/workstation/03-worker.gif)

Worker 代表一個 native execution environment。Inspector 顯示 identity、port、lifecycle／health、Workspace 數量與 attached Extensions。Setup 會在同一 transaction 建立 Worker 與第一個 authorized Workspace。

Enrollment 從 Worker 端進行：先啟動 Worker，從目標 Gateway 取得短效 join code，再執行 **Join Gateway**。Secret input 會 mask；結果只確認 Worker／Gateway 關係，不渲染 enrollment credential。

## Workspace control

![Workspace control](../assets/workstation/04-workspace.gif)

Workspace 是 Worker-owned authority boundary，持久化 policy 包含：

- root path 與 display name；
- allowed Tools；
- `run` 被允許時的 executable commands；
- 有設定時的 step-up rules。

完全相同 root 會拒絕；nested roots 仍有效，因為較廣與較窄 scope 可以刻意配置不同 authority。已設定 Worker 必須至少保留一個 Workspace，所以 last Workspace removal 會被阻擋。

Workspace authority 直接存於 owning Worker 的 `config.yaml`；目前正式 Queqiao 不使用第二份 production `workspaces.json`。

## Access Profile control

![Access Profile control](../assets/workstation/05-access-profile.gif)

Access Profile 是可重用的 Tool／command template。Workstation 會同時呈現 Reader／Editor 等 built-in profiles 與 saved custom profiles。

套用 profile 時只在當下把 authority 複製到 Workspace。Workspace 之後獨立持久化；edit、rename、delete 原 profile 都不會暗中改寫既有 Workspaces。

## Extension control

![Extension control](../assets/workstation/06-extension.gif)

Extension package 先安裝到 host-level Extension Hub，再明確 attach 到 Worker。Workstation 把兩件事分開，避免 package installation 自動擴大 Worker／Workspace authority。

- **Install** — 把 local 或 npm package 加入 Hub。
- **Attach / Detach** — 更新特定 Worker `extensions[]`。
- **Uninstall** — attachment constraint 滿足後才移除 Hub entry／package；或使用明確支援的 force flow。

Package storage 與 attachment persistence 請見 [Extensions](../extensions.md) 與 [Configuration & Persistence](../configuration-persistence.zh-TW.md)。

## Diagnostics control

![Diagnostics control](../assets/workstation/07-diagnostics.gif)

Diagnostics 直接 render authoritative `doctorQueqiao()` 結果，不維護 Workstation-only health model。Detailed Info 分為：

- **Summary** — aggregate issue count；
- **Core** — local Gateway／Worker lifecycle health；
- **Routing** — Gateway-authoritative enrolled Worker reachability；
- **Extensions** — Extension Hub integrity；
- **Warnings** — remediation-oriented issue list。

Cross-OS 行為依 ownership：每台 host inventory 自己設定的 roles；Gateway host 另外顯示它已持久化的 enrolled Worker topology。Worker-only host 不會推測不存在於本機 persistence 的 upstream Gateway relationship。

## Inspector、Detailed Info 與 actions

Base Inspector 保持 compact：status／identity 加 selectable actions。`i` 會在 root level 開 Detailed Info modal，底下 panes 仍 mounted 作為 context，但 input 完全由 modal 擁有。

Action 依語意分類，不強迫每個 action 都經過同一個 review page：

- **Immediate** — Start、Stop、Copy、Diagnostics、attach/detach 等直接執行，再顯示 Working／Result。
- **Forms** — setup、configure、join、install、edit 直接開必要 input flow。
- **Destructive** — remove/delete/uninstall 顯示明確 target/effect confirmation。
- **Unavailable** — precondition 不成立時不呼叫 executor，而是顯示原因與下一步。

Result 區分 success、no-op、warning、cancelled、error；clipboard write 等 side effect 會明確顯示。

## Appearance

按 `,` 編輯六個 semantic color roles：Select/Focus、Active/Success、Warning、Danger/Error、Modal、Muted。選擇會存在 host-level `workstation.yaml`；只改 presentation，不改 runtime authority。

實際路徑與 schema 請見 [Configuration & Persistence](../configuration-persistence.zh-TW.md)。

## Classic CLI

Workstation 是建議的 interactive operator surface；明確 leaf CLI 仍是 scripts、CI、JSON output 與 direct administration 的 deterministic automation interface。請見 [Classic / leaf CLI guide](../cli/README.md) 與 [CLI reference](../cli/reference.md)。

## 重新錄製 GIF

在具備 x86_64 WSL 的 Windows 主機執行：

```powershell
npm run docs:workstation
```

Recorder 會 build staged package、安裝到 isolated WSL roots、建立 disposable Gateway／Worker／Workspace／Profile／Extension state，以真實 PTY 操作 Workstation，再用 pinned 且 checksum 驗證過的 `agg` 產出 GIF。