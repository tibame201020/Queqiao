# Workspace Discovery Semantic Audit ¡X 2026-08-13

## Purpose

This is the required pre-migration audit for the Workspace authority model. It intentionally contains no implementation changes. Workspace is an explicit filesystem/process authority boundary; repository/worktree/project discovery is domain interpretation and must not create authority.

## Current Git-coupled assumptions

### CLI command surface

`apps/cli/src/index.ts` imports the repository-oriented discovery helper and exposes:

- `workspace discover` ¡X scans configured discovery roots and reports directories containing a `.git` marker as Workspace candidates;
- `workspace approve` ¡X resolves a candidate only inside configured discovery roots and requires a `.git` marker before writing it into `workspaces`;
- `discovery list|add|remove` ¡X manages the roots used by that repository scan.

The CLI usage string therefore presents Git-oriented discovery/approval as Workspace management.

### Discovery implementation

`apps/cli/src/workspace-discovery.ts` is explicitly repository-oriented:

- `resolveDiscoveryRoot()` requires the selected directory to be inside a configured discovery root;
- it then requires a `.git` file or directory;
- `discoverWorkspaces()` recursively searches for `.git` markers and promotes the containing directories to candidates;
- the scan is bounded by roots, maximum depth, excludes, and does not itself grant authority until approval.

### Tests

`apps/cli/src/workspace-discovery.test.ts` encodes the old semantic contract:

- repository candidates are synthesized by creating `.git` directories;
- candidate approval rejects a directory with no `.git` marker;
- approval outside configured discovery roots is rejected.

These tests must be replaced/reframed rather than silently updated to broaden the same command.

### Runtime configuration

`packages/config/src/index.ts` has both explicit `workspaces` and a `discovery` block. The runtime authority source is the explicit Workspace record; the `discovery` block is CLI search configuration. Existing explicit Workspace roots must remain byte-for-byte authority-equivalent through migration.

No Worker/Core Workspace constructor requires `.git`; the Git coupling is in the CLI discovery/approval path, not in `SafeWorkspace` authority itself.

### Core filesystem discovery

`packages/workspace/src/index.ts` treats `.git` only as an ignored directory name for bounded generic filesystem enumeration. It does not use `.git` to establish Workspace identity. This is correct and should remain Core behavior.

### Architecture/docs

The accepted architecture already states the target boundary:

- `docs/architecture.md` ¡X Workspace is authority; discovery is not authorization;
- `docs/adr/0009-workspace-authority-and-discovery.md` ¡X `.git`/repository semantics move outside Core;
- Wayfinder feature specs/tickets ¡X audit first, then migrate authority management, then introduce the Git extension.

Historic validation evidence must not be rewritten.

## Migration constraints

1. Introduce an explicit Workspace authority operation that accepts a directory independently of `.git`.
2. The operation must validate that the selected root exists and is a directory before an atomic config update.
3. Existing Workspace records are not widened, rewritten, or auto-parented.
4. No repository/project discovery result may implicitly create a Workspace.
5. The old `workspace discover` / `workspace approve` Git semantics must be deprecated or removed from Workspace authority UX rather than redefined ambiguously.
6. Generic discovery-root configuration must not become an authority wildcard. If retained for future domain discovery, it remains read-only search scope only.
7. Hot reload remains driven by the same validated atomic runtime-config file boundary.
8. Git repository/worktree identity will be represented by the first-party Git extension using locations inside an already-authorized Workspace.
9. Non-Git directories must receive the same Workspace authority behavior as Git directories once explicitly authorized.
10. Migration docs/CLI help must distinguish **Workspace authority management** from **extension-owned resource discovery**.

## Affected implementation set for the next ticket

Expected direct changes:

- `apps/cli/src/index.ts`
- `apps/cli/src/workspace-discovery.ts` (deprecate/remove Workspace-authority semantics or replace with neutral authority-root validation helper)
- `apps/cli/src/workspace-discovery.test.ts` (replace old Git-coupled contract)
- CLI documentation/help and new validation evidence.

Expected regression coverage without semantic change:

- `packages/config` validated/atomic update boundary;
- Worker/Gateway config hot reload tests;
- `packages/workspace` containment tests;
- existing explicit Workspace config/runtime migration tests.

## Non-goals of the migration ticket

- no Git repository discovery in Core;
- no implicit Workspace creation from `.git`, `package.json`, `AGENTS.md`, or other markers;
- no public MCP schema change;
- no widening of configured roots;
- no change to the frozen candidate public manifest as part of Workspace authority migration.
