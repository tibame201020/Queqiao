# ADR-0011: Worker enrollment, registry, liveness, and transport abstraction

- Status: Accepted
- Date: 2026-08-14
- Amended: 2026-08-15
- Supersedes: ADR-0002 only for Worker connection/registration direction and channel-lifetime assumptions
- Refines: ADR-0007

## Context

Queqiao is intended to expose one public Gateway for a logical cluster while native Workers provide execution authority for Windows, WSL/Linux, virtual machines, and future environments. A normal installation should not require one Gateway per operating-system environment. Shadow/stable duplication is a development and release topology, not a required end-user cluster model.

The verified runtime currently uses Gateway-initiated loopback HTTP requests to statically configured Worker endpoints. ADR-0007 already established that this HTTP binding is an implementation of the Worker Protocol rather than the protocol boundary itself.

Before CLI setup, service lifecycle, and Dashboard management are expanded, the target Gateway/Worker relationship needs a stable contract that does not hard-code HTTP, gRPC, persistent TCP sessions, polling, or platform-specific setup shortcuts into routing and authority semantics.

## Decision

### One Gateway, native Workers

A logical Queqiao cluster has one public Gateway and zero or more native Workers.

The Gateway owns the public MCP/OAuth boundary, Worker membership/discovery/routing, request budgets, liveness observation, and Worker Protocol compatibility checks. It remains operating-system independent and does not execute native Workspace operations.

Each Worker owns native execution for its environment and remains the final authority for Workspace, filesystem, process, tool, command, containment, cancellation, and related execution policy.

Logical invocation remains:

```text
Client -> Gateway -> Worker -> Gateway -> Client
```

The direction or lifetime of an underlying TCP connection is a transport implementation concern. A transport may use request/response connections, connection reuse, a persistent channel, gRPC, or another implementation without changing Worker Protocol semantics.

### Enrollment is a management operation

Worker membership is established explicitly through CLI-driven enrollment rather than automatic runtime registration.

The management model is:

```text
queqiao gateway setup
queqiao worker setup
queqiao gateway join-token
queqiao worker join
```

`gateway setup` initializes the Gateway. `worker setup` initializes a Worker environment. Neither command implicitly enrolls another environment.

`worker join` is the explicit operation that adds a Worker to a Gateway. Worker runtime startup does not auto-register, re-register, poll for registration, or maintain a registration lease.

Queqiao does not initially add Windows/WSL/VM-specific setup sugar such as automatically invoking `wsl.exe`, scanning virtual machines, assuming SSH, or discovering remote Workers. Those conveniences may be added later without changing the enrollment contract.

### Join token

A Gateway creates join tokens only when the user explicitly requests one. Gateway setup does not pre-create enrollment authority.

A join token:

- is one-time-use;
- has a default expiry and allows the user to choose another expiry;
- may coexist with multiple other unused join tokens;
- may optionally be bound to an expected `workerId`, `environmentId`, or both;
- does not require either binding in the default CLI flow;
- is held only in Gateway memory and is not persisted;
- becomes invalid after successful use, attempted use that starts a join transaction, expiry, or Gateway restart;
- is distinct from the Worker's long-lived operating credential.

Join-token values are never written to durable audit history. Temporary observability may use debug/trace logging only and must not log the token itself.
For human-operated CLI enrollment, Queqiao may wrap the Gateway public base URL and one-time join token in a single versioned **join code** envelope. The current envelope is `qjq1:` plus base64url-encoded JSON containing `v`, `gateway`, `token`, and optional `expiresAt`. This is encoding, not encryption; the whole join code is bearer-secret material and must be handled like the token itself.

`gateway join-token --copy` copies the join code rather than the raw token and avoids echoing the raw token in normal stdout. Interactive `worker join` accepts one join code and derives the enrollment Gateway URL plus one-time token from it. Scripted `--gateway` + `--token` remains available for automation compatibility.

The join code carries only the **Worker CLI -> Gateway enrollment destination**. It does not carry, publish, or authorize the Gateway -> Worker runtime transport. The Worker continues to propose its own loopback-only transport descriptor independently, and the Gateway must still validate that transport before committing membership.

### Atomic Worker join transaction

`worker join` is an atomic enrollment transaction from the user's perspective: the Worker is either fully joined or not joined.

The sequence is:

```text
1. Worker CLI submits join request using a valid one-time join token.
2. Gateway validates the token and proposed Worker identity/environment/transport.
3. Gateway issues a provisional long-lived Worker credential.
4. Worker CLI securely stores that credential in the Worker's private secret storage.
5. Worker CLI confirms successful storage within 30 seconds.
6. Gateway performs a real health/Worker-Protocol handshake against the proposed Worker transport.
7. Only after successful transport reachability, identity, and protocol validation does Gateway commit persistent membership.
```

Any failure before final commit aborts the transaction:

- Gateway does not retain persistent membership;
- the provisional credential becomes invalid;
- Worker CLI removes any provisional credential it already stored;
- the join token remains consumed and cannot be reused.

The 30-second confirm window is fixed for this contract. A Worker unable to complete this bounded enrollment handshake is not accepted into the cluster.

### Worker identity

`workerId` is a stable Worker security identity. It is distinct from `environmentId` and from authentication credentials.

Within one logical Queqiao cluster, `environmentId` is unique. Queqiao does not currently define replicas, load balancing, placement, or multiple Workers sharing one environment identity. A future multi-node model requires a separate architectural decision rather than overloading `environmentId`.

A duplicate active `workerId` fails closed. A replacement for the same `workerId` is accepted only when the previous runtime instance is already considered unreachable and the new instance authenticates as that same Worker identity, or when an explicit management action authorizes replacement.

### Persistent membership versus runtime state

Successful enrollment is persisted by the Gateway so Gateway restart does not lose Worker membership.

Persistent Worker membership is stored separately from the user-managed main `config.yaml`. The Gateway owns this registry state and updates it atomically. Worker runtime code never writes Gateway registry files directly.

Persistent membership contains only the trust/routing anchor needed to find and authenticate the Worker:

```text
workerId
environmentId
transport descriptor
credential reference(s)
```

The data model may allow a temporary overlap of old and new Worker credentials so future credential rotation can be implemented without another registry-schema redesign. Automated rotation is not required by this ADR.

The following remain runtime-only and are not authoritative persistent membership data:

```text
instanceId
protocolVersion
optional capabilities
reachable / unreachable
last health observation
transport session state
```

After Gateway restart, persistent membership tells the Gateway where and how to find the Worker; protocol/version/capability state is renegotiated from the live Worker.

### Registry management

CLI may manage Worker membership through Gateway management semantics, for example list, remove, or explicit replacement operations. CLI and users do not edit the Gateway-owned registry state file directly.

`worker remove` deletes persistent membership. Removal is not a ban and does not create a historical deny record. A removed Worker may later be enrolled again through a new explicit join flow.

Normal Worker shutdown may change runtime presence to offline/unreachable but does not delete persistent membership. Persistent membership is removed only through an explicit management operation.

### Worker Protocol and optional capabilities

Worker Protocol version defines the mandatory Gateway-to-Worker contract. If the live Worker reports an incompatible Worker Protocol version, it is not considered usable/routable until compatibility is restored.

Optional Worker operations are advertised through runtime capability negotiation. Examples may include future `doctor` or resource-diagnostic operations.

The Gateway may identify, present, and route optional operations, but does not implement their functional behavior. Native functionality remains Worker-owned.

### Transport descriptor

Persistent membership carries an abstract transport descriptor rather than a raw URL as the architectural contract.

Conceptually:

```text
transport:
  type: http
  ...HTTP transport-specific connection data
```

Future transport bindings may include `grpc` or other concrete implementations. Worker Protocol semantics, Gateway routing responsibilities, Worker authority, and the public MCP contract must not depend on a particular transport implementation.

The current loopback HTTP Worker API remains the first verified transport implementation. This ADR does not require an immediate migration to gRPC or another transport.

The transport descriptor accepted during a successful join is persisted as part of membership and remains fixed until an explicit management update changes it. Worker runtime startup cannot silently replace or rewrite its routing endpoint.

### Liveness

No registration lease or Worker heartbeat lease is required.

The Gateway may perform configurable, low-frequency Worker liveness checks. Liveness checks answer only whether the Worker/Worker Protocol endpoint is alive and responsive. They must not perform Workspace scans, Git operations, shell execution, extension diagnostics, or other functional probes.

Liveness is observational rather than authoritative for routing. A failed health check may mark membership `unreachable`, but it does not permanently veto a real invocation attempt. If a later invocation succeeds, the Gateway may immediately restore the Worker to `reachable`. Invocation transport failures may likewise contribute to liveness state.

Health-check frequency, timeout, and failure thresholds are management configuration. Implementations must remain compatible with Queqiao Resource Safety requirements and must not introduce high-frequency idle polling or unbounded background work.

### Doctor and enhanced diagnostics

`health` and `doctor` are distinct concepts:

```text
health -> is the Worker alive?
doctor -> can the Worker and its native capabilities operate correctly?
```

A future Worker-native doctor capability may report filesystem, process runtime, Git, shell, Workspace/configuration, resource, or extension diagnostics. Doctor is an optional Worker Protocol capability and is not part of basic liveness.

Gateway diagnostics must not reconstruct native functional tests by embedding operating-system-specific knowledge in the Gateway.

### Security boundary

Enrollment and persistent membership do not weaken Worker authority. Gateway trust establishes that a Worker is a recognized cluster member; it does not authorize filesystem/process actions on behalf of a client.

The current Security Baseline v2 loopback-only Worker transport remains the production guarantee until a separately reviewed transport permits non-loopback or cross-machine Worker connections. Transport abstraction is not permission to bypass that security baseline.

## Non-decisions

This ADR intentionally does not choose:

- persistent versus non-persistent TCP sessions;
- HTTP connection reuse policy;
- WebSocket versus HTTP/2 versus another stream mechanism;
- gRPC as the default transport;
- exact liveness interval defaults;
- the exact future doctor response schema;
- a complete credential-rotation workflow;
- platform-specific setup convenience commands;
- the exact number or sequencing of implementation/refactor phases.

Those decisions follow from implementation planning and measured requirements, not from the architectural role boundary.

## Consequences

- Normal multi-environment use needs one Gateway rather than one Gateway per OS environment.
- Worker membership is explicit and user-authorized rather than an automatic runtime side effect.
- Gateway restart restores Worker membership from Gateway-owned persistent state without Worker registration refresh, heartbeat leases, or persisted short-lived join tokens.
- Worker transport remains abstract while HTTP remains a valid first implementation and future gRPC experiments stay possible.
- Protocol/version/capability negotiation remains live runtime state instead of stale persisted authority.
- Join is bounded and transactional, preventing half-created membership or orphaned usable credentials.
- Main declarative configuration remains user/CLI owned while dynamic cluster membership has a separate Gateway-owned persistence boundary.
- Worker authority remains unchanged: membership and Gateway routing never replace Worker-side authorization.

## Migration rule

The current verified static loopback HTTP implementation remains valid historical and production behavior until replaced through separately planned and validated refactoring.

Implementation planning must start from this ADR and ADR-0007, inventory the current code against the target boundaries, and then determine the necessary refactor sequence. This ADR does not pre-commit Queqiao to a fixed number of refactor phases.
