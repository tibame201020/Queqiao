# Workstation Controls

[English](controls.md) | **繁體中文** · [Workstation 索引](README.zh-TW.md)

以下每個 control 都有獨立 packaged Workstation 錄製。GIF 主要展示 navigation／inspection；逐欄位內容請見 [Detailed Info](details/README.zh-TW.md)。

## 1. Gateways

![Gateways control](../assets/workstation/controls/01-gateways.gif)

Gateway 是公開 control plane。Inventory／Inspector 顯示 lifecycle、public endpoint、service／management ports、health 與 enrolled Worker 數量。Actions 包含 **Start/Stop**、**Configure**、**Copy MCP URL**、**Copy approval secret**、**Manage Workers**、**Create join code**、**Remove Gateway**。Workstation 先檢查 precondition，例如 join-code creation 要求 Gateway running，Remove 則要求先停止。

## 2. Workers

![Workers control](../assets/workstation/controls/02-workers.gif)

Worker 代表一個 native execution environment。Actions 包含 **Start/Stop**、**Configure**、**Add Workspace**、**Join Gateway**、**Remove Worker**。Setup 會一起建立第一個 Workspace；enrollment 從 Worker 端進行，且 Worker runtime 必須先 active。

## 3. Workspaces

![Workspaces control](../assets/workstation/controls/03-workspaces.gif)

Workspace 是 Worker-owned filesystem authority boundary。**Edit Workspace** 修改 identity／copied access policy；**Remove Workspace** 移除該 authorized root。完全相同 root 會拒絕，但 nested roots 仍有效，讓較窄 scope 可以擁有不同 authority。已設定 Worker 至少要保留一個 Workspace。

## 4. Access Profiles

![Access Profiles control](../assets/workstation/controls/04-access-profiles.gif)

Access Profile 是可重用 Tool／command template。Built-in Reader／Editor immutable；custom profile 可 create、edit、rename、delete。Profile 套用時把 authority 複製到 Workspace，之後修改 profile 不會暗中改寫既有 Workspace。

## 5. Extensions

![Extensions control](../assets/workstation/controls/05-extensions.gif)

Extension 先安裝到 host-level Extension Hub，再明確 attach／detach 到各 Worker。Installation 與 attachment 維持分離，因此只安裝 package 不會擴大 Worker／Workspace authority。Uninstall 會遵守 attachment constraints，必要時走 destructive confirmation。

## 6. Diagnostics

![Diagnostics control](../assets/workstation/controls/06-diagnostics.gif)

Diagnostics 使用 Queqiao authoritative health checks，不建立 Workstation-only model。範圍包括 local runtimes、Gateway routing／enrolled Workers、Extension Hub integrity 與 remediation warnings。**Run diagnostics** 是 immediate action，完成後顯示 structured result。

## 7. Settings / Appearance

![Appearance control](../assets/workstation/controls/07-settings-appearance.gif)

任何 domain 都可按 `,` 開 Settings。Appearance 透過 color picker 編輯六個 semantic roles：**Select/Focus**、**Active/Success**、**Warning**、**Danger/Error**、**Modal**、**Muted**。Save 只改 presentation，不影響 runtime authority／configuration。

Persistence 與 picker 行為請見 [Appearance](appearance.zh-TW.md)。
