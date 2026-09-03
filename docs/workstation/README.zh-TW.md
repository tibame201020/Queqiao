# Queqiao Workstation

[English](README.md) | **繁體中文**

Workstation 是 Queqiao 的 persistent interactive operator UI。它呼叫的仍是 leaf CLI 使用的 Gateway、Worker、Workspace、Access Profile、Extension 與 Diagnostics application functions；不是第二套 authority／configuration model。

```shell
queqiao workstation
```

本文件的錄製都使用 packaged Queqiao CLI，在 isolated PTY 與 disposable config/data/state/runtime roots 中執行，不讀取或操作開發者正在使用的 runtime／secrets。

## 文件索引

- **[Controls](controls.zh-TW.md)** — Gateways、Workers、Workspaces、Access Profiles、Extensions、Diagnostics、Settings/Appearance 各自都有獨立實機 GIF。
- **[Appearance](appearance.zh-TW.md)** — semantic color roles、picker 行為、persistence 與鍵盤操作。
- **[Detailed Info](details/README.zh-TW.md)** — 每個 domain 的 screenshot、tabs 操作 GIF 與欄位語意。
- **[Classic / leaf CLI](../cli/README.md)** — scripts、CI、JSON output、直接管理使用的 deterministic command surface。
- **[Configuration & Persistence](../configuration-persistence.zh-TW.md)** — Windows／Linux／WSL storage、secrets、state、backup 與 path overrides。

## Layout

| 寬度 | Layout | 行為 |
| --- | --- | --- |
| `>=120` | Wide | Control + Inventory + Inspector |
| `80–119` | Standard | Inventory + Inspector |
| `60–79` | Narrow | 一次一個 primary pane |
| `<60` 或 `<18` rows | Too small | 顯示 resize notice；active form 暫停 |

Pane 寬度由 terminal size決定，不會因目前內容改變。過長 path、URL、package id、名稱會在固定 cell truncate；長清單與 detail可捲動。

## Navigation

- `1..6` — Gateway、Worker、Workspace、Access Profile、Extension、Diagnostics。
- `←` / `→` — 空間式切 pane；`↑` / `↓` 選 row／action。
- `Tab` — 循環目前可見 pane；`Enter` — inspect／執行選定 action。
- `i` — Detailed Info；`?` — Help；`,` — Appearance Settings；`r` — refresh；沒有 modal擁有 input時可按 `q` 離開。
- Detailed Info／result可捲動時會提供 `PageUp`、`PageDown`、`Home`、`End`。

Color只作語意輔助，不是唯一狀態訊號；focus、success/healthy、warning、danger/error、muted/stopped同時有文字／glyph差異。

## Action model

Workstation 不會強迫每個 action 都先開 review dialog，而是按操作語意處理：

- **Immediate** — Start/Stop、Copy、Diagnostics、attach/detach 直接執行，再顯示 Working／Result。
- **Forms** — setup、configure、join、install、edit 只開必要的 input flow。
- **Destructive** — remove/delete/uninstall 要求明確 target/effect confirmation。
- **Unavailable** — precondition不成立時不呼叫 executor，直接顯示原因與 remediation。

Result會區分 success、no-op、warning、cancelled、error，clipboard write等 side effect也會明確呈現。

## Connector handoff

Gateway Inspector 可以完成本機到 ChatGPT 的 connector handoff，而且不會在 Workstation 畫面顯示已複製的值：

1. 按 `c` 執行 **Copy MCP URL**；
2. 按 `p` 執行 **Copy approval secret**；
3. 在 ChatGPT 建立自訂 app/connector，使用已複製的 MCP URL 與 OAuth；
4. approval secret 只貼到 Queqiao 自己的 OAuth approval 頁。

隔離錄製器會把 OS clipboard 換成 sink，因此 connector credential 不會進入 GIF frame。完整錄製流程與 ChatGPT 表單截圖請看根 README 第 8-9 步。

## 重新錄製

Windows + x86_64 WSL：

```powershell
npm run docs:workstation
```

Recorder會 build staged package、安裝到 isolated WSL roots，以 disposable Gateway／Worker state操作真實 Workstation PTY，並輸出只播放一次、停在最後有意義畫面的 GIF。
