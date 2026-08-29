# Changelog

## 0.8.2 - 2026-08-30

Production README and CLI onboarding documentation patch.

### Highlights

- Refocuses the npm/GitHub README on installation, the Gateway/Worker/Workspace/Extension mental model, and a copyable five-step first-deployment workflow.
- Replaces the mismatched fifth onboarding animation with the same real PTY recording pipeline used by setup and selector demos. Runtime startup and enrollment/verification are split into two readable sub-scenes.
- Makes all six README onboarding GIFs one-shot animations that stop on the final frame instead of looping indefinitely.
- Adds a complete `docs/cli/reference.md` command reference and `docs/operations.md` operator guide so architecture, lifecycle, cleanup, migration, and full CLI detail no longer overload the package README.
- Keeps npmjs-safe absolute visual/documentation links while preserving detailed visual/component/operational docs under `docs/cli/`.

### Runtime impact

- No Gateway, Worker, Workspace authority, Extension, protocol, or security semantics change in this patch.

## 0.8.1 - 2026-08-30

CLI version reporting and interactive documentation patch.

### Highlights

- Adds `queqiao version`, `queqiao --version`, and `queqiao -v`, all sourced from the packaged npm version at build time; `--json` returns the stable `{ schemaVersion, version }` shape.
- Adds packaged acceptance coverage for command, flag, short-flag, and JSON version reporting.
- Replaces the README's single representative CLI animation with a five-stage onboarding sequence covering Gateway setup, Worker/Workspace Access, named-instance selection, Extension attachment, and runtime start/enroll/verify.
- Adds reproducible real-PTY interactive CLI recording through isolated staged npm packages, ANSI/asciicast capture, and pinned/checksum-verified GIF rendering.
- Keeps interactive recordings, operational flow recordings, and component grammar examples in separate documentation layers.

### Release validation

- CLI contract/dispatch and packaged version acceptance are validated before release.
- Full, security, packaged CLI, documentation-link, GIF privacy, and cross-platform CI gates remain required.
- npm publication remains GitHub Release-bound through Trusted Publishing with provenance.


## 0.8.0 - 2026-08-29

CLI hierarchy and management UX release.

### Highlights

- Consolidates the public CLI around `gateway`, `worker`, Worker-owned `workspace`, `extension`, and `doctor` domains with one canonical dispatch contract for every public leaf command.
- Adds consistent Gateway/Worker instance selectors: one configured instance auto-selects in TTY mode, multiple instances open a selector, and automation/JSON calls require explicit selectors.
- Removes stale default-Workspace semantics. A Worker owns one or more peer Workspaces; calls may omit `workspaceId` only when exactly one Workspace is available.
- Introduces the Access Profile UX (`Reader`, `Editor`, saved profiles, or `Custom`) and the explicit Tools × Commands model for Workspace authority while preserving the internal legacy capability ceiling.
- Establishes a shared TUI design system with independent focus/selection state, semantic status styling, bounded multiselect viewport behavior, width-aware wrapping, command history input, path completion, and consistent human help/error/result presentation.
- Externalizes the first-party Git runtime from the Worker and completes the environment-local Extension Hub model: install/uninstall package ownership is separate from per-Worker attach/detach intent.
- Adds prepared local-path Extension packages alongside npm packages without copying source trees or executing package lifecycle scripts.
- Keeps the public MCP schema stable through the fixed `extension` proxy while downstream extension/MCP capabilities remain discoverable at runtime.
- Hardens packaged CLI acceptance and cross-platform lifecycle reconciliation across Windows and Linux, including Windows filesystem identity handling and case-correct POSIX managed-runtime path ownership.
- Adds release-grade CLI visual documentation: deterministic component GIFs plus real packed-CLI flow recordings for roles/Workspaces, Workspace authority, Extension Hub management, and start/enroll/verify flows.

### Release validation

- Full test suite and dedicated security gate run on Windows and Ubuntu.
- Self-contained package checks run on Windows and Ubuntu.
- Linux Gateway/Worker authenticated handshake runs against the packed npm artifact.
- Resource Safety Baseline runs on Windows and Ubuntu.
- npm publishing remains release-tag-bound and uses trusted publishing with provenance.

### Intentionally deferred

- The higher-level `queqiao setup` orchestration prototype is not part of 0.8.0. Gateway and Worker remain separate runtime primitives in this release.
- The future full-screen Queqiao workstation TUI is not part of 0.8.0; this release establishes the reusable CLI/TUI interaction system it can build on.

## 0.7.0 - 2026-08-19

First public npm release candidate for the current Queqiao Secure Agent Substrate.

### Highlights

- One public OAuth-protected MCP Gateway routes to native Windows and WSL/Linux Workers.
- Core Manifest Revision 6 with ten Core tools and a deterministic deployment manifest; the accepted production-like composition enables the first-party Git extension for 17 public tools total.
- Worker Protocol 3.0 with explicit Worker identity, persistent Gateway-owned membership, bounded liveness observation, and fail-closed compatibility checks.
- Named role-local CLI lifecycle: `gateway setup|serve|stop|status`, `worker setup|serve|stop|status`, explicit `workspace add`, and no OS service/autostart installation.
- Atomic Worker enrollment with one-time join tokens, versioned `qjq1:` join codes, provisional credentials, confirmation, live health/protocol verification, and rollback on failure.
- Bounded MCP compatibility window for `2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28`; unknown future revisions fail closed.
- Worker-authoritative Workspace, filesystem, process, tool, command, shell, and Git containment policy.
- `run` and `shell` support bounded synchronous and asynchronous native execution without introducing a durable Job abstraction.
- Trusted local extension composition with deterministic diagnostics and Deployment Manifest Fingerprint.
- Security Baseline v2, Resource Safety Baseline v1, self-contained package checks, Windows/Ubuntu adversarial CI, and dedicated cross-platform CLI setup-flow protection.
- Real ChatGPT, Claude Code 2.1.235, MCP Inspector, Windows, WSL/Linux, package, Shadow, and Stable promotion acceptance evidence is retained under `docs/validation/`.
- Claude Code remote HTTP MCP Dynamic Client Registration and PKCE OAuth are validated with explicitly allowed `localhost` loopback callbacks on ephemeral ports; OAuth UI/default client wording is client-neutral.

### Accepted deferred controls

These are not release blockers for 0.7.0 and are not claimed as implemented:

- GUI Dashboard frontend; the shared Dashboard-ready operations/diagnostics contract is already implemented.
- Durable redacted security audit history and its retention/rotation policy.
- Automatic or zero-downtime Worker credential rotation.
- Full interactive step-up approval-grant runtime; configured step-up policy currently fails closed.
- Untrusted extension sandboxing, marketplace/Hub, or runtime malware adjudication.
- Non-loopback remote Worker transport such as a future mutually authenticated or gRPC binding.
