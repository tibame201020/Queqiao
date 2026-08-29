# Queqiao CLI

This directory is the user-facing visual and interaction guide for the production Queqiao CLI.

The CLI has four primary product domains:

```text
queqiao
├─ gateway
├─ worker
│  └─ workspace
├─ extension
└─ doctor
```

Gateway and Worker remain separate runtime roles. Workspaces remain Worker-owned authority boundaries. Extensions are installed into the environment-local Extension Hub and attached to Workers independently. The CLI may compose these primitives interactively, but presentation never changes their ownership model.

## Guides

- [Interactive flows](interactive/README.md) — real PTY recordings of setup, Access, named-instance selection, and Extension attachment.
- [Components](components/README.md) — the reusable terminal interaction grammar: selectors, multiselect, inputs, results, help, and errors.
- [Operational flows](flows/README.md) — real packaged CLI command execution for Workspace authority, Extension operations, enrollment, and runtime verification.
- [Workspace authority](../workspace-authority.md) — the filesystem/tool/command authority model.
- [Extensions](../extensions.md) — Extension Hub installation, attachment, and authoring.
- [CLI selector grammar](../wayfinder/cli-selector-grammar.yaml) — the implemented TTY/non-TTY/JSON selector contract.
- [TUI design system](../wayfinder/cli-tui-design-system-v1.md) — presentation tokens and interaction rules used by the component renderers.

## Visual documentation contract

Visual assets are split into three classes:

1. **Interactive GIFs** are recordings of the real packaged CLI inside a PTY. The recorder types commands, waits for production prompts, sends navigation/text keys, captures the raw ANSI stream, and renders that stream as a GIF.
2. **Operational flow GIFs** execute the real packaged CLI against isolated synthetic runtime state. They are useful for longer scriptable lifecycle and diagnostic sequences where a terminal selector is not the focus.
3. **Component GIFs** document reusable presentation-state transitions. They are generated deterministically from the production TUI grammar and may use synthetic identifiers/paths because they do not claim that a command was executed.

Interactive and operational recordings must never use live user configuration, credentials, endpoints, or join secrets. Component animations must never be presented as runtime execution evidence.

## Current visual baseline

The current visual set corresponds to the production CLI/TUI system introduced in v0.8.0. Interactive setup recordings are generated from a staged npm package of the same source revision through WSL PTY capture. Operational flows are generated from the same staged package against isolated fixture state.

The older first-run GIF set recorded on 2026-08-20 predates the current selector, Access Profile, Workspace authority, Extension, and TUI presentation contracts and is intentionally retired rather than reused.
