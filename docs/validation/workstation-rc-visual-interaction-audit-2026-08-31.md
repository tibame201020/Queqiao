# Workstation RC Visual and Interaction Audit — 2026-08-31

## Purpose

This audit is release-candidate evidence for the persistent `queqiao workstation` TUI. It validates presentation and interaction quality that is not fully captured by application-service tests alone: information hierarchy, focus/selection semantics, responsive layout, scrolling, prompt chrome, destructive review, empty states, and operator guidance.

The audit used synthetic rich snapshots plus the production Ink presentation and Workstation interaction reducer. Runtime-dependent smoke coverage remains in the disposable isolated verifier. No stable Gateway or Worker lifecycle state was mutated for this audit.

## Surfaces walked

The walkthrough covered all six Workstation domains:

- Gateway: running and stopped states, health, relationships, contextual actions, long public URL, lifecycle and connector-handoff action discoverability.
- Worker: running/stopped semantics, Workspace/Gateway relationships, lifecycle/setup/join actions.
- Workspace: long identity/root values, Inspector hierarchy, edit/remove actions, Access Profile copy semantics, real long Tools multi-select with wrapped descriptions and bottom-of-list focus.
- Access Profile: built-in and custom profiles, full tool/executable authority visibility, edit/rename/delete actions.
- Extension: attached/unattached Workers, attach/detach operations, uninstall/install actions, long display name.
- Diagnostics: not-checked and degraded states, Core/Routing/Extension Hub/Warnings sections, wide/standard/narrow rendering and scrolling.

Prompt and transient surfaces were also walked:

- text input
- masked secret input
- choose
- multi-select
- default-No confirmation
- destructive target/effect review
- cancellation back to the same selected entity/context
- empty state for every domain

Responsive review covered the established Wide, Standard, Narrow, and too-small contracts. Navigation used the real `←` / `→`, `↑` / `↓`, Enter, Esc, `?`, `Tab`, and `1-6` domain ownership.

## Issues found and resolved

### 1. Stopped runtime was presented as a health failure

Before the audit fix, a stopped Gateway/Worker could simultaneously render `○ STOPPED` and `! unreachable`, even though structured Diagnostics already classified an intentional stopped lifecycle as `○ stopped`.

Resolved contract:

- inactive runtime lifecycle: `○ STOPPED`
- Inspector Health: `Probe  ○ stopped`
- no red `unreachable` presentation and no redundant `runtime stopped` error line for the expected stopped state
- active but unreachable/degraded runtimes retain warning/error semantics

### 2. Narrow Inspector navigation footer wrapped

The generic Inspector footer exceeded narrow terminal width and split `Tab pane` across two rows, violating the fixed footer-height contract.

Resolved contract:

- navigation footer is width-fitted from prioritized hints
- `q quit` is always reserved
- Narrow Inspector keeps one row and prioritizes `↑↓ scroll`, `←/Esc inventory`, `Enter/? actions`, and `1-6 domain`
- lower-priority hints are omitted rather than wrapped

### 3. Footer guidance contradicted Inspector Enter semantics

After Slice 4A standardized Inspector Enter to open the contextual action palette, no-shortcut actions were still advertised as `Enter <action>` in some resource footers.

Resolved contract:

- action footer advertises only real direct shortcuts
- no-shortcut operations remain visible in the Inspector/action palette
- `Enter` is never described as directly executing a resource action while the base Inspector owns Enter for the contextual palette

### 4. Access Profile authority was hidden by middle truncation

Tools and allowed executables were rendered as comma-separated single lines with middle truncation, which could hide policy entries from an Authority surface.

Resolved contract:

- every tool is a separate `• <tool>` Inspector row
- every executable is a separate `• <executable>` Inspector row
- long authority sets use Inspector scrolling rather than hiding middle values

## Information-hierarchy polish

The audit also removed presentation shorthand that was appropriate for implementation/debug output but not for a release Workstation:

- Worker Inventory uses `1 workspace` / `N workspaces` instead of `ws`.
- Access Profile Inventory uses `N tool(s)` instead of `Nt Nx` abbreviations; executable details remain fully visible in Inspector.
- Extension Inventory uses `attached/total attached` wording instead of a bare status glyph/count.
- Workspace copy semantics are expressed compactly as `Access Profile copied on apply · no live link.`
- Access Profile semantics are expressed as `Detached template · existing Workspaces stay unchanged.`
- text/secret/confirm form guidance was shortened so Standard-width prompt help remains a single fixed row.

## Color and focus review

The audit preserved the existing semantic palette and non-color fallbacks:

- cyan: focus/accent
- green: healthy/success/selected value
- yellow: warning/degraded
- red: destructive/error
- gray: stopped/muted

Focus, selection, lifecycle, warnings, and multi-select state also retain glyph/text semantics (`▸`, `▌`, `●`, `○`, `!`, `[x]`) so meaning is not color-only.

Text-frame dumps do not encode terminal color escape state reliably. Color correctness is therefore covered by the Workstation semantic-color component/tests plus real Ink terminal rendering; the visual walkthrough verifies the hierarchy and glyph fallback in the frame itself.

## Layout and scrolling acceptance

The walkthrough reconfirmed:

- pane geometry is invariant while terminal dimensions are unchanged
- long identities/URLs/paths truncate inside their stable cells
- Workspace Tools tracks the focused option using actual Ink/Yoga row metrics even when descriptions wrap
- form help, form bottom border, Inspector border, status, action footer, and navigation footer occupy distinct rows
- form scroll content shrinks before fixed prompt chrome
- Narrow footer remains one row
- Standard/Wide forms do not overlap global footer rows
- destructive review remains Default No and cancellation preserves context

## Result

**PASS — no remaining release-blocking visual or interaction issue was found in the audited Workstation surfaces after the fixes above.**

The temporary frame-dump audit test was removed after review. Permanent regression tests remain in the normal Workstation UI/Inspector/resilience suites for every issue converted into a release contract.
