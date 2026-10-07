# ADR-0015: Provider-neutral Runtime Lease lifecycle

- Status: Accepted
- Date: 2026-10-08
- Refines: ADR-0011
- Related: ADR-0010
- Public MCP contract: unchanged

## Context

Worker Job v1 keeps process work alive after the initiating MCP request returns, but only inside an already-running Worker and only for that Worker lifetime. Worker enrollment and Gateway liveness answer a different question: which Worker identity is trusted, and whether that enrolled Worker is currently reachable.

Queqiao also needs a lifecycle contract for disposable execution runtimes that may be created on demand and destroyed after a bounded TTL. Runtime provisioning may later be implemented by GitHub Actions, a local launcher, a hosted runtime, or another provider. Those provider APIs and credentials must not become Core lifecycle semantics.

## Decision

### Runtime Lease is a separate bounded context

`@queqiao/runtime-control` owns a provider-neutral Runtime Lease contract. A lease moves through:

`requested -> provisioning -> registered -> ready -> running -> completed|failed`

An active lease may instead become `expired` when its TTL is reached. `completed`, `failed`, and `expired` require explicit `disposed` cleanup.

This lease is not a Worker heartbeat lease. ADR-0011 liveness remains observational and does not require Worker lease renewal.

### Worker binding follows provisioning

A provider may create infrastructure while a lease is `provisioning`. Once one Worker identity is enrolled/registered for that runtime, the lease binds to its stable `workerId + environmentId` and moves to `registered`.

Repeating the same Worker binding is idempotent. Replacing a bound Worker identity inside the same lease is rejected.

### Terminal handling is deterministic

Duplicate application of the same terminal outcome is idempotent. A conflicting terminal outcome is rejected. Disposal is explicit and idempotent so provider cleanup can be retried safely.

TTL expiry is evaluated against the lease timestamp; it does not silently remove provider resources.

### Providers remain outside Core semantics

A Runtime Provider exposes only:

- a provider identifier;
- `provision` with lease ID, TTL, and bounded non-secret metadata;
- `dispose` with lease ID, opaque provider reference, and terminal reason.

Provider credentials, SDK clients, workflow definitions, cloud region rules, and provider-specific retry logic stay behind the provider implementation. Core does not depend on GitHub Actions, Koyeb, Render, or any other provider API.

Provider references and metadata are opaque control-plane data. Metadata is bounded and rejects credential-like field names. Secrets must remain in platform/runtime secret storage and must not be persisted in Runtime Lease state.

### Persistence and public tools remain deferred

This ADR does not choose a Runtime Lease persistence backend. It also does not add a public MCP tool or change the Core Manifest. A later integration must decide how leases are stored, surfaced, reconciled with Gateway membership, and invoked by an authenticated client.

## Consequences

- Worker Job lifecycle and execution-runtime lifecycle remain independent.
- Provider changes do not require Core lifecycle changes when they satisfy the same Runtime Provider contract.
- Runtime cleanup can be retried without changing a completed terminal outcome.
- A future persistent Gateway can coordinate disposable Workers without becoming the compute runtime itself.
- The initial contract can be tested with a GitHub Actions-shaped provider while keeping all GitHub-specific fields and credentials outside Core.

## Validation

`packages/runtime-control/src/index.test.ts` covers lifecycle transitions, TTL expiry, idempotent terminal handling, Worker binding, metadata secret rejection, and a GitHub Actions-shaped provider boundary.
