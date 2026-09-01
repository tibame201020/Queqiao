# Queqiao Workstation

**English** | [繁體中文](README.zh-TW.md)

Workstation is Queqiao's persistent interactive operator UI. It composes the same Gateway, Worker, Workspace, Access Profile, Extension, and Diagnostics application functions used by the leaf CLI; it is not a second configuration or authority model.

```shell
queqiao workstation
```

![Workstation overview](../assets/workstation/01-overview.gif)

The recordings in this guide are produced from a packaged Queqiao CLI inside an isolated PTY with disposable config/data/state/runtime roots. They do not use a developer's live Queqiao runtime or secrets.

## Layout

Workstation adapts to terminal width without allowing content to resize panes at a fixed viewport:

| Width | Layout | Behavior |
| --- | --- | --- |
| `>=120` | Wide | Control + Inventory + Inspector |
| `80–119` | Standard | Inventory + Inspector |
| `60–79` | Narrow | One primary pane at a time |
| `<60` or `<18` rows | Too small | Full-screen resize notice; active forms are paused |

Long paths, URLs, package ids, and names truncate inside stable cells. Inventory, action lists, Detailed Info, and form selectors scroll when their content exceeds the visible viewport.

## Navigation contract

- `1..6` — Gateway, Worker, Workspace, Access Profile, Extension, Diagnostics.
- `←` / `→` — move spatially between panes; no wrapping. Narrow mode uses the same direction to enter/return from Inspector.
- `↑` / `↓` — select rows/actions. `PageUp`, `PageDown`, `Home`, and `End` scroll long Detailed Info/results where shown.
- `Tab` — cycle focus between visible panes.
- `Enter` — inspect the selected entity or execute the selected Inspector action.
- `i` — open contextual Detailed Info. `i` or `Esc` closes it.
- `?` — Help.
- `,` — Appearance Settings.
- `r` — manual refresh when available.
- `q` — exit when no modal/form owns input.

Color is semantic but never the only signal: focus, healthy/success, warning, danger/error, and muted states also use text/glyphs.

## Gateway control

![Gateway control](../assets/workstation/02-gateway.gif)

Gateway is the public control plane. Its Inspector shows lifecycle state, public URL, service/management ports, health, and enrolled Worker count. Actions include setup/configure, Start/Stop, Copy MCP URL, Copy approval secret, Create join code, membership management, and removal.

Workstation evaluates action preconditions before executing them. For example, removing a running managed Gateway is unavailable until it is stopped. Creating a join code requires a reachable Gateway; unavailable actions explain the remediation instead of returning only a generic failure.

Clipboard actions explicitly report whether a value was copied. If join-code clipboard access fails, the result modal preserves the short-lived code for manual copy rather than discarding it.

## Worker control

![Worker control](../assets/workstation/03-worker.gif)

Worker represents one native execution environment. The Inspector exposes identity, port, lifecycle/health, Workspace count, and attached Extensions. Setup creates the Worker and its first authorized Workspace as one transaction.

Enrollment is Worker-side: start the Worker, obtain a short-lived join code from the target Gateway, then run **Join Gateway**. Secret entry is masked. The Workstation result confirms the Worker/Gateway relationship without rendering the enrollment credential.

## Workspace control

![Workspace control](../assets/workstation/04-workspace.gif)

A Workspace is a Worker-owned authority boundary. Its persisted policy contains:

- root path and display name;
- allowed Tools;
- allowed executable commands when `run` is permitted;
- step-up rules when configured.

Exact duplicate roots are rejected; nested roots remain valid because a broader root and a narrower root can intentionally carry different authority. A configured Worker must retain at least one Workspace, so removing the last Workspace is blocked.

Workspace authority is stored in the owning Worker's `config.yaml`; current Queqiao does not use a second production `workspaces.json` file.

## Access Profile control

![Access Profile control](../assets/workstation/05-access-profile.gif)

Access Profiles are reusable Tool/command templates. Built-in profiles such as Reader/Editor are presented alongside saved custom profiles.

Applying a profile copies its authority into the Workspace at that moment. The Workspace remains independently persisted: editing, renaming, or deleting the source profile does not silently rewrite existing Workspaces.

## Extension control

![Extension control](../assets/workstation/06-extension.gif)

Extension packages are installed into the host-level Extension Hub, then explicitly attached to Workers. Workstation keeps these operations separate so package installation cannot silently broaden a Worker or Workspace.

- **Install** — add a local or npm package to the Hub.
- **Attach / Detach** — update a specific Worker's `extensions[]` configuration.
- **Uninstall** — remove the Hub entry/package only after attachment constraints are satisfied (or an explicit supported force flow is used).

See [Extensions](../extensions.md) and [Configuration & persistence](../configuration-persistence.md) for package storage and attachment persistence.

## Diagnostics control

![Diagnostics control](../assets/workstation/07-diagnostics.gif)

Diagnostics renders the authoritative `doctorQueqiao()` result rather than maintaining a Workstation-only health model. Detailed Info separates:

- **Summary** — aggregate issue count;
- **Core** — local Gateway/Worker lifecycle health;
- **Routing** — Gateway-authoritative enrolled Worker reachability;
- **Extensions** — Extension Hub integrity;
- **Warnings** — remediation-oriented issue list.

Cross-OS behavior remains ownership-based: each host inventories its locally configured roles. A Gateway host additionally reports its persisted enrolled Worker topology. A Worker-only host does not invent an upstream Gateway relationship that has not been persisted locally.

## Inspector, Detailed Info, and actions

The base Inspector stays compact: status/identity plus selectable actions. `i` opens Detailed Info as a root-level modal over the still-mounted panes. The background remains visible as context, but the modal owns input.

Action behavior is classified by semantics rather than forcing every action through the same review page:

- **Immediate** — Start, Stop, Copy, Diagnostics, attach/detach and similar low-friction operations execute immediately and show Working/Result feedback.
- **Forms** — setup, configure, join, install, and edits open the required input flow directly.
- **Destructive** — remove/delete/uninstall use an explicit target/effect confirmation.
- **Unavailable** — unmet preconditions do not call the executor; the result explains why and what to do next.

Results distinguish success, no-op, warning, cancelled, and error states. Side effects such as clipboard writes are rendered explicitly.

## Appearance

Press `,` to edit the six semantic color roles: Select/Focus, Active/Success, Warning, Danger/Error, Modal, and Muted. Workstation stores the selection in the host-level `workstation.yaml`; this affects presentation only and never changes runtime authority.

See [Configuration & persistence](../configuration-persistence.md) for the exact path and schema.

## Classic CLI

Workstation is the preferred interactive operator surface. The explicit leaf CLI remains the deterministic automation interface for scripts, CI, JSON output, and direct administration. See the [Classic / leaf CLI guide](../cli/README.md) and [CLI reference](../cli/reference.md).

## Re-recording these GIFs

From Windows with x86_64 WSL available:

```powershell
npm run docs:workstation
```

The recorder builds a staged package, installs it into isolated WSL roots, creates disposable Gateway/Worker/Workspace/Profile/Extension state, drives the real Workstation in a PTY, and renders the cast with a pinned/checksummed `agg` binary.