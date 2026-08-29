# Queqiao CLI/TUI Design System v1

Date: 2026-08-29
Status: presentation-layer convergence

## Scope

This design system changes how Queqiao CLI/TUI state is presented. It does not change commands, selectors, business behavior, authorization, extension semantics, runtime configuration, or the public MCP manifest.

The CLI/config model remains the management source of truth. Presentation code must not become a second business-logic owner.

## Design basis

The design follows the TUI design principles reviewed for this convergence:

- clear visual hierarchy
- generous and consistent spacing
- monochrome-first emphasis with restrained semantic color
- keyboard-first interaction with visible key hints
- visible, predictable focus
- independent UI state and domain state
- designed success, warning, error, disabled, empty, and completed states
- graceful non-color terminal behavior

## Visual grammar

### Semantic palette

Queqiao uses four semantic hues:

- accent: cyan ? active focus plus structural identity/navigation
- success: green ? completed/success/selected state
- warning: yellow ? attention/recoverable state
- danger: red ? error/destructive state

Structural color is deliberately bounded:

- section headings and entity identifiers use cyan + bold
- URLs, paths, and executable command text use cyan
- ordinary values use terminal-native bold
- keys, descriptions, and hints use gray/dim
- green/yellow/red remain reserved for state semantics

Color is never the only state channel. The same hierarchy must remain understandable after all ANSI styling is removed.

`NO_COLOR` and `TERM=dumb` disable ANSI styling. Non-TTY output is unstyled by default.

### Symbols

| Meaning | Symbol |
| --- | --- |
| Active prompt | `◆` |
| Completed prompt | `◇` |
| Focus | `›` |
| Selected multi-choice | `■` |
| Unselected multi-choice | `□` |
| Success | `✓` |
| Warning | `!` |
| Error | `×` |
| Guide | `│` |
| Guide end | `└` |

Focus and selection are independent channels. A focused selected row is therefore `› ■`, not a single overloaded marker.

### Choice rows

Single choice:

```text
  Reader
    Read-oriented tools only.
› Editor
    Read and edit tools.
```

Multi choice:

```text
  ■ read_file
    Read UTF-8 text from a workspace-relative path.
› □ write_file
    Write a UTF-8 text file.
```

Primary labels are never dimmed. Secondary descriptions may be dimmed when neither focused nor selected. Disabled rows remain readable and must not depend on color alone.

### Microcopy

Interactive copy is noun-first and context-aware. When the title already states the action, the prompt names the entity or value instead of repeating an instruction verb.

Preferred:

```text
Gateway Setup
?  Gateway
?    shadow
?    stable
?  ? New Gateway
```

Avoid:

```text
Gateway Setup
?  Select Gateway
?    Edit shadow
?    Edit stable
?  ? Create new Gateway
```

Rules:

- prompt labels name the decision (`Gateway`, `Worker`, `Extension`, `Access profile`, `Tools`)
- existing entity choices show identity/state, not `Edit`, `Use`, `Attach`, or other action prefixes already implied by context
- creation sentinels use concise labels such as `New Gateway`
- summaries omit repeated nouns when the prompt already supplies them (`3 selected`, not `3 tools selected`)
- auto-selection notices use `Gateway: stable` / `Worker: windows`, not `Using Gateway: stable`

### Prompt frames

Active:

```text
◆  Tools
│
│    ■ read_file
│  › □ write_file
│
│  ↑/↓ navigate · Space toggle · Enter confirm
└
```

Completed:

```text
◇  Tools
│  3 selected
```

Prompt headers are strong. Key hints are secondary. Error messages use the error glyph plus danger emphasis.

Prompt frames are compact by default. The first choice or input row follows the prompt header immediately; renderers must not insert a guide-only blank row merely for decoration. Blank rows are reserved for real section boundaries or content that needs deliberate separation.

### Result output

Human-readable command results use a stable hierarchy:

```text
Worker wins-worker
  Status: Running
  Managed: Yes
  PID: 1234
```

Next action is its own section:

```text
Next
  queqiao worker serve --bg --worker wins-worker
```

Success operations may use a semantic prefix:

```text
✓ Worker joined Gateway: wins-worker
  Worker Id: ...
```

Machine-readable `--json` output is never styled and must retain its existing data semantics.

## Architecture

Presentation responsibilities live in shared primitives:

- `tui-theme.ts` — semantic style tokens, symbols, terminal-color policy
- `tui-choice-renderer.ts` — single/multi choice rows
- `tui-select.ts` — single-select prompt frame
- `tui-multiselect.ts` — multi-select prompt frame
- `workspace-path-prompt.ts` — autocomplete prompt using shared prompt grammar
- `cli-output.ts` — human result hierarchy using the same semantic theme

Domain modules supply labels, descriptions, choices, state, and result data. They do not define colors or focus/selection glyphs.

## Invariants

Presentation changes must preserve:

1. all public CLI leaf routes and flags
2. interactive/non-interactive selector semantics
3. exit/error behavior unless an explicit CLI contract change is separately approved
4. Worker-authoritative access checks
5. extension attach/install semantics
6. `--json` machine output
7. runtime config and secret separation
8. public MCP manifest

## Regression protection

Tests should cover:

- focus and selection remain independently visible without color
- disabled state remains legible
- prompt active/submit/error states use the shared grammar
- key hints are present during interaction and absent after submit
- `NO_COLOR`, non-TTY, and `TERM=dumb` disable ANSI
- human output hierarchy is stable
- `--json` is unaffected
- existing CLI leaf/dispatch/security tests remain green

## Migration rule

No feature module should introduce new raw ANSI/color decisions, choice glyphs, or prompt footers. New presentation semantics belong in shared theme/primitives first, then feature code consumes them.
