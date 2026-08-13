# Architecture Decisions — Secure Agent Substrate

This file is the detailed resolution archive for the Wayfinder map. Each decision is recorded once here; MAP.md links to these sections at low resolution.

## D1 — Product boundary

**Decision:** Queqiao is a production-grade secure agent substrate / remote capability bridge, not another coding-agent runtime.

Queqiao supplies secured capabilities to external agent clients. Model selection, chat/session state, context compaction, prompt/UI concerns, and agent reasoning remain client responsibilities.

## D2 — Extension public-tool model

**Decision:** Use explicit manifest extensions.

Extensions may contribute typed public tools. Enabling/disabling an extension that changes the public tool schema changes the resolved deployment manifest and may require client connector migration. Internal hooks or implementation changes that do not alter public schemas remain distinct from manifest changes.

Do not hide extension capabilities behind one generic untyped dispatcher.

## D3 — Client protocol boundary

**Decision:** Protocol-neutral Core plus a first-class MCP adapter.

Tool runtime, policy, security, workspace, and execution domain contracts must not depend on MCP SDK result/content types. MCP-specific transport, protocol-version compatibility, manifest serialization, and result mapping live at the adapter boundary.

Do not build a speculative universal-protocol framework before another concrete protocol requires it.

## D4 — MCP transport

**Decision:** Remote HTTP(S) MCP only.

Queqiao exists to bridge clients to controlled native environments through the secured Gateway. A local CLI agent may still connect to Queqiao over HTTP(S); no stdio mode is required. Supporting stdio would add a second transport/security lifecycle without advancing the product goal.

## D5 — MCP compatibility

**Decision:** Maintain a bounded MCP specification compatibility window.

The MCP adapter owns compatibility with an explicit finite set/range of protocol revisions. Core domain packages and Worker semantics must not depend on an upstream MCP revision. Exact supported revisions are selected and tested in a feature ticket against current upstream SDK/spec support.

## D6 — Protocol bounded contexts

**Decision:** Separate domain contracts, Worker protocol, and MCP adapter concerns.

Target conceptual boundaries:

- domain/contracts: stable Queqiao identifiers and transport-neutral domain contracts;
- worker-protocol: Gateway↔Worker hello/capabilities/invocation/cancellation/version negotiation;
- MCP adapter: MCP protocol revisions, HTTP transport, manifest mapping, MCP authorization integration, and result mapping.

Do not confuse Queqiao release version, Core Manifest Revision, Deployment Manifest Fingerprint, Worker Protocol Version, and MCP Specification Revision.

## D7 — Workspace model

**Decision:** Workspace is an authority boundary, not a repository identity.

A broad Workspace may contain zero, one, or many repositories plus ordinary files/directories. Repository and Worktree are domain concepts supplied by a Git extension rather than mandatory Core entities.

## D8 — Worktree placement

**Decision:** Any worktree created through Queqiao must remain inside the existing Workspace authority boundary.

Repository/worktree operations may not create new filesystem authority. External worktree roots are out of scope for this effort.

## D9 — Core versus extension authority

**Decision:** Core owns authority-bearing primitives; extensions own domain semantics.

Core is responsible for bounded filesystem/process capabilities, policy enforcement, containment, cancellation/limits, and Worker-authoritative checks. Extensions compose these capabilities into Git, Docker, project-context, skills, or other domain behavior.

An extension must never gain request authority beyond the Core/Worker policy ceiling.

## D10 — Extension composition

**Decision:** Extensions may register, extend, and explicitly replace tools.

- register: add a new typed tool;
- extend: add explicit before/after/wrapping behavior to an existing tool;
- replace: explicitly replace an implementation while preserving the declared tool contract unless an intentional public manifest revision changes that contract.

Silent overrides remain forbidden.

The security/policy envelope is outside the replaceable implementation. Replacing a tool must not replace Worker authority, containment, or other mandatory policy checks.

## D11 — Extension ordering and conflicts

**Decision:** Explicit deterministic dependency/order graph.

Rules:

1. Never use implicit load order as semantic precedence.
2. Extension ordering is expressed as an explicit dependency/order graph.
3. Cycles fail closed.
4. Missing required dependencies fail closed.
5. A tool may have at most one active replacement in a resolved deployment/scope.
6. Multiple active replacements for the same tool fail closed; priority does not choose a winner.
7. Tool contract/schema incompatibility is an explicit manifest change, not a hidden replacement.
8. Composition must be explainable through runtime diagnostics.

CLI doctor and the future Dashboard must expose resolved implementations, extension chain/order, conflicts, failures, activation scope, and replacement ownership. Users must not need to reconstruct composition by searching logs.

## D12 — Extension loading and scope

**Decision:** Explicit install plus scoped activation.

Model:

Extension Package → Installed Extension → Host Binding (Gateway or Worker) → Activation Scope (global or selected Workspaces).

Public MCP schema is deployment-level. Workspace activation/policy controls whether a public tool is effective for a selected Workspace; switching Workspaces must not dynamically mutate the client-visible MCP manifest.

Repository content must never implicitly install, load, enable, or grant authority to extension code.

## D13 — Extension trust

**Decision:** v1 extensions are explicitly installed, trusted local, in-process TypeScript code.

Queqiao validates extension manifests, composition, host/environment compatibility, and the Queqiao capability/policy path. It does not claim to determine whether arbitrary third-party code is benign.

Supply-chain governance belongs to administrator trust and, if a community Hub/registry exists later, the Hub's publication/review/provenance process. Isolated extension hosts/sandboxing are a future architecture milestone.

## D14 — Manifest lifecycle

**Decision:** Core Manifest Revision + Deployment Manifest Fingerprint.

The Core Manifest Revision versions the bundled public Core tool contract. The resolved deployment manifest combines Core plus enabled public-tool extensions and is deterministically fingerprinted.

CLI diagnostics and the future Dashboard must expose at least:

- Queqiao release version;
- Core Manifest Revision;
- active public extensions and versions;
- Deployment Manifest Fingerprint;
- Worker Protocol Version;
- supported MCP revision window;
- whether configured/client connector state is stale when that state can be known.

## D15 — Discovery boundary

**Decision:** Primitive Core plus extension-owned discovery/interpretation.

Core provides safe bounded primitives such as list/search/read/path containment and authority-preserving capability APIs. Core does not assign special project semantics to `.git`, `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `package.json`, `pom.xml`, or similar markers.

Examples of extension/client responsibilities:

- Git extension: repository/worktree discovery and Git semantics;
- context extension/client: AGENTS/CLAUDE/project instruction discovery and interpretation;
- skills extension/client: SKILL.md discovery and interpretation;
- project detector extension: framework/build marker interpretation.

The current `workspace discover` behavior that searches for `.git` repositories and promotes them as Workspace candidates conflicts with this model and requires migration/re-design.

## D16 — Async execution

**Decision:** `run` and `shell` each expose `mode: sync | async`; sync and async are execution modes of the same Core primitives.

Public contract stability must not force semantically inferior duplicate tools. Revision 4 remains historical/frozen evidence; an intentional later Core Manifest Revision may evolve the `run`/`shell` schema.

Sync mode preserves request-bound execution: result includes exit/output information and request cancellation terminates the process tree.

Async mode starts a bounded native process and returns after successful acceptance/start. It does not introduce a Job domain.

## D17 — Execution backend

**Decision:** Native Worker process runtime.

Evolve the existing native process runtime so it can support both synchronous collection and asynchronous start/detach semantics while preserving platform-native process-tree handling, resource limits, minimal environment, and Worker authority.

Core must not depend on tmux. Interactive terminal/session semantics such as tmux may be added later through extensions.

## D18 — Async disconnect semantics

**Decision:** Once an async `run`/`shell` invocation is accepted by the Worker, the spawned process is no longer tied to the initiating MCP/HTTP request lifecycle.

Expected behavior:

- client/Funnel/tunnel disconnect does not terminate an accepted async process;
- temporary Gateway disconnect does not terminate it;
- process lifetime remains bounded by configured execution limits and OS/process semantics;
- Worker shutdown/crash/restart recovery is not guaranteed and no durable JobStore/reconciliation layer is required;
- the client may use native OS tooling through existing `run`/`shell` primitives to inspect or terminate background processes;
- async stdout/stderr handling is defined at feature level (for example discard or safe workspace-relative redirection), not through `job_output` APIs.

Explicitly excluded: `job_start`, `job_status`, `job_list`, `job_output`, `job_cancel`, durable job persistence, process reattachment, and distributed job-queue semantics.
