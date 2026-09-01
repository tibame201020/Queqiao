# Workspace Detailed Info

[Detailed Info 索引](README.zh-TW.md) · [English](workspace.md)

![Workspace Detailed Info final frame](../../assets/workstation/details/03-workspace.png)

![Workspace Detailed Info tabs](../../assets/workstation/details/03-workspace.gif)

| Tab | 顯示內容 |
| --- | --- |
| **Info** | Workspace display name、id、owning Worker、absolute root |
| **Access** | persisted profile marker，以及 profile authority 為 copied-on-apply 的核心語意 |

Workspace 才是實際 Worker-owned authority boundary。Access Profile 變更不會 live-update Workspace；後續修改 source profile 不能暗中改變已持久化 Workspace。

Mutation 留在 Inspector：**Edit Workspace**、**Remove Workspace**。已設定 Worker 的最後一個 Workspace 不可移除。
