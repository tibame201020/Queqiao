# Workstation Appearance

[English](appearance.md) | **繁體中文** · [Workstation 索引](README.zh-TW.md)

在 Workstation 按 `,` 開 Settings。Appearance 只影響 presentation，不會修改 Gateway／Worker configuration、Workspace authority、Access Profiles 或 Extension attachment。

![Appearance color picker](../assets/workstation/controls/07-settings-appearance.gif)

## Semantic roles

| Role | 用途 |
| --- | --- |
| **Select / Focus** | focused pane、selected row、active input、primary interaction |
| **Active / Success** | running／healthy state 與成功 outcome |
| **Warning** | degraded state、可恢復問題、remediation emphasis |
| **Danger / Error** | error 與 destructive emphasis |
| **Modal** | modal chrome／overlay identity |
| **Muted** | stopped、inactive、secondary、disabled information |

Color 不是唯一狀態訊號；palette 怎麼調整，文字、glyph、selection mark、disabled explanation 都仍會保留。

## 鍵盤操作

1. 按 `,` 開 Settings。
2. 用 `↑` / `↓`（或 `j` / `k`）選 semantic role。
3. `Enter` 開該 role 的 color picker。
4. 用方向鍵（或 `h/j/k/l`）移動 palette；`Enter` 選色，`Esc` 返回。
5. 按 `s` 儲存所有變更，或 `Esc` 取消 Settings。

## Persistence

儲存後是 host-level Workstation config：

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

只會保存 Workstation 支援的 palette values。完整 storage model 請見 [Configuration & Persistence](../configuration-persistence.zh-TW.md)。
