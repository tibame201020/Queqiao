# Queqiao Workstation

**English** | [繁體中文](README.zh-TW.md)

Workstation is Queqiao's persistent interactive operator UI. It calls the same Gateway, Worker, Workspace, Access Profile, Extension, and Diagnostics application functions as the leaf CLI; it is not a second authority/configuration model.

```shell
queqiao workstation
```

The recordings are produced from a packaged Queqiao CLI inside an isolated PTY with disposable config/data/state/runtime roots. They do not use a developer's live runtime or secrets.

## Guides

- **[Controls](controls.md)** — one real GIF for every control: Gateways, Workers, Workspaces, Access Profiles, Extensions, Diagnostics, and Settings/Appearance.
- **[Appearance](appearance.md)** — semantic color roles, picker behavior, persistence, and keyboard flow.
- **[Detailed Info](details/README.md)** — per-domain screenshots, tab walkthrough GIFs, and field semantics.
- **[Classic / leaf CLI](../cli/README.md)** — deterministic command surface for scripts, CI, JSON output, and direct administration.
- **[Configuration & persistence](../configuration-persistence.md)** — exact Windows/Linux/WSL storage, secrets, state, backups, and path overrides.

## Layout

| Width | Layout | Behavior |
| --- | --- | --- |
| `>=120` | Wide | Control + Inventory + Inspector |
| `80–119` | Standard | Inventory + Inspector |
| `60–79` | Narrow | one primary pane at a time |
| `<60` or `<18` rows | Too small | resize notice; active forms are paused |

Pane widths are derived from terminal size, not current content. Long paths, URLs, package ids, and names truncate inside stable cells; long lists/details scroll.

## Navigation

- `1..6` — Gateway, Worker, Workspace, Access Profile, Extension, Diagnostics.
- `←` / `→` — move spatially between panes; `↑` / `↓` select rows/actions.
- `Tab` — cycle visible panes; `Enter` — inspect/run the selected action.
- `i` — Detailed Info; `?` — Help; `,` — Appearance Settings; `r` — refresh; `q` — exit when no modal owns input.
- Detailed Info/result views expose `PageUp`, `PageDown`, `Home`, and `End` when scrolling is available.

Color is semantic but never the only state signal: glyphs/text also distinguish focus, success/healthy, warning, danger/error, and muted/stopped states.

## Action model

Workstation does not add a review dialog to every action. Behavior follows operation semantics:

- **Immediate** — Start/Stop, Copy, Diagnostics, attach/detach execute directly and show Working/Result feedback.
- **Forms** — setup, configure, join, install, and edits open only the required input flow.
- **Destructive** — remove/delete/uninstall require explicit target/effect confirmation.
- **Unavailable** — unmet preconditions do not call the executor; Workstation explains the reason and remediation.

Results distinguish success, no-op, warning, cancelled, and error states, including side effects such as clipboard writes.

## Re-recording

From Windows with x86_64 WSL available:

```powershell
npm run docs:workstation
```

The recorder builds a staged package, installs it into isolated WSL roots, drives the real Workstation through a PTY, uses only disposable Gateway/Worker state, and renders one-shot GIFs that stop on their final meaningful frame.
