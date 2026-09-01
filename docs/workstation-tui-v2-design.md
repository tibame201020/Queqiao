# Queqiao Workstation TUI v2 Design

Status: design baseline; Slices 1-3 plus Slice 4A navigation/interaction, Slice 4B viewport resilience, Slice 4C structured Diagnostics, and Slice 4D interactive completeness/presentation cleanup are implemented and production-validated. Release hardening remains.

## Product intent

`queqiao workstation` is a persistent operator control plane over the existing Queqiao application/domain operations. It is not a graphical copy of the leaf CLI and must not introduce a second management model.

The primary operator questions are:

1. Is the local Queqiao control plane healthy?
2. Which Gateways and Workers exist, and which are running?
3. How are Workers related to Workspaces and Extensions?
4. What authority does each Workspace receive, and from which Access Profile template?
5. What action is available for the currently selected object?
6. What changed after I executed an action?

The screen must answer those questions in that order.

## Design references

The interaction model is informed by Lazygit's persistent windows, context-specific keybindings, focus changes, and action-triggered model refresh. The implementation remains Queqiao-specific and uses Ink.

Relevant external references:

- Lazygit Codebase Guide: window/view/context/controller/action separation and refresh-after-action model.
- Lazygit keybindings: pane navigation, direct block jumps, contextual actions, option/help menu.
- TUI design skill guidance: visual hierarchy, focus management, responsive breakpoints, designed empty/loading/error states, clutter audit, and separation of domain/state/view logic.

## Information hierarchy

The previous six-peer menu is removed. Queqiao has four information levels.

### Level 0 — global control-plane state

Always visible and highest priority:

- Queqiao Workstation identity
- overall runtime state summary
- warning/degraded count when known
- refresh/busy state
- verification-environment marker when `dev:workstation:verify` is used

This level must never show secrets or local credential paths.

### Level 1 — product domains

Domains are grouped by product ownership rather than alphabetical menu order.

```text
RUNTIME
  Gateways
  Workers

AUTHORITY
  Workspaces
  Access Profiles

CAPABILITIES
  Extensions

SYSTEM
  Diagnostics
```

Diagnostics is cross-cutting system state. It is visually separated from managed resources instead of presented as a sixth peer resource.

### Level 2 — inventory

The selected domain owns an inventory list. Inventory rows answer only the most important comparison questions.

Gateway row:

```text
● stable                 :8075
```

Worker row:

```text
● wins-worker          2 ws
```

Workspace row:

```text
Queqiao          wins-worker
```

Access Profile row:

```text
◆ Reader                  2t
◇ coding-safe          3t 2x
```

Extension row:

```text
MCP 0.1.1             ● 1/2
```

Status, focus, selection, and object type must never depend on color alone.

### Level 3 — inspector

The Inspector is the dominant operational pane. It combines compact resource information with a directly selectable action list in one layer; there is no secondary action palette.

Reading order:

1. identity + lifecycle/health state
2. critical endpoint/configuration metadata
3. relationships to other Queqiao resources
4. contextual actions
5. last operation feedback when relevant

Example Worker inspector:

```text
wins-worker                                            ● RUNNING
Managed runtime                                       port 8076

Endpoint
  http://127.0.0.1:8076/

Relationships
  Workspaces   2
    Queqiao              coding-safe
    Sandbox              Reader

  Extensions   1 attached
    MCP                  0.1.1

Actions
  [s] Stop    [e] Configure    [g] Join Gateway    [d] Remove
```

Raw application JSON must not be the normal inspector presentation. Structured results belong in view models. Raw details may be exposed behind a dedicated details/debug action if useful.

### Level 4 — transient workflow

Forms, confirmations, action progress, and action results are transient transaction layers. They render as a root-level modal overlay above Control / Inventory / Inspector: the originating panes stay mounted and remain visible around the modal, while the modal itself is opaque and owns input. Transient workflow must never replace or destroy the selected domain/entity Info context.

Action flow is semantic rather than uniform: low-risk immediate actions such as Start, Stop, Copy, and Diagnostics execute directly into `Working → Result`; actions that need values open their real form immediately; destructive actions open the existing explicit target/effect confirmation. There is no generic `Enter continue` review step for every action.

After completion or cancellation, `[i]`, `Esc`, or result `Enter` returns to the originating object when it still exists. Long results use a measured scroll viewport so fallback join codes, side effects, warnings, and remediation cannot overlap or disappear on narrow terminals.

## Wide layout — >= 120 columns

Three persistent windows.

```text
┌ Queqiao Workstation ─────────────────────────────── ● 2/2 runtimes ─ 2s ┐
│                                                                          │
│ ┌ CONTROL ───────────┐ ┌ INVENTORY ──────────────┐ ┌ INSPECTOR ────────┐ │
│ │ RUNTIME            │ │ Workers             2  │ │ wins-worker       │ │
│ │   Gateways      1  │ │                      │ │ ● RUNNING          │ │
│ │ ▸ Workers       2  │ │ ▌ ● wins-worker  2ws │ │ managed · :8076   │ │
│ │                    │ │   ● wsl          1ws │ │                   │ │
│ │ AUTHORITY          │ │                      │ │ Workspaces        2│ │
│ │   Workspaces    3  │ │                      │ │ Extensions        1│ │
│ │   Profiles      4  │ │                      │ │                   │ │
│ │                    │ │                      │ │ Relationships ... │ │
│ │ CAPABILITIES       │ │                      │ │                   │ │
│ │   Extensions    2  │ │                      │ │ Actions ...       │ │
│ │                    │ │                      │ │                   │ │
│ │ SYSTEM             │ │                      │ │                   │ │
│ │   Diagnostics   ✓  │ │                      │ │                   │ │
│ └────────────────────┘ └──────────────────────┘ └───────────────────┘ │
│ ✓ Ready · last action: Worker wins-worker stopped                       │
├──────────────────────────────────────────────────────────────────────────┤
│ Tab pane  ↑↓/jk item  Enter inspect  n new  ? actions  r refresh  q quit│
└──────────────────────────────────────────────────────────────────────────┘
```

Target proportions:

- Control: 18–22 columns
- Inventory: 30–38 columns
- Inspector: remaining width; must be the largest pane

The Inspector gets the visual weight because Workstation is an operator tool, not a launcher.

## Standard layout — 80–119 columns

Two windows. Domain navigation collapses into the Inventory header.

```text
┌ Queqiao Workstation ─ Workers [2] ──────────────────────────────────────┐
│ ┌ INVENTORY ──────────────┐ ┌ INSPECTOR ───────────────────────────────┐ │
│ │ 1 Gateway   2 Worker    │ │ wins-worker                    ● RUNNING│ │
│ │ 3 Workspace 4 Profile   │ │ Endpoint ...                            │ │
│ │ 5 Extension 6 Health    │ │ Workspaces ...                          │ │
│ │                         │ │ Extensions ...                          │ │
│ │ ▌ ● wins-worker   2 ws  │ │ Actions ...                             │ │
│ │   ● wsl           1 ws  │ │                                         │ │
│ └─────────────────────────┘ └─────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│ Tab pane  ↑↓/jk item  1-6 domain  ? actions  r refresh  q quit          │
└──────────────────────────────────────────────────────────────────────────┘
```

No dedicated narrow sidebar is kept merely to preserve desktop geometry.

## Narrow layout — 60–79 columns

One primary window at a time.

- domain selector lives in header
- Inventory and Inspector are views in the same window
- `Enter` or `→` opens Inspector
- `Esc` or `←` returns to Inventory
- `Tab` changes the current logical window where applicable

A narrow terminal must not render three unusably thin columns.

## Too-small state

Below the truthful implementation floor, render one intentional message instead of clipped panels.

Initial design floor to validate in implementation:

- width < 60 columns, or
- height < 18 rows

The exact floor is a test result, not a permanent assumption. Validate at 60x18, 80x24, 120x30, and a wide Windows Terminal profile.

## Focus and selection semantics

The current UI conflates area selection, detail selection, and active runtime state. v2 defines them separately.

### Focused window

The focused window has a visibly emphasized title/border. Do not rely on border color alone; its title carries a `▸` focus marker.

### Selected row

Selection persists when focus moves away. Use a stable left marker such as `▌` plus text emphasis.

### Cursor

Only the focused list shows the navigation cursor `›` when cursor and selection need to be distinguished during multi-select/forms.

### Runtime state

Runtime state uses its own glyph:

- `●` running/healthy enough for the known lifecycle state
- `○` stopped
- `!` degraded/warning
- `?` unknown/unavailable

These symbols are never reused for focus or selection.

### Profile type

- `◆` built-in immutable profile
- `◇` custom profile

## Navigation model

Universal bindings:

| Key | Meaning |
| --- | --- |
| `←` / `→` | move one visible pane spatially without wrapping; Inventory `→` enters Inspector, Inspector `←` returns to Inventory |
| `Tab` / `Shift+Tab` | next / previous logical window, wrapping through the windows available in the current responsive layout |
| `↑↓` / `jk` | move within the focused Control/Inventory list; in Inspector, `↑↓` selects the visible action (`j/k` remain printable shortcuts where applicable) |
| `Enter` | Control/Inventory: enter the pane to the right; Inspector: execute the currently selected action |
| `Esc` | return one context level; Inspector returns to Inventory; never immediately quit from a nested context |
| `1..6` | jump domain: Gateway, Worker, Workspace, Profile, Extension, Health |
| `r` | refresh visible models without changing focus/selection |
| `?` | open keyboard Help modal (`[i]` opens Detailed Info; `,` opens Appearance Settings) |
| `q` | quit only when no form/confirmation owns text input |

Context actions are shown in the footer and in the Inspector. No important action may exist only as an undiscoverable shortcut.

Recommended common resource actions:

- `n` new/setup/install where applicable
- `e` edit/configure
- `d` destructive remove/delete/uninstall; always confirmed

Runtime start/stop and enrollment actions are context-specific and must be labelled in the footer rather than assigned a globally ambiguous meaning.

Printable `j/k` navigation is disabled while a text field owns input.

## Inspector content by domain

### Gateway

Primary:

- name
- running/stopped, managed/unmanaged
- public URL
- service port
- management port

Relationships:

- enrolled Worker count
- Worker identity/environment + endpoint when loaded

Actions:

- start / stop
- configure
- create join code
- manage enrolled Workers
- remove

### Worker

Primary:

- name
- lifecycle state
- managed state
- endpoint / port

Relationships:

- Workspace count and names
- attached Extensions
- enrolled Gateway relationship when available from current local model

Actions:

- start / stop
- configure
- join Gateway
- add Workspace
- remove

### Workspace

Primary:

- display name
- owning Worker
- root path
- applied access policy/profile label

Relationships:

- Worker
- Access Profile source label when known

Actions:

- edit
- remove

Do not imply the Access Profile is a live link. Existing product semantics remain copy-on-apply.

### Access Profile

Primary:

- name
- built-in/custom
- tools count + tool list
- executable allowlist count + values

Secondary:

- immutable notice for built-ins
- detached-template semantics

Actions for custom profile:

- edit
- rename
- delete

### Extension

Primary:

- display name
- extension id
- version
- package/source identity

Relationships:

- Worker attachment matrix

Actions:

- attach/detach selected Worker
- uninstall
- install new Extension from inventory/domain context

### Diagnostics / Health

Diagnostics is a system view, not a generic JSON result.

Sections:

- Core
- Extension Hub
- configured runtime summary
- warnings/errors

Healthy state should be compact. Errors receive space and remediation text.

## Status and feedback

### Global status line

One line above the footer:

```text
✓ Ready · refreshed 1.4s ago
```

or

```text
! 2 warnings · Worker wsl unreachable · refreshed 4.8s ago
```

### Operation feedback

Success:

```text
✓ Worker wins-worker stopped
```

Failure:

```text
! Stop failed · runtime is active but unmanaged
```

Do not render a permanent bordered JSON block after every operation.

Long details belong in Inspector/Health or an explicit details view.

### Busy

An action owns a specific object and displays that locality:

```text
… Starting wins-worker
```

Global navigation should be blocked only when the underlying operation contract requires it. Refresh must never overwrite an active form.

## Forms and confirmations

Forms are Workstation views, not a return to Clack.

All responsive layouts keep the originating panes mounted behind an opaque root-level action modal. The modal is a floating page, not a replacement Inspector and not a container for another bordered form. It is deliberately biased upward enough to leave visible background below.

Action-form hierarchy:

1. fixed Action identity
2. fixed Target identity
3. Purpose/effect when height allows
4. one current field/group at a time when the application contract is sequential
5. validation immediately adjacent to the field
6. fixed control guidance; only the choose/multi body scrolls
7. destructive confirmation summary before irreversible commit, with default No
8. `Esc` cancels with zero committed mutation where the domain operation allows cancellation

At short terminal heights, Action + Target and the real control take precedence: secondary Purpose and generic field guidance collapse before the selector/input viewport. Prompt primitives are controls inside the transaction page; they must not introduce a second full-size `FORM` border.

Multi-select must visually separate:

- cursor/focus
- selected values
- disabled/unavailable values

## Responsive and clutter rules

- Inspector is never smaller than Inventory in wide mode.
- Avoid nested decorative borders inside Inspector; use headings + whitespace first.
- A border must represent a window, form boundary, or destructive confirmation—not mere grouping.
- Paths and URLs truncate from the middle or tail only when the full value can be inspected separately.
- Secondary metadata uses dim text; critical state and selected identity use normal/bold text.
- Use a restrained semantic palette only for Select/Focus (accent), Active/Success, Warning/Degraded, Danger/Error, Modal chrome, and Muted metadata. Appearance Settings edits these fixed roles directly from a small shared color vocabulary; it must not introduce theme presets that remap role meaning.
- Never encode running/stopped, selected, built-in/custom, warning/error, or focus using color alone; every colored state also has a glyph, label, or typography cue.
- Empty states explain the next valid action instead of showing `— no items —`.

Examples:

```text
No Workers configured
Press n to set up a Worker.
```

```text
No Extensions installed
Press n to install from npm or a local path.
```

## State architecture

Do not grow the current `DetailItem[]` abstraction into a larger menu tree.

Target presentation architecture:

```text
Existing domain/application functions
            ↑
Workstation actions / queries
            ↑
Workstation view models
            ↑
Contexts + focus/navigation reducer
            ↑
Windows / views
            ↑
Ink renderer
```

Recommended concepts, adapted from Lazygit:

- Window: fixed screen region (`control`, `inventory`, `inspector`, `status`, transient form/help)
- View: content currently rendered in a window
- Context: selected domain/entity + cursor + scroll state for a view
- Action: semantic operation triggered by a key/menu/form
- ViewModel: display-ready data, never raw domain JSON

Domain/application functions remain authoritative. UI actions delegate to them.

## Data and refresh model

The current `WorkstationSnapshot` is sufficient for inventory, but not for a high-value Inspector.

Do not solve this by making the 2.5-second global refresh perform every expensive query.

Use two data tiers:

### Inventory snapshot

Low-cost, periodically refreshed:

- role inventories
- workspace inventory
- profile inventory
- extension inventory/attachment counts
- aggregate counts

### Inspector detail

Loaded lazily for the selected entity and refreshed after relevant actions:

- runtime status detail
- Gateway membership detail
- diagnostics detail
- any relationship information not already in the cheap snapshot

Rules:

- Workstation inventory is host-local: each OS enumerates only roles configured on that host.
- Gateway membership/health is the authoritative cross-host topology view; a Gateway host may show enrolled Workers from Windows, WSL/Linux, or other supported hosts.
- Worker-only Doctor is local-health scoped and does not infer an unpersisted remote upstream Gateway relationship.
- named-role discovery ignores directories that do not contain a runtime config, so stale folders do not create phantom unhealthy roles.
- preserve selection by stable object key across refresh
- refresh must not reset focused window
- if the selected object disappears, choose the nearest valid row and show operation feedback
- stale detail must be visibly marked while reloading rather than silently paired with a new selection

## Implementation status

Slices 1-3 plus Slice 4A are implemented and production-tested: grouped ownership hierarchy, full-viewport responsive 3/2/1-window layout, focused-window vs selected-row semantics, per-domain selection persistence, intentional too-small state, single-layer Inspector actions/footer, root-level action forms, explicit destructive target/effect review, and a viewport-independent navigation grammar. Spatial `←`/`→` movement never wraps; Inspector `←`/`Esc` returns to Inventory; Inspector `↑`/`↓` selects the visible action and `Enter` executes it consistently across wide, standard, and narrow layouts. `[i]` opens tabbed Detailed Info and `?` opens Help. Gateway/Worker runtime health and enrollment relationships are loaded lazily for the selected entity; periodic inventory refresh does not fan out heavy Inspector queries, stale async detail is discarded, and stopped Gateways do not bypass the Gateway management boundary to read internal membership storage.

The full-screen renderer uses semantic color as reinforcement rather than as the only state signal. The default assignment is cyan for focus/accent, green for healthy/success/selected values, yellow for warning/degraded state, red for destructive/error state, lilac for modal chrome, and gray for muted/stopped metadata. Appearance Settings may reassign those six semantic roles from a bounded 24-color vocabulary through an `Enter`-opened responsive 4/3/2-column picker; the role meanings themselves never change. Detail/Help/Settings overlays use a full-width opaque backdrop only across the modal's own vertical band so partial background words cannot bleed beside the frame, while the persistent Workstation context remains visible above and below. Background polling is silent and snapshot commits are semantic: unchanged snapshots do not produce new frames, while changed snapshots replace the prior stable inventory atomically without a `Working…` or blank-state pulse. Inspector refresh preserves prior same-entity detail until the replacement detail is ready.

Responsive behavior is two-dimensional. Width selects the 3/2/1-window topology, while available height controls information density. Within a fixed viewport, pane geometry is invariant: Wide keeps Control at 22 columns and Inventory at 36 columns, Standard keeps Inventory at 34 columns, and only the Inspector consumes the remaining width. Runtime data is not allowed to flex-shrink neighboring panes. Inventory rows use fixed identity/metadata cells and Inspector fields use a fixed label/value boundary; long names, URLs, paths, endpoints, and packages truncate inside their own cell instead of changing pane width or wrapping into layout-pressure rows. Inspector actions remain directly selectable at every supported height and scroll inside a bounded viewport when needed; there is no fallback action palette. Footer action hints are width-fitted to one row so changing context does not steal body height or make the workstation jump vertically.

## Implementation slices

### Slice 1 — layout and navigation shell

No new domain capability.

- replace six-peer menu with grouped domain hierarchy
- implement responsive window layout
- implement focus/context reducer
- preserve current actions behind the new views
- replace permanent result JSON box with status feedback

### Slice 2 — structured inspectors

- Gateway inspector
- Worker inspector
- Workspace inspector
- Access Profile inspector
- Extension inspector
- lazy detail loading where required

### Slice 3 — forms and contextual actions

Implemented:

- existing prompt flows render inside the root transaction modal while the Inspector remains the stable Info background
- `?` opens keyboard Help without losing entity selection; Inspector actions remain directly visible/selectable
- footer hints expose the highest-value context actions and stay on one terminal row
- destructive Gateway/Worker, Gateway-enrollment, Workspace, Access Profile, and Extension mutations show explicit target/effect review and default to No
- forms distinguish focus (`›`) from selected multi-values (`[x]`) instead of using a shared inverse highlight
- semantic color reinforces focus, health, warning, error, and destructive state without replacing textual glyphs
- silent periodic refresh and semantic snapshot equality prevent no-op full-screen redraw pulses
- changed background inventory commits atomically; same-entity Inspector detail remains visible while refresh completes
- viewport density collapses long Inspector action lists on standard/low-height layouts rather than flex-shrinking information rows

### Slice 4A — navigation and interaction contract

Implemented:

- `←` / `→` provide non-wrapping spatial pane navigation across the windows visible in the current responsive layout
- Control/Inventory `Enter` enters the pane to the right; Inventory `→` also enters Inspector
- Inspector `←` / `Esc` returns to Inventory
- Inspector `↑` / `↓` selects the visible action and `Enter` executes it consistently in wide, standard, and narrow layouts; `?` opens Help
- direct resource shortcuts remain available without first opening the palette
- action selection belongs directly to the base Inspector action list; the selected action has an explicit cursor while compact resource information remains visible above it
- footer navigation hints are focus-aware and describe the same key ownership implemented by the reducer/input handler

### Slice 4B — viewport resilience

Implemented:

- Inventory, Inspector actions, Detailed Info, choose, and multi-select content use bounded measured viewports rather than overflowing the full-screen layout
- Inventory/action/form selection auto-scrolls to remain visible; choose/multi-select forms track the focused row by actual Ink/Yoga `top` + `height` metrics, so wrapped descriptions (including Workspace Tools) cannot invalidate scroll targeting; Inspector content scrolls with arrow/PageUp/PageDown/Home/End while printable resource shortcuts retain ownership
- form chrome is outside the flexible scroll budget: help/instruction rows and nested form borders never share a terminal row with clipped content or the outer Inspector border, and root status/action/navigation footers are non-shrinking rows
- measured scroll offsets clamp when content or terminal dimensions change, preserving valid selection/context instead of allowing hidden stale offsets; focused form rows are remeasured after responsive layout changes
- refresh failures keep the previous stable snapshot visible and surface `Refresh failed · … · last-good data shown` instead of blanking the workstation or leaking an unhandled rejection
- active forms pause when the terminal drops below the supported viewport floor; hidden input is ignored, `Esc` may cancel, and resizing back restores the original prompt state

### Slice 4C — structured Diagnostics

Implemented:

- Diagnostics is a lazy Inspector detail query backed by the existing authoritative `doctorQueqiao()` application API
- the Inspector renders structured Core, Routing, Extension Hub, and Warnings sections instead of a raw JSON blob
- healthy state is compact; degraded/error entries expand into actionable warning/remediation rows
- Extension Hub health is consumed from `doctorQueqiao()` and is not queried a second time by Workstation
- periodic inventory refresh does not fan out Diagnostics work; selecting Diagnostics, explicit refresh, or `Run diagnostics` reloads the single authoritative query
- the System/Diagnostics inventory indicator is `·` / `not checked` before the first query, then becomes `✓` / `healthy` or `!N` / `N issues` from the actual diagnostics result
- the global status line retains the last loaded Diagnostics summary, including warning count and current runtime count
- the isolated verifier captures a real disposable Diagnostics frame using production Gateway/Worker/Extension state and `doctorQueqiao()`

### Slice 4D — interactive completeness and presentation cleanup

Implemented:

- Worker enrollment offers configured local Gateways plus a `Use join code` path; a self-contained `qjq1:` code can therefore enroll against a remote Gateway without introducing a second enrollment contract
- join codes are collected through a dedicated masked secret prompt; the real value remains in prompt memory for validation/execution but is never rendered into the TUI
- Gateway contextual actions reuse `getGatewayInfo()` for `Copy MCP URL` and `Copy approval secret`; the approval secret is copied through the canonical clipboard path and is never placed in the Workstation result body
- Gateway footer hints prioritize lifecycle, join-code, and MCP handoff operations within the available width; the complete action set remains available through Inspector/`?`
- `runWorkstation()` now has one production presentation path: the Ink shell. The former Workstation-specific Clack selector/menu fallback, prompt wrappers, and duplicate role/extension menus are removed; Clack remains available to explicit leaf CLI commands
- accessibility remains semantic rather than color-only: focus, selected state, runtime state, health/warnings, destructive actions, and secret input all retain textual glyphs/labels; existing fixed-width, truncation, long-list scrolling, narrow-layout, and too-small tests cover the expanded action surface

## RC visual and interaction audit

The release-candidate walkthrough is recorded in `docs/validation/workstation-rc-visual-interaction-audit-2026-08-31.md`.

Release presentation invariants added by that audit:

- an intentionally stopped runtime is neutral lifecycle state (`○ STOPPED`, `Probe  ○ stopped`), not a red unreachable failure; active-but-unreachable runtimes retain failure semantics
- navigation footers are width-fitted single rows and always preserve `q quit`; Inspector guidance includes the global `1-6` domain ownership instead of wrapping hidden behavior onto another row
- the base Inspector footer advertises only real direct shortcuts; actions without shortcuts remain in Inspector/`?` and are never mislabeled as `Enter <action>` because Inspector Enter owns the contextual palette
- Access Profile authority is enumerated row-by-row so no tool or allowed executable can disappear inside middle truncation
- Inventory metadata uses operator-readable words (`workspaces`, `tools`, `attached`) rather than internal abbreviations
- standard-width text, secret, and confirmation help remains compact enough for one fixed prompt-help row
- Workspace/Profile copy semantics use short complete sentences instead of truncating the policy meaning

## RC action UX hardening

Action transactions use a typed outcome contract instead of dropping application result bodies into a one-line global status. Outcomes distinguish `success`, `noop`, `warning`, `cancelled`, and `error`, and may carry structured details, clipboard/other side effects, and remediation.

Release invariants:

- the base Inspector is the universal compact home state; `[i]` opens tabbed Detailed Info, and forms/progress/result modals return to the same selected entity and action selection when it still exists
- action modals are root-level opaque floating overlays above the persistent panes; background pane geometry remains mounted and visible around all sides, while a one-cell opaque clearance prevents pane borders from visually connecting into the modal frame
- Start/Stop/Copy/Diagnostics and other low-risk immediate actions do not add a redundant generic review step
- configure/edit/join/install flows enter their real control directly inside a single action-page grammar (`Action / Target / Purpose / current control`); remove/delete/uninstall flows retain explicit destructive target/effect confirmation with default No; prompt primitives never add a nested full-form border, and every prompt kind receives the same action-page height at a given terminal breakpoint instead of text/secret forms collapsing into a shallow strip
- unavailable actions expose their precondition before execution (`Start the Gateway first`, `Start the Worker first`, `Stop the runtime first`, retain at least one Workspace) instead of surfacing generic downstream fetch/runtime errors
- result modals show structured side effects and remediation; clipboard operations explicitly say whether a value was copied, and join-code clipboard failure keeps the fallback `qjq1:` code visible in the result
- long result modals use measured scrolling with arrow/PageUp/PageDown/Home/End ownership; result content may scroll, but its modal chrome and return-to-Info guidance do not overlap
- action outcomes are not duplicated into the global status line; the global status remains runtime/health/refresh context while the modal owns transaction feedback
- permanent action-contract tests enumerate every Gateway, Worker, Workspace, Access Profile, Extension, Diagnostics, and domain-level creation action plus their availability/precondition behavior

## TDD acceptance

Tests should assert behavior and information hierarchy, not ANSI decoration.

### Pure state tests

- focus cycles window-by-window
- domain jump preserves entity selection per domain
- refresh preserves focus and selection by stable key
- removed entity falls back deterministically
- `Esc` pops context before quit
- text input owns printable keys

### Render tests

Pinned dimensions:

- 140x35 wide: Control + Inventory + Inspector simultaneously
- 100x28 standard: Inventory + Inspector; no dedicated Control pane
- 70x24 narrow: one primary content window; no clipped three-column layout
- below floor: intentional too-small state

Render tests must prove:

- Runtime / Authority / Capabilities / System hierarchy is visible
- Inspector receives more width than Control/Inventory in wide mode
- short and long runtime content produce identical pane boundaries at the same viewport size
- Inventory identity/metadata rows stay single-line and Inspector label/value columns stay fixed; long values truncate inside their cells
- selection survives focus movement visually without reusing runtime-status glyphs
- contextual footer changes between Gateway, Worker, Workspace, Profile, Extension, Health
- empty/loading/error states are designed

### Action tests

- direct action refreshes only affected view models where practical
- action result is structured status feedback, not raw JSON UI by default
- forms stay inside Ink
- destructive operations require confirmation
- cancellation preserves original context

### Production/manual verification

Use only:

```text
npm run dev:workstation:verify
```

Verification checklist:

1. Windows Terminal wide profile: inspect every domain without touching stable runtime.
2. Resize through wide → standard → narrow and back; focus/selection must survive.
3. Start/stop disposable Gateway and Worker; status changes in place.
4. Create/edit/remove disposable Workspace and custom Access Profile.
5. Install/attach/detach/uninstall disposable Extension.
6. Open Diagnostics and confirm Core, Routing, Extension Hub, and warning/remediation rows are derived from the disposable runtime; System health must not claim `healthy` before the first check.
7. Trigger a validation error and cancel a form.
8. Confirm `q` exits only outside owned text input.
9. Exit verifier and confirm temporary runtime is removed and stable connector remains healthy.

Do not validate Workstation by restarting or relinking the stable connector.

## Explicit non-goals

- no generic `queqiao setup`
- no merging Gateway/Worker/Workspace/Extension ownership
- no service autostart model
- no hidden mutation during refresh
- no secrets or user-private runtime values committed to the repository
- no dashboard charts/metrics invented without an actual data source
