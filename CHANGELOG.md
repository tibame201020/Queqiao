# Changelog

## Unreleased

## 0.9.6 - 2026-09-01

- Fixes a Workspace/Extension authority regression introduced by the converged Access Profile model: once a Workspace explicitly allows the Core `extension` tool, registered capabilities from installed and attached Extensions are treated as trusted execution authority instead of being re-blocked by capability-specific `tools.allow`, legacy profile ceilings, declared Core capability ceilings, or the Workspace command allowlist.
- Keeps the Core `extension` grant as the explicit Workspace trust gate and preserves Workspace identity/path containment plus Worker process timeout, cancellation, concurrency, and output bounds for Extension helper APIs; Core tools and Core `extend`/`replace` invocations retain their existing policy envelope.
- Adds regression coverage for finite Core tool allowlists, Git Extension execution under non-coding/empty-command policy, denied Core `extension` access, trusted Extension capability escalation semantics, and retained SafeWorkspace containment.

## 0.9.5 - 2026-09-01

- Makes Workstation the README Quick Start, adds real packaged-PTY GIFs for every Workstation control domain, separates the detailed Workstation and classic/leaf CLI visual guides, and adds a code-derived Configuration & Persistence reference covering Windows/Linux/WSL paths, durable files, secrets, membership, Extension Hub storage, Workstation settings, backup boundaries, and path overrides.
- Caps Vitest at four workers so the Windows release suite does not oversubscribe loopback servers, native Git/process fixtures, temporary directories, and isolated package builds; the bounded configuration is both faster and deterministic in repeated full-suite runs, without changing production enrollment or runtime timeout semantics.
- Adds explicit `test:workstation` and `release:gate` scripts, and makes the npm publish workflow require the full release gate (typecheck, full tests, Workstation tests, security, cluster, isolated Workstation verification, resource baseline, and production dependency audit) before publishing.
- Adds `queqiao workstation` as an Ink-based persistent interactive control plane with first-class Gateway, Worker, Workspace, Access Profiles, Extensions, and Diagnostics panes. The TUI fills the full terminal viewport with responsive 3/2/1-window layouts, uses lazy structured Inspector detail for runtime health and enrollment relationships, provides a single-layer Inspector with directly selectable actions, `[i]` tabbed Detailed Info, `?` Help, `,` Appearance Settings, and root-level transaction forms/modals, explicit destructive target/effect review, semantic color with non-color glyph fallbacks, and silent atomic background refresh so unchanged polling does not redraw the screen or pulse a busy state. Standard/low-height layouts compact long action lists and width-fit footer hints instead of flex-shrinking information rows. Pane geometry is content-invariant at a fixed viewport: Wide keeps fixed Control/Inventory widths, Standard keeps a fixed Inventory width, and long names, URLs, paths, endpoints, and package identifiers truncate inside stable cells instead of resizing neighboring panes or wrapping layout-pressure rows.
- Defines a viewport-independent Workstation navigation contract: `←` / `→` move spatially without wrapping, Inspector `←` / `Esc` returns to Inventory, `↑` / `↓` selects the visible Inspector action, `Enter` executes it consistently across wide, standard, and narrow layouts, `[i]` opens Detailed Info, and `?` opens Help.
- Adds measured viewport resilience for long Inventory, Inspector-action, Detailed Info, choose, and multi-select content; selection remains visible through bounded scrolling, scroll offsets clamp after resize/content changes, and form choices use actual Ink/Yoga row metrics so wrapped descriptions such as Workspace Tools cannot drift the focused row outside the viewport. Action-form context/help rows stay outside the selector scroll budget and the former nested full-form border is removed, while root status/action/navigation footers are non-shrinking rows, preventing low-height forms from clipping chrome or overwriting adjacent footer text. Refresh failures retain last-good data with explicit warning state, and active forms pause safely when the terminal becomes too small instead of accepting invisible input.
- Adds structured Workstation Diagnostics backed by the existing authoritative `doctorQueqiao()` query: Core runtimes, Gateway routing, Extension Hub integrity, and warning/remediation rows are rendered as Inspector sections without duplicate Extension doctor work. System health is explicitly `not checked` before the first query, then keeps the actual healthy/warning count in Control/Inventory and the global status line; periodic inventory refresh does not fan out Diagnostics queries.
- Completes interactive Workstation handoff paths with masked remote join-code entry plus canonical MCP URL/approval-secret clipboard actions, while keeping secret material out of rendered/result text and retaining the Ink shell as the single Workstation presentation path.
- Hardens Workstation action UX with typed success/no-op/warning/cancel/error outcomes, root-level opaque transaction modals, `[i]` tabbed Detailed Info, action precondition blocking, explicit clipboard side-effect feedback, join-code copy-failure fallback, and scrollable result/remediation views. Immediate Start/Stop/Copy/Diagnostics actions execute without a redundant generic review step; forms and destructive confirmations open only when the action semantics require user input or confirmation.
- Refines action-form presentation into a single floating page grammar: Action/Target/Purpose remain stable while choose, multi-select, text, secret, and confirmation controls replace only the modal body; the former nested `FORM` panel is removed, long selectors scroll independently, short-height layouts shed secondary copy before controls, all form prompt types use the same useful modal height at a given viewport, and a one-cell opaque clearance keeps background pane borders visually separated from the transaction frame.
- Replaces Workstation theme presets with direct semantic-color assignment. Appearance Settings now edits the six fixed UI roles (`Select / Focus`, `Active / Success`, `Warning`, `Danger / Error`, `Modal`, `Muted`) from a 24-color shared vocabulary. `Enter` on a role opens a responsive 4/3/2-column color-picker grid, arrow keys move within the picker, `Enter` chooses, and `s` persists the complete role assignment; runtime semantics remain fixed, and legacy `appearance.palette` settings are migrated to the equivalent role colors when loaded.
- Defines Workstation/Doctor cross-OS behavior as host-local inventory plus Gateway-authoritative topology: Windows and WSL/Linux Workstations enumerate roles configured on their own host, while a Gateway host exposes enrolled cross-OS Worker membership and reachability through Gateway management/health. Worker-only Doctor remains local-health scoped and does not infer an unpersisted remote upstream Gateway. Named-role discovery now ignores stale directories without a runtime config so abandoned role folders cannot make Doctor unhealthy.
- Adds an RC visual/interaction audit across every domain, Inspector action list, prompt primitive, destructive review, empty state, and responsive layout. The audit aligns stopped lifecycle health semantics, prevents narrow footer wrapping and misleading `Enter` action hints, enumerates Access Profile authority instead of truncating hidden entries, and replaces terse Inventory/form copy with operator-readable single-row guidance.
- Replaces the retired Shadow runtime refresh helper with `npm run dev:workstation:verify`, which builds and launches Workstation against disposable runtime state and random local ports without stopping stable runtimes, rewriting repo `dist`, or relinking the global CLI.

## 0.9.1 - 2026-08-30

- Promotes Workspace Management to the root-level `queqiao workspace` domain.
- `queqiao workspace` now opens the interactive **Workers / Access profiles** management entry point.
- Workspace automation is `queqiao workspace add|list|info|edit|remove`; Access Profile CRUD is under `queqiao workspace profiles ...`.
- Removes the 0.9.0 `queqiao worker workspace ...` hierarchy instead of retaining a compatibility alias.
- Updates shell completion, packaged acceptance, documentation, and real PTY demos to the root Workspace hierarchy.
## 0.9.0 - 2026-08-30

Workspace Management convergence release.

### Highlights

- Adds `queqiao worker workspace` as the interactive management entry point, separating Worker-owned Workspaces from reusable Access Profiles.
- Adds scriptable Workspace `list/info/add/edit/remove` and Access Profile `list/info/create/edit/rename/delete` surfaces.
- Makes `Reader` and `Editor` immutable built-ins and formalizes saved Access Profiles as detached templates: applying a profile copies policy; later profile edit/rename/delete changes zero existing Workspaces.
- Removes the old public `workspace profile set`, `workspace tool allow|deny`, `workspace command allow|deny`, and `workspace permissions show` management forms in favor of the converged CRUD/TUI model.
- Uses `--access-profile <name>` for Workspace add/edit automation, keeping internal compatibility fields out of the public management model.
- Preserves generated Workspace ids, canonical duplicate-root rejection, nested-root support, and the invariant that a configured Worker always retains at least one Workspace.
- Adds dedicated human renderers for Workspace/Profile inventory and detail views, plus real packaged-CLI and PTY acceptance coverage.
- Repairs Traditional Chinese README encoding and extends the one-shot interactive onboarding series with a real Workspace Management recording.

### Runtime and security

- Public MCP Rev 4 is unchanged. Workspace policy remains Worker-authoritative and atomically validated.
- Profile lifecycle operations do not broaden or silently mutate Workspace authority.
- Existing Gateway OAuth, enrollment, Extension attachment, and fail-closed runtime boundaries are unchanged.

## 0.8.5 - 2026-08-30

README localization and cross-platform command documentation patch.

### Highlights

- Documents `queqiao` as the canonical executable across Windows, WSL, Linux, and macOS instead of exposing the Windows-only `.cmd` shim.
- Adds a full Traditional Chinese README with an English / Traditional Chinese language switch while preserving the same onboarding commands and real PTY visuals.
- Includes `README.zh-TW.md` in the published npm package and adds regression coverage that prevents the two README variants from drifting.

## 0.8.4 - 2026-08-30

Shell completion usability release.

### Highlights

- Adds `queqiao completion bash`, `queqiao completion zsh`, and `queqiao completion powershell`.
- Generates command hierarchy and flag completion directly from `CLI_LEAF_CONTRACTS`, avoiding a second hand-maintained CLI definition.
- Supports native PowerShell, Bash, and Zsh adapters with profile-friendly setup commands.
- Keeps completion side-effect free: v0.8.4 does not query Gateway, Worker, Workspace, or Extension runtime state while completing values.
- Adds packaged acceptance plus canonical-contract coverage so every public CLI leaf remains represented in completion.
## 0.8.3 - 2026-08-30

Gateway connector handoff and onboarding patch.

### Highlights

- Adds `queqiao gateway info` with the existing named-Gateway selector semantics.
- Adds `--detail`, `--copy-url`, and `--copy-secret` for local MCP connector setup. The default view does not reveal the approval secret; copy actions never echo copied secret material.
- Adds packaged acceptance and human-presentation coverage for MCP URL derivation, explicit secret reveal, and clipboard actions.
- Adds a real PTY Gateway-info onboarding recording and updates the README/CLI/operator docs to show the connector handoff immediately after Gateway setup.

### Security

- The approval secret remains stored only in the Gateway private runtime secret file.
- `--detail` is an explicit local reveal and should not be pasted into logs or issue reports.
- `--copy-secret` copies the secret without returning it in the command result.
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
- Introduces the Access Profile UX (`Reader`, `Editor`, saved profiles, or `Custom`) and the explicit Tools ? Commands model for Workspace authority while preserving the internal legacy capability ceiling.
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
