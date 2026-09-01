# Queqiao CLI Reference

This page is the command reference for the production `queqiao` CLI. The root README keeps
the first-deployment workflow short; this page carries the full command surface and scripting
rules.

## Global commands and options

```text
queqiao version
queqiao --version
queqiao -v
```

`--json` selects machine-readable output where a command supports it. `version --json` and
`--version --json` return `{ "schemaVersion": "1.0", "version": "..." }`.

## Shell completion

```text
queqiao completion bash
queqiao completion zsh
queqiao completion powershell
```

Each command prints a native shell adapter generated from `CLI_LEAF_CONTRACTS`, so the
completion hierarchy and flags are validated against the same canonical parser contract as the
CLI. Typical profile setup:

```powershell
queqiao completion powershell | Out-String | Invoke-Expression
```

```bash
eval "$(queqiao completion bash)"
```

```zsh
eval "$(queqiao completion zsh)"
```

Completion provides the canonical command and flag hierarchy. Value completion for runtime entities
such as `--gateway`, `--worker`, Workspace ids, and Extension ids is intentionally not queried from
the runtime by the completion adapter.

## Workstation

```text
queqiao workstation
```

`workstation` requires an interactive terminal. Its persistent Ink alternate-screen UI groups
product domains by ownership: **Runtime** (Gateways, Workers), **Authority** (Workspaces, Access
Profiles), **Capabilities** (Extensions), and **System** (Diagnostics). Wide terminals use Control +
Inventory + Inspector windows; standard terminals collapse Control into the Inventory header; narrow
terminals show one primary Inventory or Inspector window at a time. Below the supported terminal floor
(60 columns or 18 rows), Workstation renders an intentional resize message instead of clipped panels.
Use `←`/`→` for non-wrapping spatial pane navigation and `Tab` / `Shift+Tab` for logical window cycling. Within Control or Inventory, `↑`/`↓` or `j`/`k` moves the focused list; `Enter` / `→` enters the pane to the right. Inspector is a single operational layer: compact resource information and selectable Actions stay visible together, `↑`/`↓` selects an action, and `Enter` runs the selected action. Resource shortcuts remain directly executable. `[i]` opens tabbed Detailed Info, `?` opens keyboard Help, and `,` opens Appearance Settings. Use `1`-`6` to jump domains, `n` for context-appropriate creation/setup, `r` to refresh, and `q` to exit. Selection is preserved per domain across focus changes and refreshes.

Runtime lifecycle, Gateway membership, setup and removal, Worker enrollment, Workspace add/edit/remove,
Access Profile CRUD, Extension install/attach/detach/uninstall, confirmations, and diagnostics all stay
inside the same Ink alternate screen. The Workstation root always fills the complete terminal viewport;
responsive breakpoints change the pane arrangement rather than allowing the UI height to collapse to its
content. At a fixed terminal size, runtime data cannot resize the panes: Wide keeps Control at 22 columns
and Inventory at 36 columns, Standard keeps Inventory at 34 columns, and the Inspector consumes the
remainder. Inventory metadata and Inspector field labels use stable columns; long names, URLs, paths,
endpoints, and package identifiers truncate inside their cells instead of flex-shrinking neighboring panes
or wrapping into extra layout rows. Standard and low-height layouts keep the Inspector action list directly operable inside a bounded viewport;
selection scrolls with the list instead of introducing a second action menu. Footer hints are width-fitted to one row so
context changes do not resize the main workspace. Form input is provided by the Workstation prompt layer,
while the actual mutations still call the same setup, enrollment, Workspace, Access Profile, Extension,
and lifecycle application functions used by the leaf CLI. The TUI therefore does not define a second
setup or domain contract.

Inspector itself is the stable compact home for the selected entity. `[i]` opens a root-level Detailed Info modal with contextual tabs for deeper status, identity, relationship, authority, and diagnostics views. Actions execute through a root-level
transaction modal layered above the persistent panes; the modal is opaque, owns input, and leaves the
originating Control / Inventory / Inspector context mounted around it. Action flow is semantic: Start,
Stop, Copy, Diagnostics, and other low-risk immediate actions run directly into `Working → Result` without
a redundant review step; configure/edit/join/install operations enter their actual form; destructive
remove/delete/uninstall operations keep explicit target/effect confirmation with default No. Results
distinguish success, no-op, warning, cancellation, and error, and may show structured details, clipboard
side effects, and remediation. Unavailable operations show their prerequisite before execution. Action forms use one page-level modal shell rather than nesting the former prompt panel: the modal fixes Action, Target, and Purpose context, while only the current choose/multi/text/secret/confirm control changes between sequential steps. Long selector bodies scroll independently; short terminal heights retain Action + Target and drop secondary Purpose/help copy before compromising the control. Long
results scroll with arrow/PageUp/PageDown/Home/End, and `Esc`, `i`, or result `Enter` returns to the compact Inspector.
Clipboard-copy results state whether copying succeeded; if join-code clipboard copy fails, the fallback
`qjq1:` code remains visible in the result instead of being discarded.

The Inspector uses a two-tier data model. Cheap inventory state refreshes periodically, while runtime
health and enrollment relationships are loaded only for the selected Gateway or Worker and are refreshed
on selection changes, explicit refresh, or related actions. Background polling is silent: unchanged
snapshots do not commit a new frame, and changed snapshots replace the previous stable inventory without a
`Working…` or blank-state pulse. Same-entity Inspector detail stays visible while a refresh completes. Long
Inventory, Inspector action, Detailed Info, choose, and multi-select content is clipped to measured viewports;
selection auto-scrolls to remain visible, Inspector content scrolls with arrow/PageUp/PageDown/Home/End, and
scroll offsets clamp after resize/content changes. Refresh failures retain last-good data and surface an
explicit warning instead of blanking the TUI. If a form is active when the terminal becomes too small, the
form pauses, hidden input is ignored, and resizing back restores the prompt state.
Gateway membership remains Gateway-owned and is read through the running Gateway management API; a stopped
Gateway therefore shows membership as unavailable instead of reading Gateway-internal persistence directly.
Worker-to-Gateway relationships are matched only by `workerId` plus `environmentId`, never inferred from
display names. Workstation inventory is intentionally host-local: a Windows host lists its configured Windows roles, while a WSL/Linux host lists its own configured roles. A Gateway host can still inspect enrolled Workers from other operating systems through Gateway-owned membership and `/health` data, so the Gateway-side Workstation/Doctor is the authoritative cross-host routing view. A Worker-only host Doctor validates that host's Worker runtime and Extension Hub, but it does not currently prove reachability of a remote upstream Gateway; likewise, Worker Detailed Info does not invent a remote Gateway relationship when enrollment did not persist an authoritative upstream reference. Stale role directories without a runtime config are ignored by discovery and do not make Doctor unhealthy.
Diagnostics uses the existing `doctorQueqiao()` application API as its single authoritative
health query. The Inspector renders structured Core, Routing, Extension Hub, and Warnings sections; it does
not run a second Extension Hub doctor query. Before the first Diagnostics query, System health is marked
`not checked`. After a check, the Control/Inventory indicator and global status line retain the actual
healthy or warning count until Diagnostics is refreshed again. Periodic inventory polling does not run
Diagnostics. An intentionally stopped Gateway or Worker is presented as neutral lifecycle state (`○ stopped`), while active-but-unreachable runtimes retain warning/error semantics. Access Profile Inspector authority is enumerated item-by-item so tools and allowed executables are never hidden by middle truncation. Worker enrollment can use a configured local Gateway or a masked self-contained `qjq1:` join code for a remote Gateway; Gateway Inspector connector handoff can copy the MCP URL or approval secret through the same canonical application APIs used by `gateway info`, without rendering copied secret material.
Semantic color reinforces focus, health, warning, destructive/error, modal chrome, and muted state, but all of those states also retain textual glyphs or labels so the Workstation never relies on color alone. Appearance Settings edits those fixed semantic roles directly rather than switching theme presets: `Select / Focus`, `Active / Success`, `Warning`, `Danger / Error`, `Modal`, and `Muted`. `Enter` on a role opens a 24-color picker grid; arrow keys navigate the grid, `Enter` chooses a color, and `s` saves the complete semantic assignment. Changing a color never changes the role's runtime meaning.

For automation, scripts, and CI, continue to use the explicit leaf commands below.

### Isolated development verification

Use `npm run dev:workstation:verify` when manually validating Workstation from the repository. The verifier builds into a temporary `QUEQIAO_BUILD_OUTDIR`, overrides Queqiao runtime/home paths to a temporary directory, allocates random loopback ports, seeds disposable Gateway/Worker/Workspace/Access Profile/Extension state, and launches the packaged Workstation against that state. Exiting Workstation stops any verification runtimes and removes the temporary directory. It does not stop stable runtimes, rewrite the repository `dist`, or relink the global `queqiao` command. For non-TTY agents/CI, `npm run dev:workstation:verify -- --smoke` runs the same isolated harness through Vitest and captures responsive 140×35, 100×28, 70×24, and too-small frames.

The former `dev:shadow:refresh` helper is retired; do not replace its role names with `stable`, because its old stop/rebuild/restart lifecycle would intentionally interrupt the active stable runtime.

## Gateway

```text
queqiao gateway setup
queqiao gateway list
queqiao gateway serve [--gateway <gateway>] [--bg]
queqiao gateway stop [--gateway <gateway>]
queqiao gateway status [--gateway <gateway>]
queqiao gateway info [--gateway <gateway>] [--detail] [--copy-url|--copy-secret]
queqiao gateway remove [--gateway <gateway>]
queqiao gateway join-token [--gateway <gateway>] [--expires <seconds>] [--json]
queqiao gateway workers list [--gateway <gateway>]
queqiao gateway workers update [--gateway <gateway>] --worker-id <id> --endpoint <loopback-worker-url>
queqiao gateway workers remove [--gateway <gateway>] --worker-id <id>
```

`gateway info` is the connector handoff command. The default view shows the MCP URL and approval-secret availability without revealing the secret. `--detail` explicitly reveals the local approval secret and Gateway metadata; do not paste that output into logs or issues. `--copy-url` and `--copy-secret` copy exactly one value without echoing it.

## Worker and Workspace authority

```text
queqiao worker setup
queqiao worker list
queqiao worker port [--worker <worker>] [--port <port>]
queqiao worker serve [--worker <worker>] [--bg]
queqiao worker stop [--worker <worker>]
queqiao worker status [--worker <worker>]
queqiao worker remove [--worker <worker>]
queqiao worker join [--worker <worker>] [--join-code <code>]

queqiao workspace
queqiao workspace add [--worker <worker>] [--root <path>] [--display-name <name>] [--access-profile <name>]
queqiao workspace list [--worker <worker>]
queqiao workspace info [--worker <worker>] [--workspace <id>]
queqiao workspace edit [--worker <worker>] [--workspace <id>] [--root <path>] [--display-name <name>] [--access-profile <name>]
queqiao workspace remove [--worker <worker>] [--workspace <id>]

queqiao workspace profiles list
queqiao workspace profiles info [--profile <name>]
queqiao workspace profiles create [--name <name>] [--tools <csv>] [--commands <csv>]
queqiao workspace profiles edit [--profile <name>] [--tools <csv>] [--commands <csv>]
queqiao workspace profiles rename [--profile <name>] [--to <name>]
queqiao workspace profiles delete [--profile <name>] [--force]
```

Running `queqiao workspace` in a TTY opens Workspace Management. Choose **Workers** to
select a Worker and manage its authorized roots, or choose **Access profiles** to manage reusable
Tools ? executable-allowlist templates. `Reader` and `Editor` are built-in immutable profiles.

Access Profiles are templates, not live links. Applying one copies its policy into a Workspace.
Subsequent profile edit, rename, or delete operations report zero affected Workspaces and do not
mutate existing Workspace authority. `workspace edit --access-profile <name>` explicitly reapplies
a profile when that is desired.

Workspace ids remain implementation-managed. Interactive management identifies Workspaces by
display name and root; automation may pass the id returned by `workspace list` or `workspace info`.
Exact canonical duplicate roots are rejected while nested roots remain valid for narrower policies.
A configured Worker must retain at least one Workspace. See [Workspace authority](../workspace-authority.md).

## Extensions

```text
queqiao extension install <npm:package|local-path> [--worker <name>|--attach-all]
queqiao extension attach [<id>] [--worker <name>]
queqiao extension detach [<id>] [--worker <name>]
queqiao extension uninstall [<id>] [--force]
queqiao extension list
queqiao extension show [<id>]
```

TTY mode may select an installed Extension interactively when the optional `<id>` is omitted.
Automation should provide explicit identifiers. See [Extensions](../extensions.md).

## Diagnostics

```text
queqiao doctor
queqiao doctor extension
queqiao doctor manifest show [--gateway <name>]
queqiao doctor tool explain <tool> [--gateway <name>]
queqiao doctor paths
```

`doctor` scans named Gateways, Workers, and Extension Hub integrity. Manifest/tool composition
is Gateway-owned, so those diagnostics target a Gateway.

## Cleanup and migration

```text
queqiao uninstall
queqiao migrate from-repo --repo <path> [--execute]
queqiao migrate runtime-v1 [--execute]
```

Migration commands default to dry-run behavior where supported. Review the plan before using
`--execute`.

## Selector contract

Commands whose usage shows `[--gateway <gateway>]` or `[--worker <worker>]` follow one rule:

- zero configured instances: fail with setup guidance;
- one configured instance in a TTY: auto-select it;
- multiple configured instances in a TTY: open the shared selector;
- non-TTY or JSON automation: require an explicit selector when ambiguity exists.

Queqiao never silently targets a persisted `default` instance. Use `gateway list` or
`worker list` to discover valid names.

## Removed public forms

The old flat Workspace/Profile/Tool/Command routes and the old `--name` role selector are not
part of the production surface. The CLI reports the canonical replacement when it can do so
unambiguously. Repository/project discovery also does not live at the Core CLI root; it
belongs to clients or Extensions operating inside an already-authorized Workspace.

## Help

Every command group supports contextual help:

```shell
queqiao --help
queqiao gateway --help
queqiao workspace --help
queqiao extension --help
queqiao doctor --help
```
