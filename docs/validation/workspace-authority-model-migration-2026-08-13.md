# Workspace Authority Model Migration ¡X 2026-08-13

## Result

Workspace creation is now explicitly Git-neutral. `workspace init` and `workspace add` accept any explicitly selected existing directory after canonical directory validation. No `.git` marker or configured discovery root is consulted.

The old `workspace discover` / `workspace approve` repository-coupled authority path is deprecated and refuses to grant authority. Operators are directed to `workspace add` instead.

`discovery roots` remain read-only resource search scopes and their CLI output states that they do not create or broaden Workspace authority.

## Authority preservation

- Existing Workspace records are not rewritten or widened during migration.
- A new explicit Workspace is appended only after directory validation and validated atomic config replacement.
- Duplicate/invalid config mutations fail before the live config file is replaced.
- Worker Workspace-catalog hot reload continues to atomically adopt valid Workspace changes and retain the last good catalog on invalid replacement.
- Core `SafeWorkspace` containment semantics are unchanged.

## Verification

Regression coverage includes:

- explicit non-Git directory authority;
- file/missing-root rejection;
- adding a second non-Git Workspace without modifying the original root;
- invalid atomic mutation retaining the previous config;
- Worker Workspace-catalog valid hot reload / invalid last-good retention.

This migration does not change the public MCP manifest. Repository/worktree identity is left for the first-party Git extension.
