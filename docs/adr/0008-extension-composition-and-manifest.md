# ADR-0008: Deterministic extension composition and deployment manifest

- Status: Accepted
- Date: 2026-08-13
- Refines and partially supersedes: ADR-0004

## Context

ADR-0004 established a transport-neutral TypeScript extension runtime with unique tool registration, ordered hooks, explicit local configuration, and no remote marketplace. That baseline intentionally prohibited silent tool overrides.

The secure-agent-substrate design now needs extensions to do more than add globally unique tools. A trusted local extension must be able to add a tool, deliberately wrap an existing tool, or deliberately replace an implementation while Queqiao keeps the security/policy ceiling outside replaceable extension code.

The public schema seen by an MCP client is also no longer described completely by a Core-only manifest revision once configured extensions can contribute public tools.

## Decision

### Extension trust and loading

Version 1 extensions are explicitly installed, trusted local, in-process TypeScript modules. Repository content never implicitly installs, loads, enables, or grants authority to extension code.

Each installed extension declares a stable identity/version and is bound to an execution host: Gateway or a native Worker. Activation can be global or limited to selected Workspaces.

Queqiao validates manifest shape, host/environment compatibility, composition, and use of the Queqiao capability/policy path. It does not claim to determine whether arbitrary third-party code is benign. Package provenance, publication review, and future Hub governance are administrator/supply-chain concerns.

### Tool composition

Extensions may participate in a tool in three explicit ways:

- **register** — add a new typed public or internal tool;
- **extend** — add declared before/after/wrapping behavior to a selected tool;
- **replace** — deliberately replace a selected implementation.

Silent override remains forbidden.

Composition uses an explicit deterministic dependency/order DAG. Config iteration order or module load order is never semantic precedence. Cycles and missing required dependencies fail closed.

At most one active replacement may own a tool in a resolved scope. Multiple active replacements for the same tool fail closed; numeric priority or load order does not choose a winner.

A replacement preserves the declared tool contract unless an intentional public manifest revision changes that contract.

### Authority ceiling

Worker-side authorization, Workspace containment, profile/tool policy, command policy, process limits, cancellation, and other mandatory Core security checks are outside the replaceable implementation.

An extension or replacement can consume only capabilities that pass through the authoritative Queqiao policy path. Gateway-hosted extensions cannot acquire native Workspace filesystem/process authority by bypassing Workers.

### Deployment-level public manifest

The **Core Manifest Revision** versions the bundled Core public tool contract.

The effective public schema served by a deployment is the deterministic composition of Core plus enabled public-tool extensions and is represented by a **Deployment Manifest Fingerprint**.

Workspace activation affects whether a public capability is effective for a selected Workspace. Switching Workspaces does not dynamically mutate the client-visible public MCP manifest.

Enabling/disabling an extension or changing a public tool schema may therefore require a new client connector binding even when the Core Manifest Revision itself has not changed.

### Explainability

Composition state must be generated from runtime truth rather than reconstructed from logs. The shared diagnostics model must be able to explain:

- installed, loaded, active, and failed extensions;
- host binding and Workspace activation scope;
- resolved tool implementation;
- replacement owner;
- extender chain/order;
- dependency, cycle, schema, host, capability, and activation failures;
- Core Manifest Revision and Deployment Manifest Fingerprint.

CLI diagnostics and the future Dashboard consume the same semantic model.

## Consequences

- ADR-0004's prohibition on silent override remains valid, while its unique-registration-only composition model is superseded by explicit extend/replace semantics.
- Public tool changes are intentional deployment-manifest events instead of hidden implementation changes.
- Extensions can recover domain ergonomics such as Git/worktree behavior without collapsing those concepts into Core.
- In-process extensions remain highly trusted code; sandboxing or an isolated extension host requires a later architecture decision.
- Marketplace/Hub implementation and runtime malware scanning remain out of scope for this milestone.
