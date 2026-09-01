# Diagnostics Detailed Info

[Detailed Info 索引](README.zh-TW.md) · [English](diagnostics.md)

![Diagnostics Detailed Info final frame](../../assets/workstation/details/06-diagnostics.png)

![Diagnostics Detailed Info tabs](../../assets/workstation/details/06-diagnostics.gif)

| Tab | 顯示內容 |
| --- | --- |
| **Summary** | overall healthy／issue state，以及 Core checks、routes、warnings 數量 |
| **Core** | configured local Gateway／Worker runtime checks，包含 state、detail、remediation |
| **Routing** | Gateway-authoritative enrolled Worker reachability／routing checks |
| **Extensions** | Extension Hub health、Extension／Worker counts、integrity issues |
| **Warnings** | consolidated remediation warnings；healthy 時明確顯示 no warnings |

Diagnostics 直接 render authoritative `doctorQueqiao()` model，不維護第二套 Workstation-only health system。**Run diagnostics** 仍是 immediate Inspector action，完成後以同一組 underlying checks 更新此 view。
