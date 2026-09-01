# Workstation Appearance

**English** | [繁體中文](appearance.zh-TW.md) · [Workstation index](README.md)

Press `,` from Workstation to open Settings. Appearance is presentation-only: it never changes Gateway/Worker configuration, Workspace authority, Access Profiles, or Extension attachment.

![Appearance color picker](../assets/workstation/controls/07-settings-appearance.gif)

## Semantic roles

| Role | Used for |
| --- | --- |
| **Select / Focus** | focused pane, selected row, active input, primary interaction |
| **Active / Success** | running/healthy state and successful outcomes |
| **Warning** | degraded state, recoverable issues, remediation emphasis |
| **Danger / Error** | errors and destructive emphasis |
| **Modal** | modal chrome / overlay identity |
| **Muted** | stopped, inactive, secondary and disabled information |

Color is never the only state indicator; text, glyphs, selection marks, and disabled explanations remain visible independently of palette choice.

## Keyboard flow

1. Press `,` to open Settings.
2. Use `↑` / `↓` (or `j` / `k`) to select a semantic role.
3. Press `Enter` to open its color picker.
4. Use arrow keys (or `h/j/k/l`) to move through the palette; `Enter` chooses a color and `Esc` returns.
5. Press `s` to save all edited roles, or `Esc` to cancel Settings.

## Persistence

Saved colors are host-level Workstation config:

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

Only supported palette values are persisted. See [Configuration & persistence](../configuration-persistence.md) for the full storage model.
