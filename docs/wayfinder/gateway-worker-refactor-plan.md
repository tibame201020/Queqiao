# Gateway / Worker Architecture Refactor Plan

- Status: Planned
- Date: 2026-08-15
- Source of truth: ADR-0007, ADR-0011
- Scope: Internal Gateway/Worker architecture, enrollment, membership, transport, liveness, CLI lifecycle
- Public MCP contract: Must remain unchanged unless separately approved

## Goal

Refactor the verified static loopback-HTTP Gateway/Worker implementation into the ADR-0011 architecture without weakening Worker authority, Security Baseline v2, Resource Safety Baseline v1, or the current public MCP contract.

The target is:

```text
explicit CLI enrollment
        |
        v
Gateway-owned persistent Worker membership
        |
        v
runtime Worker Registry
        |
        v
transport abstraction
        |
        +--> HTTP (first implementation)
        +--> future gRPC / other transports
```

Logical execution remains:

```text
Client -> Gateway -> Worker -> Gateway -> Client
```

## Current implementation gaps

### G1 — HTTP is embedded in the Gateway Worker client

Current `apps/gateway/src/worker-client.ts` directly owns `fetch()`, HTTP URL construction, HTTP authentication headers, HTTP error mapping, handshake, and higher-level Worker operations.

Target: higher-level Worker routing depends on a transport-neutral Worker connection/client interface. HTTP becomes one transport adapter rather than the permanent routing contract.

### G2 — Worker membership is static Gateway config

Current Gateway configuration materializes `WorkerEndpointConfig { environmentId, url, token }`. `ReloadableWorkerRegistry` rebuilds clients from `config.yaml` / `environments` entries.

Target: successful explicit enrollment creates Gateway-owned persistent membership stored separately from the main declarative config. Runtime reachability and protocol negotiation are not persisted.

### G3 — `environment` currently conflates membership and configuration

Current CLI `environment add/remove/list` manages static endpoint URL + token-file entries. The same `environments` array is also used by extension-host validation.

Target: cluster membership is managed through Worker enrollment/registry semantics. Declarative extension configuration must not require static Worker endpoints to exist in main config merely to validate an environment reference.

### G4 — Worker has no stable `workerId`

Current Worker hello has `environmentId`, random startup `instanceId`, platform, protocol version, and capabilities.

Target: Worker has a stable security identity established during `worker setup`; runtime `instanceId` remains per-start. `environmentId` remains unique within one logical cluster.

### G5 — current capability semantics are mandatory-list checks

Current Gateway verifies every item in `QUEQIAO_WORKER_CAPABILITIES` is present.

Target: Worker Protocol version defines the mandatory contract. Runtime `capabilities` describe only optional Worker operations.

### G6 — there is no enrollment control plane

Current trust is pre-provisioned by manually/shared Worker token files.

Target: user explicitly requests one-time join token; `worker join` performs an atomic enrollment transaction, receives a provisional long-lived credential, stores it securely, confirms within 30 seconds, then Gateway verifies live Worker health/identity/protocol before committing membership.

### G7 — Gateway has no dedicated membership persistence store

Current atomic persistence infrastructure exists for user configuration, but Worker membership is not a separately owned Gateway state domain.

Target: secure, atomic Gateway-owned registry state separate from `config.yaml`. CLI manages it through Gateway management semantics rather than direct file editing.

### G8 — liveness is request-derived, not a registry state machine

Current Gateway health derives Worker online state by listing Worker workspaces and caches the result for five seconds. CLI doctor directly fetches configured Worker `/health` URLs.

Target: configurable low-frequency liveness probes answer only whether the Worker endpoint is alive. Reachability is advisory; real invocation may still retry an `unreachable` Worker and restore it to `reachable` on success.

### G9 — current health performs more work than target liveness

Gateway health currently calls `listEnvironments()`, which invokes Worker workspace listing and therefore combines liveness with functional/catalog discovery.

Target: health is minimal; functional Worker diagnostics belong to optional Worker-native `doctor` capabilities.

### G10 — startup, package, smoke, resource, and security fixtures assume static endpoints

`config.example.yaml`, CLI initialization, package integration scripts, startup scripts, cluster tests, security tests, and Resource Safety harness construct `environments: [{ environmentId, url, tokenFile }]` and assume pre-shared endpoint credentials.

Target: migration/compatibility fixtures must preserve stable acceptance while new enrollment/membership paths are introduced and then cut over.

## Dependency DAG

```text
A. Transport-neutral contracts + HTTP adapter seam
       |
       +----------------------+
       |                      |
       v                      v
B. Stable Worker identity   C. Gateway membership store
       |                      |
       +-----------+----------+
                   v
D. Enrollment transaction + CLI lifecycle
                   |
                   v
E. Registry/routing cutover + protocol negotiation
                   |
                   v
F. Liveness / doctor separation
                   |
                   v
G. Legacy static-endpoint removal + final acceptance
```

Cross-cutting gates apply to every step:

```text
Worker authority
Security Baseline
Resource Safety
public MCP schema stability
rollback / migration safety
```

## Refactor stages

The code dependencies naturally support **six implementation stages plus final cleanup/acceptance**. These stages are planning units, not separate public releases; adjacent stages may share a branch/PR only if validation remains independently attributable.

### Stage 1 — Transport seam, behavior preserving

**Classification:** behavior-preserving internal refactor.

Introduce transport-neutral Gateway-side Worker invocation abstractions and move current HTTP details behind an HTTP transport implementation.

Expected changes:

- define transport descriptor schemas/types;
- introduce a Worker transport interface for handshake, health, invocation, cancellation propagation, and bounded errors;
- implement current HTTP behavior as `HttpWorkerTransport` (name illustrative, not contractual);
- remove direct `fetch()`/URL/header assumptions from routing/registry code;
- keep current static `WorkerEndpointConfig` as a compatibility source;
- preserve current Worker Protocol 2.0 behavior and public MCP schema.

Validation:

- existing Worker client/registry tests remain equivalent;
- full typecheck/test/security/cluster gates;
- Resource Safety baseline;
- no public tool/schema/fingerprint drift.

### Stage 2 — Worker identity and membership-store foundation

**Classification:** internal state-model change; no enrollment cutover yet.

Expected changes:

- add stable `workerId` to Worker local setup/config model;
- create secure Gateway-owned atomic Worker membership store separate from main `config.yaml`;
- membership record contains only `workerId`, unique `environmentId`, fixed transport descriptor, and credential reference(s);
- runtime registry state contains instance/protocol/capabilities/reachability only in memory;
- prepare secure credential-reference representation that can later support temporary old/new credential overlap;
- add explicit migration tooling for existing trusted static `environments` entries rather than silently changing production trust state.

Migration rule:

Existing installed environments are already trusted by the verified deployment. Migration may convert them into membership records through an explicit CLI migration command with dry-run/execute semantics. It must not require re-enrollment merely to upgrade an existing accepted installation.

Validation:

- atomic-write interruption tests;
- Windows ACL / Linux permission tests for registry and Worker credentials;
- duplicate `workerId` and duplicate `environmentId` fail closed;
- migration idempotence + rollback evidence;
- Security and Resource gates.

### Stage 3 — Explicit enrollment and CLI lifecycle

**Classification:** new internal management capability; security-sensitive contract addition.

Expected CLI semantics:

```text
queqiao gateway setup
queqiao worker setup
queqiao gateway join-token [expiry/options]
queqiao worker join ...
queqiao worker list/remove/update ...
```

No generic `queqiao setup` and no initial Windows/WSL/VM-specific bootstrap sugar.

Join-token requirements:

- explicit user creation only;
- one-time use;
- default expiry plus optional user-selected expiry;
- multiple simultaneous tokens allowed;
- optional, never mandatory, `workerId` / `environmentId` binding;
- memory-only; Gateway restart invalidates unused tokens;
- token is consumed once a join transaction starts;
- token values never enter durable logs/audit state.

Atomic join transaction:

1. validate join token and proposed identity/environment/transport;
2. issue provisional long-lived Worker credential;
3. Worker CLI securely persists credential;
4. Worker confirms within fixed 30 seconds;
5. Gateway performs real health + identity + Worker Protocol handshake;
6. Gateway atomically commits persistent membership;
7. any failure invalidates provisional credential, leaves no membership, and Worker CLI removes local provisional credential.

Management transport implementation is intentionally not frozen by ADR-0011. It must, however, remain outside the public MCP contract, be local-admin-only for privileged management actions, and preserve the Gateway security boundary. The Worker enrollment request may be remotely reachable only through the explicit one-time join-token authority and must receive dedicated adversarial review/rate limiting.

Validation:

- join-token replay/expiry/concurrency tests;
- optional binding tests proving unbound token remains valid default behavior;
- 30-second provisional timeout tests;
- crash/failure injection at every transaction boundary;
- orphan credential cleanup;
- management authorization tests;
- no secret logging;
- new adversarial Security gate before promotion.

### Stage 4 — Worker Protocol identity and registry routing cutover

**Classification:** private Worker Protocol evolution + routing-source change; public MCP unchanged.

Expected changes:

- evolve Worker hello/handshake to include stable `workerId` and runtime `instanceId` distinctly;
- Worker Protocol mandatory functionality becomes version-owned;
- `capabilities` becomes optional-operation advertisement only;
- incompatible live Worker Protocol fails closed for usability/routing;
- Gateway runtime registry is materialized from persistent membership plus live negotiation state;
- routing constructs the selected transport from the persisted transport descriptor;
- transport descriptor remains fixed until explicit management update;
- an active duplicate `workerId` fails closed; unreachable same-identity replacement follows ADR-0011 rules;
- main `config.yaml` static endpoint entries cease to be the authoritative runtime routing source.

Because Worker hello semantics change materially, this stage should use a new Worker Protocol version rather than silently redefining `2.0`. The exact next version is selected during implementation, with an explicit compatibility window if rolling upgrade requires it.

Validation:

- identity mismatch/adversarial replacement tests;
- protocol-version compatibility matrix;
- optional-capability absence does not reject an otherwise compatible Worker;
- workspace ambiguity remains fail closed;
- current 17-tool deployment/public MCP acceptance remains unchanged.

### Stage 5 — Liveness and diagnostics separation

**Classification:** runtime behavior enhancement; public MCP unchanged.

Expected changes:

- add one Gateway-owned configurable low-frequency liveness scheduler rather than per-Worker busy loops;
- health probe checks only Worker endpoint/protocol aliveness;
- maintain runtime `reachable` / `unreachable` state in memory;
- health failure is advisory and does not permanently veto a real invocation;
- successful invocation restores reachability;
- Gateway `/health` projects safe liveness state without triggering workspace scans;
- CLI doctor may request optional Worker-native functional diagnostics when supported;
- Gateway does not implement OS-native doctor checks itself.

Validation:

- no high-frequency polling;
- no idle log growth;
- Resource Safety idle CPU/write/memory budgets remain green;
- health failure/recovery race tests;
- invocation-after-health-failure success test;
- doctor absent/present optional-capability tests.

### Stage 6 — Config/CLI/domain cleanup and legacy migration completion

**Classification:** removal of compatibility path after cutover evidence.

Expected changes:

- retire `WorkerEndpointConfig` and static endpoint reload registry;
- remove/deprecate `environment add --url --token-file` semantics in favor of Worker membership CLI;
- update extension host validation so it does not require static `environments` endpoint entries in main config;
- update `config.example.yaml`, README, package fixtures, startup scripts, smoke tests, migration helpers, and operations diagnostics;
- preserve Workspace authority separation and Worker-native configuration ownership;
- remove legacy HTTP-specific names from protocol contracts where they incorrectly imply protocol identity, while keeping HTTP adapter implementation explicit.

Validation:

- fresh install path;
- existing-install migration path;
- removal + re-enrollment path;
- package integration Windows/Ubuntu;
- no stale static endpoint references outside explicit migration compatibility code.

### Stage 7 — Shadow production acceptance and promotion

**Classification:** release gate, not feature implementation.

Required before stable promotion:

- full tests/typecheck;
- adversarial Security gate including enrollment and registry persistence;
- dependency audit;
- Resource Safety baseline + soak on Windows/Ubuntu;
- package/distribution integration;
- Worker Protocol compatibility/negative matrix;
- atomic join fault-injection matrix;
- multi-environment Windows/WSL Shadow acceptance;
- OAuth/session persistence;
- public MCP manifest/tool count/fingerprint acceptance;
- stable promotion only after explicit approval.

## Security invariants during refactor

1. Worker remains final execution authority.
2. Enrollment proves cluster membership, not Workspace authority.
3. Join token is not a Worker operating credential.
4. Join token is memory-only and never durably logged.
5. Provisional credentials cannot survive a failed join as usable cluster credentials.
6. Main config and Gateway-owned registry have separate ownership.
7. CLI management cannot bypass Gateway membership validation by editing registry files directly.
8. Transport abstraction does not relax Security Baseline v2 loopback-only production transport. Any non-loopback transport requires a separately reviewed security baseline.
9. Public MCP OAuth remains connector authentication and does not become Worker-management authorization.
10. Public MCP schema remains stable throughout this refactor unless separately approved.

## Resource-safety invariants during refactor

1. No Worker heartbeat/lease loop.
2. No registration refresh loop.
3. One bounded Gateway liveness scheduler, configurable and low-frequency.
4. No registry writes on health checks or ordinary invocation success/failure.
5. Registry writes occur only on explicit membership management/commit operations.
6. Join tokens and provisional transaction state are memory-only and bounded by expiry/30-second confirmation timeout.
7. Resource Safety Baseline v1 remains a required PR/main gate.

## Files/code boundaries expected to change

Primary:

- `packages/worker-protocol`
- `packages/contracts`
- `packages/config`
- `apps/gateway/src/worker-client.ts`
- `apps/gateway/src/worker-registry.ts`
- `apps/gateway/src/worker-registry-config.ts` (compatibility then removal)
- `apps/gateway/src/config.ts`
- `apps/gateway/src/app.ts`
- `apps/worker/src/app.ts`
- `apps/worker/src/index.ts`
- `apps/cli/src/index.ts`
- new Gateway membership/enrollment/transport modules

Cross-cutting fixtures:

- Gateway/Worker tests
- CLI migration/security tests
- `config.example.yaml`
- startup/smoke/package integration scripts
- Resource Safety harness
- Security/cluster workflows and acceptance docs

## Completion criterion

The refactor is complete when:

```text
main config no longer owns live Worker endpoints
+ explicit worker setup/join establishes membership
+ Gateway-owned registry survives Gateway restart
+ runtime protocol/capabilities/reachability are renegotiated live
+ Gateway routing is transport-neutral
+ HTTP is one adapter, not architectural identity
+ health is minimal and advisory
+ Worker authority/security/resource baselines remain green
+ public MCP contract remains accepted
```
