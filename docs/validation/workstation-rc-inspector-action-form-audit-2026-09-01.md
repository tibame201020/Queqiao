# Workstation RC Inspector and Action Form Audit — 2026-09-01

## Scope

This validation records the release-candidate interaction/presentation pass for the single-layer Inspector, tabbed Detailed Info, appearance settings, and root-level action forms. It does not change Gateway/Worker domain semantics or lifecycle ownership.

## Accepted interaction contract

- Inspector is one operational layer: compact resource information and selectable Actions remain visible together.
- `Up` / `Down` selects an Inspector action and `Enter` runs it; direct resource shortcuts remain active.
- `[i]` opens tabbed Detailed Info; left/right changes contextual tabs and the modal owns scrolling/input until closed.
- `?` opens keyboard Help; `,` opens Workstation Appearance Settings.
- Action transactions are root-level opaque overlays while Control / Inventory / Inspector remain mounted in the background.
- Immediate actions execute directly into Working/Result. Input actions open the actual control. Destructive actions retain explicit confirmation with default No.

## Action form presentation contract

Action forms use one floating page shell rather than nesting the former prompt form inside a second bordered panel:

1. Action identity is fixed.
2. Target identity is fixed.
3. Purpose/effect is shown when vertical space allows.
4. The current choose, multi-select, text, secret, or confirmation primitive occupies only the control body.
5. Long choose/multi-select bodies scroll while page context and control guidance remain stable.
6. Short-height layouts preserve Action + Target + the real control before secondary Purpose/generic help copy.
7. Modal geometry leaves persistent Workstation context visible around the overlay, including lower breathing room.

The Workspace Tools regression specifically verifies wrapped tool descriptions, long-list focus visibility, resize behavior, fixed Action/Target/Purpose context, and the absence of a nested `FORM` border.

## Appearance contract

Workstation semantic colors are global presentation settings rather than domain/runtime configuration. Selection/accent, success, warning, danger, muted metadata, and modal chrome remain distinct semantic roles. Detailed/action/help/settings overlays use the configured modal accent while their content continues to use global state colors. Appearance presets persist independently in Workstation presentation settings.

## Verification evidence

- TypeScript typecheck: PASS.
- Workstation permanent suite: 16 files / 129 tests PASS.
- Isolated packaged Workstation smoke: 18 / 18 PASS using disposable runtime state only.
- Full repository suite: 88 files / 740 tests PASS.
- Security gate: 57 files / 524 tests PASS.
- Cluster gate: 8 files / 30 tests PASS.
- Package/resource gate on Node 24.18.0: 7.68 MiB package against 24 MiB budget; zero resource failures.
- `git diff --check`: PASS before this validation note; post-note check is required as the final hygiene step.
- Changed/untracked sensitive scan: 51 text files checked; zero machine/user paths, Tailscale hosts, JWT-like values, Bearer-like values, or concrete join-code-like values.
- Temporary visual probes/scripts and generated resource report: absent.
- README line budgets remain EN 179 / zh-TW 148.
- Stable runtime was checked read-only only: configured Gateway and Windows Worker active/managed, two Gateway memberships present, local Gateway health `ok=true`, and both health entries reachable.

## Manual review handoff

Automated and isolated visual contracts are green. Remaining review is product-level manual judgement: action-specific wording, field grouping, palette preference, information density, and whether any individual action flow needs further presentation polish before release freeze.
