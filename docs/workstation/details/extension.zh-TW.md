# Extension Detailed Info

[Detailed Info 索引](README.zh-TW.md) · [English](extension.md)

![Extension Detailed Info final frame](../../assets/workstation/details/05-extension.png)

![Extension Detailed Info tabs](../../assets/workstation/details/05-extension.gif)

| Tab | 顯示內容 |
| --- | --- |
| **Info** | Extension display name、id、version、package/source identity |
| **Workers** | 所有 Worker attachment record，明確標示 attached／not attached |

Installation 與 Worker attachment 是分離操作。Extension 已安裝不代表每個 Worker 自動 active；attachment 也不會取代 Workspace authority checks。

Attach／Detach 留在 Inspector；Uninstall 走支援的 attachment／destructive flow，不塞進 Detailed Info。
