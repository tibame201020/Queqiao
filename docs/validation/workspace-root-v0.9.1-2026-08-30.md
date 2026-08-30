# Workspace root CLI v0.9.1 validation — 2026-08-30

## Scope

Queqiao v0.9.1 promotes Workspace Management from `queqiao worker workspace` to the root-level `queqiao workspace` domain. The 0.9.0 hierarchy is intentionally removed rather than retained as a compatibility alias because there are no external users depending on it.

Canonical management surface:

- `queqiao workspace` — interactive Workspace Management entry point.
- Interactive first level: **Workers** / **Access profiles**.
- `queqiao workspace add|list|info|edit|remove` — Worker-owned Workspace automation.
- `queqiao workspace profiles list|info|create|edit|rename|delete` — global Access Profile CRUD.

The Workspace/Profile data model and Worker-authoritative enforcement are unchanged. Access Profiles remain detached templates: applying one copies policy into a Workspace; later profile lifecycle changes do not mutate existing Workspaces.

## Breaking-route validation

The former `queqiao worker workspace ...` hierarchy is not an alias. Packaged CLI acceptance explicitly invokes the old route and requires a non-zero exit plus replacement guidance containing `queqiao workspace`.

Root help now advertises `workspace    Manage Workspaces and Access Profiles`; Worker help no longer advertises Workspace management.

## Automated validation

- Command surface / dispatch / completion / layout / Workspace focused checks: PASS (278/278 during convergence).
- Final command-surface + packaged + visual focused checks: PASS (212/212).
- Packaged isolated acceptance: PASS (9/9), including full Workspace/Profile CRUD and old-route rejection.
- Full repository suite: PASS (613/613 across 74 files).
- Security suite: PASS (519/519 across 57 files).
- TypeScript typecheck: PASS.
- `git diff --check`: PASS.
- Current documentation stale-route scan: PASS; no current user-facing `queqiao worker workspace` command remains.
- English README: 179 lines, within the production <=180-line guard.
- Traditional Chinese README: UTF-8 marker and `queqiao workspace` verified.

## Shell completion black-box

Using the built 0.9.1 package and generated PowerShell completer:

- `queqiao work<Tab>` returns `worker` and `workspace`.
- `queqiao workspace <Tab>` returns `add`, `edit`, `info`, `list`, `profiles`, `remove` plus global/help options.

This confirms completion is generated from the new canonical command contract rather than retaining the 0.9.0 hierarchy.

## Interactive PTY validation

A same-revision staged npm package was exercised through a real WSL PTY and rendered with the pinned `agg` recorder.

The first attempt exposed a real routing defect: bare `queqiao workspace` was incorrectly classified as an implicit help context, so it printed group help instead of opening the manager. The CLI was corrected so only `queqiao workspace --help` renders help, while bare `queqiao workspace` executes the interactive manager.

Final PTY flow PASS:

1. `queqiao workspace`
2. `Workspace Management`
3. `Manage` -> `Workers` / `Access profiles`
4. Workers -> Worker selector -> Workspace -> Info
5. New manager invocation -> Access profiles -> custom profile -> Info

Final interactive artifact: `docs/assets/cli/interactive/04-workspace-management.gif` (192625 bytes), one-shot/no-loop recorder contract retained.

Operational flow GIFs `01-roles-workspaces.gif` and `02-workspace-authority.gif` were also re-recorded using root `queqiao workspace ...` commands.

## Package artifact validation

`npm pack --ignore-scripts` produced `@tibame201020/queqiao@0.9.1` content with both `README.md` and `README.zh-TW.md`.

A fresh isolated install from the generated tarball verified:

- installed version `0.9.1`;
- root help contains the `workspace` management domain;
- `queqiao workspace --help` exposes root Workspace/Profile commands;
- `queqiao worker workspace ...` exits non-zero.

## Privacy validation

Final raw Workspace PTY cast and regenerated operational-flow transcripts were scanned for the production Shadow hostname, local Windows user path, known account markers, and approval-secret markers. Result: 0 hits.

## Release decision

The v0.9.1 root Workspace hierarchy is ready for PR/required CI and release. No public MCP schema, Worker authority semantics, or Extension Hub authority behavior changed in this patch.