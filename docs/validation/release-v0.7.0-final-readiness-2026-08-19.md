# Queqiao 0.7.0 final release readiness — 2026-08-19

## Purpose

This document is the final pre-publication release closure for Queqiao 0.7.0. It records the state after PR #24 was merged and separates reversible validation work from the remaining irreversible publication actions.

## Merged release baseline

PR #24 (`Prepare v0.7.0 public release`) is merged into `main` at merge commit `f0a27a08f193cb8312af3085df0be71984e662ec`.

The merged baseline includes:

- package version `0.7.0`;
- MIT `LICENSE` and package metadata;
- `CHANGELOG.md`, `CONTRIBUTING.md`, and `SECURITY.md`;
- README release polish and real packed-CLI demo GIF;
- client-neutral OAuth wording;
- explicitly configured `localhost` loopback OAuth redirect compatibility for native MCP clients;
- Claude Code 2.1.235 real-client remote HTTP MCP/OAuth acceptance;
- explicit Windows/Linux runtime support statement, with WSL using the Linux runtime path;
- explicit non-claim of macOS lifecycle support in 0.7.0.

## Interoperability closure

The release candidate is not ChatGPT-bound at the MCP boundary.

Validated evidence now covers:

- ChatGPT real-client MCP acceptance;
- Claude Code 2.1.235 remote HTTP discovery, Dynamic Client Registration, PKCE OAuth, and connected health state;
- MCP Inspector real-client tool interoperability from the existing acceptance evidence;
- bounded MCP protocol compatibility tests;
- Core Manifest Revision 6 / 17 public tools / Worker Protocol 3.0.

The OAuth loopback change remains fail-closed:

- dynamic ports are accepted only for explicitly configured loopback origins;
- registered redirect URIs remain exact-bound during authorization and token exchange;
- non-loopback alternatives such as `127.0.0.2` remain rejected;
- PKCE, resource binding, approval-secret validation, authorization-code single use, and refresh-token replay protections remain intact.

## Runtime portability closure

Release-supported runtime/lifecycle targets for 0.7.0:

| Component | Windows | Linux | WSL | macOS |
| --- | --- | --- | --- | --- |
| Gateway | PASS | PASS | PASS via Linux | Not supported in 0.7.0 |
| Worker | PASS | PASS | PASS via Linux | Not supported in 0.7.0 |
| Packed npm integration | PASS | PASS | PASS via Linux | Not claimed |

The Ubuntu package integration gate starts a real packed-artifact Linux Gateway and Linux Worker, verifies authenticated routing and Worker Protocol 3.0, and confirms the Worker reports Linux as its platform.

## Open-source release surface

The repository now contains the minimum complete public-project surface intended for the first public release:

- MIT license;
- installable npm package metadata;
- README quick start and architecture/security description;
- real CLI demo GIF generated from packed 0.7.0 CLI execution;
- changelog;
- contribution guidance;
- security reporting guidance;
- CI/security/resource/package gates;
- current validation and acceptance records.

GUI Dashboard, durable audit UI, zero-downtime credential rotation, full step-up approval UX, extension sandboxing/Hub, and macOS lifecycle support remain intentionally deferred and are not 0.7.0 release blockers.

## Publication gate

At this stage, the remaining actions should be treated as publication operations rather than feature development:

1. confirm this PR's required CI checks are green;
2. merge this final readiness record;
3. verify `main` is clean and at the expected release baseline;
4. run one final packed-artifact smoke if desired;
5. create the immutable `v0.7.0` Git tag;
6. create the GitHub Release from the 0.7.0 changelog/release notes;
7. publish `@tibame201020/queqiao@0.7.0` to npm;
8. verify the public npm artifact can be installed from the registry on a clean environment.

Do not create the tag or publish to npm before the final release approval, because both are externally visible publication actions.

## Result

**READY FOR FINAL RELEASE APPROVAL**, subject only to the normal PR CI gate and the explicit approval for immutable publication actions.
