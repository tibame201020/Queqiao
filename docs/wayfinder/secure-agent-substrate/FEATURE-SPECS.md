# Feature Specs — Secure Agent Substrate

These feature specs are the implementation handoff produced after the Wayfinder architecture route was resolved. They are not new Wayfinder decision tickets. Each feature must preserve the decisions in ARCHITECTURE-DECISIONS.md and the frozen Security Baseline.

## F1 — Protocol Boundary Refactor

### Goal

Make Queqiao Core transport/protocol-neutral while keeping MCP as the only first-class remote client protocol and keeping Gateway↔Worker protocol semantics independently versioned.

### Scope

- Separate transport-neutral identifiers/domain contracts from Gateway↔Worker wire contracts.
- Isolate MCP SDK usage in an MCP adapter boundary.
- Preserve current public behavior while package boundaries migrate.
- Establish explicit Worker Protocol Version ownership.
- Research and define the initial bounded MCP specification compatibility window against current upstream SDK/spec support.
- Implement/test the selected bounded compatibility window.

### Non-goals

- stdio MCP transport.
- Generic universal protocol framework.
- A second non-MCP protocol.

### Acceptance

- Core tool/runtime/policy/workspace/process packages do not import MCP SDK types.
- Worker protocol compatibility is versioned/tested independently of MCP protocol revision.
- MCP adapter contract tests cover every supported MCP revision in the selected window.
- Existing Revision 4 semantics continue to pass until the intentional next manifest revision is introduced.

## F2 — Extension Runtime v1

### Goal

Deliver an explicitly configured trusted local TypeScript extension system that can register, extend, or explicitly replace tools without bypassing Queqiao authority.

### Scope

- Extension configuration schema and loader.
- Explicit host binding: Gateway or native Worker.
- Activation scope: global or selected Workspaces.
- `registerTool`.
- tool-specific extend/wrapping hooks.
- explicit `replaceTool`.
- deterministic dependency/order DAG.
- unique replacement ownership.
- activation rollback/fail-closed startup on invalid composition.
- contract/schema compatibility checks.
- Core security/policy envelope remains outside replaceable implementation.

### Non-goals

- repository-local auto execution.
- extension marketplace/Hub.
- sandbox/isolated extension host.
- runtime malware adjudication.

### Acceptance

- At least one configured non-core extension is loaded in a production-shaped Gateway/Worker test.
- Multiple extenders resolve deterministically independent of config/load iteration order.
- cycles, missing required dependencies, duplicate active replacements, invalid host binding, and contract mismatch fail closed.
- replacement cannot bypass Worker profile/tool/path/process policy.
- public-tool changes feed the deployment-manifest model rather than silently changing the served schema.

## F3 — Manifest & Explainable Diagnostics

### Goal

Make the effective public tool graph and extension composition observable without log archaeology.

### Scope

- Core Manifest Revision as an explicit runtime datum.
- deterministic Deployment Manifest canonicalization/fingerprint.
- composition diagnostics model shared by CLI and future Dashboard.
- extension state: installed/loaded/active/failed.
- host binding and Workspace activation scope.
- resolved tool implementation, replacement owner, extender chain/order.
- dependency/cycle/schema/capability/activation errors.
- supported MCP revision window and Worker Protocol Version.
- CLI commands/concepts such as:
  - `queqiao doctor manifest show --gateway <name>`
  - `queqiao extension list`
  - `queqiao doctor extension`
  - `queqiao doctor tool explain <tool> --gateway <name>`
  - richer `queqiao doctor`

### Non-goals

- full Dashboard UI implementation in this feature.
- pretending Queqiao can always inspect a remote client application's cached connector fingerprint if the client does not expose it.

### Acceptance

- CLI and Dashboard-facing API consume the same diagnostics data model.
- a conflicting replacement or ordering cycle is visible with the affected tool and extension identities.
- manifest fingerprint is deterministic across process restart and configuration ordering.
- secrets, workspace roots where inappropriate, Worker tokens, OAuth tokens, and approval material never appear in public health or unsafe diagnostics output.

## F4 — Extension Core Capability API

### Goal

Let extensions build domain semantics from safe Core capabilities instead of reimplementing workspace/process security.

### Scope

- capability API for bounded Workspace filesystem operations.
- authority-preserving contained-path resolution/mutation primitives where needed.
- native process invocation capability routed through Worker policy.
- capability metadata available to extension activation/composition validation.
- same authoritative path/tool/profile/process checks as Core public tools.

### Non-goals

- project/repository/AGENTS/skills interpretation in Core.
- arbitrary raw host filesystem/process access through the Queqiao request path.

### Acceptance

- a Worker extension can perform a bounded filesystem operation only through a selected authorized Workspace.
- symlink/junction escape protections and size/time/process limits remain equivalent to Core tools.
- extension capability cannot exceed the invoking Workspace/policy ceiling.

## F5 — Async Execution Modes for `run` / `shell`

### Goal

Remove synchronous request timeout as the limiting factor for long-running/background processes while keeping `run` and `shell` as the same Core primitives with `mode: sync | async`.

### Scope

- evolve `run` schema to include `mode`.
- evolve `shell` schema to include `mode`.
- preserve Revision 4 sync semantics under `mode: sync`.
- async start returns immediately after Worker acceptance/start with native process identity/metadata.
- async process lifetime is detached from initiating MCP request after acceptance.
- bounded maximum async process lifetime and concurrency/resource controls.
- define safe stdout/stderr behavior for async mode, including workspace-relative redirection if supported.
- graceful Worker shutdown semantics for processes still tracked by that Worker.

### Non-goals

- Job IDs/domain/API.
- durable process recovery.
- process reattachment after Worker restart/crash.
- tmux dependency.
- OS-independent wrappers for `ps`, `Get-Process`, `kill`, `Stop-Process`, etc.; clients can use native `run`/`shell` syntax.

### Acceptance

- sync request cancellation still terminates its process tree.
- after async start is accepted, aborting the initiating MCP request does not terminate the process.
- Funnel/client/Gateway request interruption does not terminate an already accepted async process while the Worker/process remain alive.
- async execution remains bounded by configured Worker limits.
- Windows and WSL/Linux acceptance tests cover native behavior.
- the intentional `run`/`shell` schema evolution is recorded as a new Core Manifest Revision rather than rewriting Revision 4 evidence.

## F6 — Workspace Authority Model Migration

### Goal

Remove the legacy assumption that a Git repository is a Workspace candidate and align CLI/config terminology with Workspace = explicit authority boundary.

### Scope

- audit current discovery-root / `.git`-based `workspace discover` behavior.
- redesign or deprecate the command so Workspace approval/creation is not semantically tied to Git.
- preserve explicit admin-controlled authority grants and atomic validated config updates.
- provide a documented migration path for current users/configuration.

### Non-goals

- moving Git repository discovery into Core.
- automatically granting a discovered directory as a Workspace.

### Acceptance

- Workspace creation/approval no longer requires `.git` semantics.
- no migration can silently broaden filesystem authority.
- legacy config behavior has explicit compatibility/deprecation coverage.
- relevant CLI/security tests cover non-repository Workspace roots.

## F7 — First-party Git Extension v1

### Goal

Prove the extension architecture with a useful domain extension and recover/improve the cowork ergonomics seen in coding-agent workspace tools without collapsing Repository into Workspace.

### Scope

- discover Git repositories inside an authorized Workspace using Core capability APIs.
- identify main/linked worktrees.
- status/diff/log/branch-oriented read operations.
- create/remove contained worktrees.
- worktree targets must remain inside the selected Workspace authority boundary.
- define first-party extension configuration and public-tool manifest contribution.

### Non-goals

- arbitrary external worktree roots.
- hidden Workspace creation per repository/worktree.
- bypassing Core process/filesystem policy.
- complete Git porcelain coverage in v1.

### Acceptance

- one broad Workspace can expose zero/multiple repositories through the Git extension.
- repository/worktree identities remain extension-domain resources, not Core Workspace identities.
- attempted worktree creation outside the Workspace is rejected by Core/Worker containment.
- extension activation can be scoped to selected Workspaces.
- tools are visible in manifest diagnostics and their composition is explainable.

## F8 — Dashboard-ready Operations Contract

### Goal

Ensure future Dashboard implementation can present the same operational truth as CLI/doctor without inventing a parallel state model.

### Scope

Define a transport-neutral diagnostics/operations read model for:

- environments/Workers health;
- Workspaces and effective profiles/policy summaries;
- installed/active/failed extensions;
- tool composition graph and replacement ownership;
- manifest versions/fingerprint;
- MCP compatibility window;
- errors requiring administrator action.

### Non-goals

- Dashboard frontend implementation.
- exposing secrets or sensitive local paths through a public unauthenticated endpoint.

### Acceptance

- CLI doctor and a test Dashboard consumer can render equivalent semantic state from the same model.
- security/redaction tests prove the model has distinct authenticated/admin and public-health projections where required.
