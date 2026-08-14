# ADR-0011: Worker registration, registry, liveness, and transport abstraction

- Status: Accepted
- Date: 2026-08-14
- Supersedes: ADR-0002 only for Worker connection/registration direction and channel-lifetime assumptions
- Refines: ADR-0007

## Context

Queqiao is intended to expose one public Gateway for a logical cluster while native Workers provide execution authority for Windows, WSL/Linux, and future environments. A normal personal installation should not require one Gateway per operating-system environment. Shadow/stable duplication is a development and release topology, not a required end-user cluster model.

The verified runtime currently uses Gateway-initiated loopback HTTP requests to statically configured Worker endpoints. ADR-0007 already established that this HTTP binding is an implementation of the Worker Protocol rather than the protocol boundary itself.

Before CLI setup, service lifecycle, and Dashboard management are expanded, the target Gateway/Worker relationship needs a stable contract that does not hard-code HTTP, gRPC, persistent TCP sessions, polling, or another transport strategy into routing and authority semantics.

## Decision

### One Gateway, native Workers

A logical Queqiao cluster has one public Gateway and zero or more native Workers.

The Gateway owns the public MCP/OAuth boundary, Worker discovery/routing, request budgets, liveness observation, and protocol compatibility checks. It remains operating-system independent and does not execute native Workspace operations.

Each Worker owns native execution for its environment and remains the final authority for Workspace, filesystem, process, tool, command, containment, cancellation, and related execution policy.

### Registration and invocation directions

Registration/discovery direction is:

```text
Worker -> Gateway
```

Logical invocation direction is:

```text
Client -> Gateway -> Worker -> Gateway -> Client
```

Registration direction does not define the lifetime or direction of an underlying TCP session. A transport may use request/response connections, connection reuse, a persistent channel, gRPC, or another implementation without changing the Worker Protocol semantics.

### Registration contract

A Worker registration contains only information required for identity, routing, compatibility, and transport selection:

```text
workerId
  stable Worker identity

environmentId
  routing/environment identity

transport
  transport descriptor

protocolVersion
  Worker Protocol compatibility version

capabilities
  supported Worker Protocol capabilities

instanceVersion (optional)
  Queqiao runtime/package version for diagnostics
```

Registration does not carry Workspace policy, command allowlists, filesystem roots, resource statistics, extension details, or health/doctor results. Those remain Worker-owned runtime state queried through explicit protocol capabilities when needed.

### Worker identity and authentication

`workerId` is a stable security identity and is distinct from `environmentId` and from its authentication credential.

The Gateway authenticates a Worker before accepting registration. Existing Worker credentials may evolve to support this model; registration must not turn an unauthenticated self-asserted `workerId` into trusted routing state.

A duplicate active `workerId` fails closed. A new registration must not silently replace another authenticated live Worker merely because it claims the same identity. Replacement/restart semantics require the previous registration to be demonstrably inactive or an explicit management action.

### Transport descriptor

The registration contract carries an abstract transport descriptor rather than a raw URL as the architectural contract.

Conceptually:

```text
transport:
  type: http
  ...HTTP transport-specific connection data
```

Future transport bindings may include `grpc` or other concrete implementations. The Worker Protocol, Gateway routing, Worker authority, and public MCP contract must not depend on a particular transport implementation.

The current loopback HTTP Worker API remains the first verified transport implementation. This ADR does not require an immediate migration to gRPC or another transport.

### Worker Registry

Runtime registrations are maintained in an in-memory Gateway Worker Registry.

Gateway restart clears runtime presence and Workers register again. Registration presence, current transport endpoint/session state, last liveness result, and negotiated capabilities are runtime state and are not persisted merely to recreate presence after restart.

Persistent management configuration may separately define allowed Worker identities, credentials, transport policy, and health-check policy. Runtime registration is not configuration.

### Liveness

No registration lease or Worker heartbeat lease is required.

The Gateway may perform configurable, low-frequency Worker liveness checks. Liveness checks answer only whether the Worker/Worker Protocol endpoint is alive and responsive. They must not perform Workspace scans, Git operations, shell execution, extension diagnostics, or other functional probes.

Health-check frequency and timeout are management configuration. Implementations must remain compatible with Queqiao Resource Safety requirements and must not introduce high-frequency idle polling or unbounded background work.

### Doctor and enhanced diagnostics

`health` and `doctor` are distinct concepts:

```text
health -> is the Worker alive?
doctor -> can the Worker and its native capabilities operate correctly?
```

A future Worker-native doctor capability may report filesystem, process runtime, Git, shell, Workspace/configuration, resource, or extension diagnostics. Doctor is an explicit enhanced protocol capability and is not required for basic liveness.

Gateway diagnostics must not reconstruct native functional tests by embedding operating-system-specific knowledge in the Gateway.

## Non-decisions

This ADR intentionally does not choose:

- persistent versus non-persistent TCP sessions;
- HTTP connection reuse policy;
- WebSocket versus HTTP/2 versus another stream mechanism;
- gRPC as the default transport;
- exact liveness interval defaults;
- the exact future doctor response schema;
- the exact number or sequencing of implementation/refactor phases.

Those decisions follow from implementation planning and measured requirements, not from the architectural role boundary.

## Consequences

- Normal multi-environment use needs one Gateway rather than one Gateway per OS environment.
- Worker discovery becomes Worker-initiated without forcing Worker invocation to become pull/poll based.
- Gateway routing depends on an abstract Worker transport rather than `fetch()`/HTTP URLs as permanent architecture.
- HTTP remains usable while a future gRPC experiment can be introduced behind the same transport boundary.
- Worker Protocol semantics remain independent from connection lifetime.
- No lease/heartbeat loop is required; liveness is Gateway-observed and configurable.
- Runtime registry state can remain memory-only and does not create idle disk-write pressure.
- Worker authority remains unchanged: registration and Gateway routing never replace Worker-side authorization.

## Migration rule

The current verified static loopback HTTP implementation remains valid historical and production behavior until replaced through separately planned and validated refactoring.

Implementation planning must start from this ADR and ADR-0007, inventory the current code against the target boundaries, and then determine the necessary refactor sequence. This ADR does not pre-commit Queqiao to a fixed number of refactor phases.
