# Worker Detailed Info

[Detailed Info 索引](README.zh-TW.md) · [English](worker.md)

![Worker Detailed Info final frame](../../assets/workstation/details/02-worker.png)

![Worker Detailed Info tabs](../../assets/workstation/details/02-worker.gif)

| Tab | 顯示內容 |
| --- | --- |
| **Status** | runtime active／managed、可用時的 PID、health／reachability、HTTP status、identity match，以及相關 probe error |
| **Info** | Worker name、lifecycle、managed state、native endpoint、Gateway transport，以及 remote enrollment 的 durable reverse-session target |
| **Workspaces** | 每個 authorized Workspace 的 display name、id、root、persisted profile marker |
| **Extensions** | attach 到此 Worker 的 Extension display name、id、version |
| **Gateways** | persisted／known Gateway relationships，以及可用時的 endpoint |

Cross-OS ownership 保持明確：Workstation 只呈現 local persisted state 能證明的關係，不推測不存在的 upstream Gateway relationship。

Mutation 留在 Worker Inspector：Start/Stop、Configure、Add Workspace、Join Gateway、Remove Worker。
