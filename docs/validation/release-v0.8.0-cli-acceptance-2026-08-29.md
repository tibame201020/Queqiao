# Queqiao v0.8.0 CLI release acceptance — 2026-08-29

## Scope

Queqiao v0.8.0 is the CLI hierarchy and management UX release. It freezes the current public CLI around Gateway, Worker, Worker-owned Workspace, Extension Hub, and Doctor domains while preserving Gateway/Worker runtime ownership and the Worker-authoritative Workspace security boundary.

The higher-level `queqiao setup` orchestration prototype and the future full-screen workstation TUI are explicitly not part of this release.

## Release identity

- Package: `@tibame201020/queqiao`
- Version: `0.8.0`
- Expected release tag: `v0.8.0`
- Core Manifest Revision: `8`
- Worker Protocol: `3.0`

## CLI contract acceptance

The release candidate has one canonical public leaf-contract table and production dispatch path. The accepted CLI hierarchy covers:

- Gateway setup/list/lifecycle/enrollment/membership management
- Worker setup/list/port/lifecycle/join
- Worker-owned Workspace add/list/remove/access/profile/tool/command management
- Extension Hub install/list/show/attach/detach/uninstall
- Doctor diagnostics and manifest/tool inspection
- migration and uninstall flows

TTY selector behavior is frozen as:

- zero instances: fail with setup/action guidance;
- one instance: auto-select;
- multiple instances: open the selector;
- non-TTY and JSON: require explicit `--gateway` / `--worker` selectors and never prompt.

## Workspace authority acceptance

v0.8.0 removes persisted default-Workspace semantics. A Worker owns one or more peer Workspaces. Calls that omit `workspaceId` resolve only when exactly one Workspace is available; otherwise they fail with `workspace_required`.

Interactive access setup exposes `Reader`, `Editor`, saved profiles, or `Custom`. Custom access is represented as the explicit Tools × Commands matrix while the internal capability profile remains a compatibility/security ceiling.

Windows duplicate-root authority checks use filesystem identity when available and canonical path fallback otherwise, covering equivalent short/long path and link identities without rejecting distinct roots.

## Extension acceptance

The Worker no longer bundles the first-party Git runtime. Extension package/source ownership belongs to the environment-local Extension Hub; Worker attachment is separate execution intent.

v0.8.0 accepts both npm packages and prepared local-path packages. Local-path installation does not copy/delete the source and does not execute package lifecycle scripts.

The public MCP schema remains stable through the fixed `extension` proxy. Runtime extension/downstream MCP capabilities remain discoverable through extension metadata rather than connector schema mutation.

## TUI acceptance

The production CLI uses the shared TUI design system for selectors, multiselect, Workspace path input, command-history input, human results/status, help, warnings, and errors.

The accepted interaction grammar includes:

- independent focus and selection state;
- bounded/cursor-centered multiselect viewport behavior;
- width-aware description wrapping;
- explicit glyph/state semantics that do not depend on color;
- `NO_COLOR` / `TERM=dumb` styling fallback;
- unstyled machine-readable JSON output;
- cancellation that does not mutate configuration.

## Real packed-CLI visual evidence

Flow GIFs are generated with `npm run docs:cli:flows` from a staged npm package built from the same source revision. The recorder installs that tarball into an isolated npm prefix and executes the real packed `queqiao` binary.

Accepted flow assets:

- `docs/assets/cli/flows/01-roles-workspaces.gif`
- `docs/assets/cli/flows/02-workspace-authority.gif`
- `docs/assets/cli/flows/03-extension-hub.gif`
- `docs/assets/cli/flows/04-start-enroll-verify.gif`

The recorder uses synthetic runtime/config state and deterministically redacts join codes, credentials, PIDs, Worker IDs, real user paths, and machine-specific identifiers before rendering. Transcript leak checks found no real user path/name, real join-code prefix, Stable/Shadow public endpoint, or personal email material.

Component-level TUI evidence remains under `docs/assets/cli/components/` and is intentionally separate from real command-execution evidence.

## Local release gates

The v0.8.0 candidate passed on the Windows development host:

- TypeScript: PASS
- Full suite: `568/568` PASS
- Security suite: `489/489` PASS
- Packaged CLI acceptance: `12/12` PASS
- Real packed-CLI flow recording: PASS (4/4 GIFs)
- `git diff --check`: PASS

The local full suite includes two intentionally untracked `product-setup` prototype tests. Those prototype files are excluded from the release commit and are not part of v0.8.0 claims.

## Required GitHub gates before release

The release tag must not be created until the final PR head passes all required cross-platform jobs:

- CLI setup flow — Ubuntu and Windows
- Full test suite — Ubuntu and Windows
- Adversarial/security gate — Ubuntu and Windows
- Resource Safety Baseline — Ubuntu and Windows
- Self-contained package — Ubuntu and Windows
- Linux Gateway and Worker authenticated handshake
- Runtime dependency audit

## npm publication contract

npm publication is not triggered by an arbitrary tag push. The immutable sequence is:

1. merge the accepted release commit;
2. create `v0.8.0` on that merged commit;
3. publish the GitHub Release;
4. `publish-npm.yml` checks out the immutable tag;
5. the workflow verifies tag/version identity, runs security/resource gates, then publishes `@tibame201020/queqiao@0.8.0` with npm trusted publishing and provenance;
6. verify the public npm registry and a fresh isolated install of the published version.

Registry/CD verification is performed after the immutable release is published and therefore is reported from the release workflow/registry rather than retroactively changing this tagged acceptance document.
