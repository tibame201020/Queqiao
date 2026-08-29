# Queqiao CLI

This directory contains the production CLI reference and visual interaction documentation.

```text
queqiao
|- version
|- gateway
|- worker
|  `- workspace
|- extension
`- doctor
```

Gateway and Worker remain separate runtime roles. Workspaces are Worker-owned authority
boundaries. Extensions are installed into the local Extension Hub and attached to Workers
independently. TUI presentation composes these primitives but does not change their ownership.

## User guides

- [CLI reference](reference.md) - complete public command surface and selector/JSON rules.
- [Interactive flows](interactive/README.md) - real PTY recordings of setup, selection, runtime startup, enrollment, and verification.
- [Components](components/README.md) - reusable selector, multiselect, input, result, help, and error grammar.
- [Operational flows](flows/README.md) - longer packaged CLI lifecycle and diagnostic recordings.
- [Workspace authority](../workspace-authority.md) - filesystem, Tool, and command authority.
- [Extensions](../extensions.md) - Extension Hub installation, attachment, and authoring.
- [Operations](../operations.md) - lifecycle, enrollment, cleanup, paths, and migration.

## Visual documentation classes

1. **Interactive GIFs** are recordings of the real packaged CLI inside a PTY. They play once
   and stop on the final frame.
2. **Operational flow GIFs** execute the real packaged CLI against isolated synthetic runtime
   state for longer scriptable sequences.
3. **Component GIFs** document reusable presentation-state transitions and may use synthetic
   identifiers because they do not claim runtime execution.

Interactive and operational recordings must never use live user configuration, credentials,
endpoints, or join secrets. Component animations must never be presented as runtime execution
evidence.

## Design contracts

- [CLI selector grammar](../wayfinder/cli-selector-grammar.yaml)
- [TUI design system](../wayfinder/cli-tui-design-system-v1.md)
