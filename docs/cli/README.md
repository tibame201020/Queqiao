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

- [Components](components/README.md) — the reusable terminal interaction grammar: selectors, multiselect, inputs, results, help, and errors.
- [Flows](flows/README.md) — the production command sequences for role setup, Workspace authority, enrollment, Extensions, and verification.
- [Workspace authority](../workspace-authority.md) — the filesystem/tool/command authority model.
- [Extensions](../extensions.md) — Extension Hub installation, attachment, and authoring.
- [CLI selector grammar](../wayfinder/cli-selector-grammar.yaml) — the implemented TTY/non-TTY/JSON selector contract.
- [TUI design system](../wayfinder/cli-tui-design-system-v1.md) — presentation tokens and interaction rules used by the component renderers.

## Visual documentation contract

Visual assets are split into two classes:

1. **Component GIFs** document presentation state transitions. They are generated deterministically from the production TUI grammar and may use synthetic identifiers/paths because they do not claim that a command was executed.
2. **Flow GIFs** document command execution. They must come from a real packaged CLI transcript with secrets and machine-specific values removed. A flow GIF is not published when the recorder cannot reproduce the current production interaction safely.

This distinction prevents a polished animation from being mistaken for runtime evidence.

## Current visual baseline

The current component GIFs correspond to the production TUI system introduced on 2026-08-29. The older first-run GIF set recorded on 2026-08-20 predates the current selector, Access Profile, Workspace authority, Extension, and TUI presentation contracts and is intentionally retired rather than reused.
