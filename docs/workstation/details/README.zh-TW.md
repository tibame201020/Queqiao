# Workstation Detailed Info

[English](README.md) | **繁體中文** · [Workstation 索引](../README.zh-TW.md)

Inspector 擁有 focus 時按 `i`，Detailed Info 會以 root modal 開啟。底下 Control／Inventory／Inspector panes 仍 mounted 作為 context，但在 `i` 或 `Esc` 關閉前，input 由 modal 擁有。

用 `←` / `→` 切 tabs；需要捲動時使用 `↑` / `↓`、`PageUp`、`PageDown`、`Home`、`End`。

每個 domain 都有獨立頁面，包含 final-frame screenshot、實際 tab navigation GIF 與目前精確 tab contract：

- [Gateway](gateway.zh-TW.md) — Status / Info / Workers
- [Worker](worker.zh-TW.md) — Status / Info / Workspaces / Extensions / Gateways
- [Workspace](workspace.zh-TW.md) — Info / Access
- [Access Profile](access-profile.zh-TW.md) — Info / Tools / Commands
- [Extension](extension.zh-TW.md) — Info / Workers
- [Diagnostics](diagnostics.zh-TW.md) — Summary / Core / Routing / Extensions / Warnings

Detailed Info 以 read-oriented 為主；mutation 留在 Inspector actions／forms，避免 Detail modal 變成第二套管理 surface。
