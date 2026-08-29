# Production CLI Documentation Audit ? 2026-08-29

## Scope

This is the merge-gate documentation audit for PR #32 after CLI hierarchy, selector, Workspace authority, Extension Hub, and TUI convergence.

Current operational guidance was checked against the production command contract and packaged acceptance behavior. Historical validation records were preserved as historical evidence rather than silently rewritten.

Audited current surfaces:

- `README.md`
- public `queqiao --help` group/leaf grammar in `apps/cli/src/command-surface.ts`
- `docs/workspace-authority.md`
- `docs/extensions.md`
- `docs/distribution-cluster-baseline-v1.md`
- `docs/wayfinder/cli-selector-grammar.yaml`
- `docs/wayfinder/cli-tui-design-system-v1.md`
- current architecture/ADR references relevant to Gateway, Worker, Workspace, and Extension ownership

## Corrections

- Removed the obsolete concept of a deployment/default Workspace from `workspace_info` guidance. Omitting `workspaceId` is valid only when exactly one online Workspace is available.
- Aligned Worker Workspace help and README examples with the production selector contract: `--worker` is optional in interactive TTY flows and required by non-interactive/JSON execution when it cannot be resolved.
- Aligned Doctor manifest/tool help with the same optional interactive `--gateway` selector contract.
- Documented interactive Extension id selection for `attach`, `detach`, `show`, and `uninstall` while retaining explicit identifiers for automation/JSON flows.
- Updated Access/TUI glyph documentation to the implemented `?` focus and `?` / `?` selection grammar.
- Replaced the stale selector proposal with the implemented production selector contract at `docs/wayfinder/cli-selector-grammar.yaml`.
- Marked older validation documents that proposed generic `queqiao setup` as historical/superseded guidance without rewriting their original audit evidence.
- Recorded the current product direction: no generic `queqiao setup`; a future Workstation TUI may compose the same management primitives without merging Gateway, Worker, Workspace, or Extension ownership.

## Intentional historical references

The following are not current operational instructions and are intentionally retained:

- old `--name` forms under `compatibility.removed_forms` in the selector grammar, solely to document replacement commands;
- `Select Gateway` / `Edit shadow` examples in the TUI design system's **Avoid** section;
- superseded `queqiao setup` recommendations inside dated validation documents, now preceded by explicit historical/follow-up notices.

## Verification

- focused help/selector/presentation tests: 203/203 passed
- packaged CLI acceptance: 12/12 passed
- full suite: 567/567 passed
- security gate: 488/488 passed
- TypeScript: passed
- selector grammar YAML parse: passed
- README relative-link check: passed
- broad non-historical stale-pattern scan: passed (binary asset false positives excluded)
- `git diff --check`: passed

## Result

The production documentation, public CLI help, and current product direction are aligned for PR #32. Historical validation records remain available as evidence but are explicitly distinguished from current operational guidance.
