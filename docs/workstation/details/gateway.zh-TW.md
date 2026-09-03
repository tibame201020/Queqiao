# Gateway Detailed Info

[Detailed Info 索引](README.zh-TW.md) · [English](gateway.md)

![Gateway Detailed Info final frame](../../assets/workstation/details/01-gateway.png)

![Gateway Detailed Info tabs](../../assets/workstation/details/01-gateway.gif)

| Tab | 顯示內容 |
| --- | --- |
| **Status** | runtime active／managed、可用時的 PID、health／reachability、HTTP status、identity match，以及相關 probe error |
| **Info** | Gateway name、lifecycle、managed state、public URL、service/local management ports、Worker transport mode，以及設定 remote 時的 Worker-session target |
| **Workers** | Gateway-authoritative enrolled Worker membership：environment id、Worker id、transport endpoint |

Gateway 主動停止時會顯示 **stopped**，不會誤標成 generic unreachable failure。Worker membership detail 只針對目前選取 Gateway lazy load，不會每次 periodic inventory refresh 都重新讀取。

Mutation 留在 Gateway Inspector：Start/Stop、Configure、Copy MCP URL、Copy approval secret、Manage Workers、Create join code、Remove Gateway。

## ChatGPT connector handoff

Gateway Inspector 中，`c` 會複製 MCP URL，`p` 會複製 approval secret。兩個 action 都只回報 clipboard side effect；Workstation result 不會顯示 approval secret。建立 ChatGPT 自訂 app/connector 時使用 MCP URL 與 OAuth，approval secret 只提供給 Queqiao 自己的 OAuth approval 頁。
