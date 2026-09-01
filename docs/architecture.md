# Architecture

This document distinguishes the verified current runtime from the Secure Agent Substrate target boundaries. Target sections are architectural direction and must not be read as claims that every listed feature is already shipped.

## Current verified system context

```text
ChatGPT / MCP client
        |
        | HTTPS + OAuth + Streamable HTTP MCP
        v
Queqiao Gateway
        |
        | authenticated environment-local Worker requests
        +----------------------+----------------------+
                               |                      |
                        Windows Worker            WSL Worker
                               |                      |
                        Windows workspaces        Linux workspaces
```

Only the Gateway is publicly exposed. The currently verified Windows/WSL deployment uses loopback HTTP Worker endpoints on the same host. Each native Worker is authoritative for its own Workspace filesystem/process operations and validates delegated requests again.

The Worker boundary is intentionally independent from this current loopback transport. ADR-0011 now governs the implemented membership model: Worker membership is established explicitly through CLI-driven `worker join`, while logical invocation remains `Client -> Gateway -> Worker -> Gateway -> Client`. Worker runtime startup does not auto-register, and connection lifetime remains a transport concern.

Successful enrollment creates Gateway-owned persistent membership, stored separately from the user-managed main configuration. Persistent membership contains stable Worker identity, unique environment identity, a fixed transport descriptor, and credential references. Runtime reachability, instance identity, Worker Protocol version, optional capabilities, and transport-session state are negotiated live and are not persisted as authoritative membership data.

Enrollment uses an explicit one-time, memory-only join token and an atomic transaction: provisional credential issuance, secure Worker-side storage, confirmation within 30 seconds, and a real Gateway-to-Worker health/protocol handshake must all succeed before membership is committed. Failed transactions roll back membership and provisional credentials; an attempted join token remains consumed.

Gateway-observed liveness is configurable and low-frequency; no Worker lease/heartbeat lease is required. A failed health check marks observed reachability but does not permanently veto a real invocation attempt; a successful invocation can restore reachability. Functional `doctor` diagnostics are a separate optional Worker Protocol capability and are not part of basic liveness.

The transport descriptor is intentionally abstract and is fixed in persistent membership until an explicit management update changes it. Loopback HTTP is the current verified implementation; future bindings such as gRPC may be introduced without redefining Worker Protocol semantics, Gateway routing responsibilities, or Worker-authoritative execution policy.

The current development candidate is **Core Manifest Revision 7**. Revision 7 preserves the ten existing Core tools and adds one fixed public `extension` proxy tool:

- `workspace_info`
- `list_workspaces`
- `open_workspace`
- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `search_text`
- `run`
- `shell`
- `extension`

The first-party Git capability is externalized from the Worker and is no longer a bundled Worker dependency. When a compatible Git extension package is installed through the Extension Hub and attached, it contributes seven named tools: `git_repositories`, `git_status`, `git_diff`, `git_log`, `git_branches`, `git_worktree_create`, and `git_worktree_remove`. Registry and publishing policy are intentionally separate from this Core architecture freeze. Revision 7's fixed `extension` proxy remains the stable discovery/call surface for proxy-mode external extensions. `workspace_info` accepts an optional Workspace ID for explicit cross-environment inspection, and `list_workspaces` returns a safe deployment-attestation projection.

Historical Revision 4 and Revision 5 validation evidence remains authoritative for those contracts and is not rewritten by later revisions.

## Version axes

Queqiao uses distinct version dimensions. They must not be treated as aliases:

- **Queqiao release version** — the packaged product release.
- **Core Manifest Revision** — the bundled Core public tool contract.
- **Deployment Manifest Fingerprint** — the deterministic effective public manifest after configured public-tool extensions are composed. It is implemented and exposed through safe deployment diagnostics/attestation.
- **Worker Protocol Version** — Gateway-to-Worker compatibility/version ownership.
- **MCP specification revision window** — the finite set/range supported by the MCP adapter. The Secure Agent Substrate implementation explicitly pins `2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28`; deprecated 2024 transport revisions and unknown future revisions are not inherited from SDK defaults.

A change in one version dimension does not silently imply a change in another.

## Current module boundaries

### `apps/gateway`

Internet-facing composition root. It owns OAuth, the remote Streamable HTTP MCP adapter, public tool registration, Worker presence/routing, request budgets, cancellation propagation, and public security headers. The adapter supports both the selected 2025 legacy era and the `2026-07-28` modern era while mapping both to the same transport-neutral Queqiao tool runtime.

The Gateway MUST NOT perform native Workspace filesystem/process execution. MCP-specific construction, protocol-version handling, HTTP adaptation, and result/schema mapping are isolated at the Gateway adapter boundary; MCP SDK dependencies do not belong in Core/domain packages.

### `apps/worker`

Environment-local authoritative execution root. It loads native Workspace policy, exposes the current authenticated Worker HTTP API, validates delegated requests, and invokes bounded native Workspace/process capabilities.

A Worker MUST NOT rely on Gateway authorization alone and MUST NOT implement the public OAuth authorization server.

The current loopback HTTP API is the deployed Worker transport, not the permanent definition of the Worker protocol boundary.

### `apps/cli`

Administrative interface for validated/atomic configuration changes, migrations, diagnostics, explicit named runtime lifecycle (`serve [--bg]` / `stop` / `status`), Worker enrollment, Workspace authority management, permission inspection, and Extension Hub package/Worker attachment management. It does not install or manage OS services or autostart.

CLI/config changes do not by themselves mutate a client's cached public MCP tool schema.

### `packages/contracts`

Transport-neutral Queqiao domain contracts. It owns stable identifiers, Workspace/profile/tool policy value schemas, approval/assurance domain values, Workspace descriptors, and shared bounded mutation constants used by Core packages.

This package has no MCP SDK dependency and does not own Gateway-to-Worker transport/version semantics.

### `packages/worker-protocol`

Explicit Gateway-to-Worker protocol contract. It owns the Worker Protocol Version, the current `/v1` Worker HTTP API prefix, Worker capability negotiation, Worker hello validation, and shared invocation response typing.

The current HTTP route implementation remains in Gateway/Worker apps; the version/contract ownership is independent from MCP protocol revisions.

### `packages/protocol`

Compatibility facade retained during migration. It re-exports `@queqiao/contracts` and `@queqiao/worker-protocol`, including the legacy `QUEQIAO_PROTOCOL_VERSION` alias bound to the explicitly named Worker Protocol Version, plus historical v0 tool-contract exports.

New Core code must depend on the bounded-context package it actually needs instead of adding new direct dependencies on this compatibility facade.

### `packages/config`

Versioned runtime configuration schemas and migration contracts. Persistence and secret storage remain external adapters; runtime modules receive validated configuration.

Live machine configuration and secrets are not repository source.

### `packages/security`

Authentication/authorization-support primitives such as canonical request binding and step-up approval foundations. OAuth currently authenticates the MCP connector through `queqiao:access`; it does not grant Workspace authority.

Raw secrets/approval material must not be exposed through public tool results, public health, or ordinary diagnostics.

### `packages/policy`

Pure authorization decisions. Effective capability is bounded by Workspace profile, per-tool policy, command policy, and related security requirements.

Worker-side policy enforcement remains authoritative.

### `packages/tool-runtime`

Transport-neutral typed tool runtime and extension host. The current implementation supports typed registration, tool-specific `extend`/wrap/replace, deterministic dependency/order DAG composition, scoped activation, lifecycle sealing, input validation, and fail-closed conflict diagnostics.

Revision 7 adds a public external-extension SDK export at `@tibame201020/queqiao/extension`. Registry npm packages are validated into an environment-local Extension Hub, then explicitly attached to Workers. Attachment is execution intent; there is no separate enable/disable state. A running Worker hot-reloads attachment changes through generation-based ExtensionHost replacement with last-known-good fallback, request leases, and deferred `dispose()` of retired generations. The mandatory Workspace/profile/tool/process authority envelope executes outside extension implementations, so replacements and wrappers cannot increase authority. Public composition feeds the deterministic Deployment Manifest and diagnostics model.

### `packages/process-runtime`

Environment-native process execution with trusted executable resolution, bounded synchronous output, timeout/cancellation propagation, process-tree termination, minimal child environment, and shared per-Worker concurrency limits across synchronous and asynchronous execution.

`run` and `shell` support `mode: sync | async`. Sync remains request-bound. Async returns after native process acceptance with a native PID, keeps lifetime/concurrency policy authoritative, and discards stdout/stderr. It does not create a Queqiao Job domain or durable restart-recovery contract.

### `packages/workspace`

Implemented safe Workspace filesystem primitives. The package currently provides contained path resolution plus bounded read/list/search/write/edit behavior and is used by native Workers.

Workspace is an authority boundary. Repository/worktree/project-marker interpretation is not a required Core identity model; ADR-0009 moves those semantics to extensions/clients while preserving Core containment and bounded discovery primitives.

### Future/supporting runtime packages

Packages such as the following may be introduced when their implementation tickets require them:

- transport/channel abstraction for a future non-loopback Worker transport;
- observability/audit projection helpers;
- shared hostile-fixture/contract test utilities.

They must be introduced for concrete implementation needs rather than as speculative empty modules.

## Secure Agent Substrate target boundaries

The following sections describe the accepted target architecture and are implemented incrementally through `docs/wayfinder/secure-agent-substrate/TICKETS.md`.

### Protocol bounded contexts

Per ADR-0007, responsibilities converge on three explicit contexts:

```text
transport-neutral domain contracts
            |
            +--> Worker protocol contracts/version
            |
            +--> MCP adapter mapping/compatibility
```

Core runtime, policy, Workspace, process, and extension contracts must not depend on MCP SDK content/result types. MCP revision negotiation, Streamable HTTP specifics, public schema serialization, and OAuth/resource integration remain adapter concerns.

Remote HTTP(S) MCP remains the supported client transport. No local stdio MCP mode is introduced by this effort.

### Extension composition and authority

Per ADR-0008, explicitly installed trusted local TypeScript extensions can:

- register a typed tool;
- explicitly extend/wrap a selected tool;
- explicitly replace a selected implementation.

Composition is deterministic through an explicit dependency/order DAG. Cycles, missing required dependencies, duplicate active replacements, invalid host binding, and incompatible contracts fail closed.

The mandatory Worker authority envelope is outside replaceable extension implementations. Extensions cannot increase the invoking Workspace/profile/tool/process authority ceiling.

Public-tool composition produces a deterministic deployment-level manifest/fingerprint. Workspace activation affects capability effectiveness but does not mutate the client-visible manifest merely because a user selects another Workspace.

### Workspace authority versus domain discovery

Per ADR-0009:

```text
Workspace = explicit filesystem/process authority boundary
Repository / Worktree = Git extension resources inside that boundary
Project / AGENTS / Skill markers = extension or client interpretation
```

Discovery is not authorization. A discovered `.git` directory or project marker does not create or broaden a Workspace grant.

Any Queqiao-created Git worktree must remain within the selected Workspace authority boundary.

### Bounded asynchronous execution

Per ADR-0010, Core Manifest Revision 5 introduced `run` and `shell` with `mode: sync | async`; Revision 6 preserves that execution contract while making Workspace inspection explicitly targetable.

Sync retains request-bound cancellation semantics. Async detaches an accepted native process from the initiating MCP request while keeping Worker lifetime/concurrency/resource policy authoritative.

This does not introduce a Queqiao Job domain, durable JobStore, restart recovery guarantee, or Core tmux dependency.

## Security invariants

These apply to current and future implementations:

1. The Gateway never performs native Workspace filesystem/process execution.
2. A Worker never trusts authorization performed only by the Gateway.
3. MCP clients select configured Workspace IDs; they cannot grant themselves arbitrary filesystem roots.
4. Filesystem operations remain contained by canonical Workspace boundaries and must reject traversal/symlink/junction escape paths as applicable.
5. Core process execution remains bounded by profile/tool/command/cwd/timeout/concurrency/output/cancellation policy. Registered Extension execution is a separate trusted authority once Core `extension` access is granted; Worker helper APIs still preserve Workspace containment and process runtime bounds.
6. Enabling a high-risk tool such as `shell` requires explicit Workspace policy; blank normal allowlists do not implicitly grant it.
7. Installing and attaching an Extension explicitly expands the Worker trust boundary. Registered Extension capabilities are not re-authorized by Core `tools.allow`, profile, capability, or command policy; Core `extend`/`replace` contributions remain inside the invoked Core tool contract.
8. Runtime configuration, endpoint-specific data, tokens, signing material, approval secrets, generated state, and logs remain outside source control.
9. Public health and diagnostics expose only intentionally safe/redacted projections.
10. OAuth callback CSP must preserve validated ChatGPT redirect-origin support without broadening to arbitrary external origins.
11. Historical validation evidence is append-only: new behavior receives new evidence rather than retroactively changing old acceptance claims.

## Delivery and production acceptance

Secure Agent Substrate work follows `docs/wayfinder/secure-agent-substrate/VALIDATION-DELIVERY.md`.

The active development model is blue/green: the currently working stable Queqiao stack remains the collaboration/recovery path while candidate artifacts are built in a physically separate Git worktree and validated through a separate shadow Gateway + native Worker stack.

Candidate validation and promotion are separate states. A successful implementation/build does not automatically replace stable runtime artifacts.

Repository-level production checks for relevant slices include:

```text
npm run typecheck
npm test
npm run test:cli-setup
npm run test:security
npm run build:package
git diff --check
```

Security/release slices additionally run the applicable security gate, cluster/interoperability tests, and real-client Windows/WSL acceptance required by their tickets. The first-time CLI setup flow has dedicated Ubuntu/Windows GitHub Actions jobs and both checks are required by `main` branch protection.
