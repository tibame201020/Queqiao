# ADR-0014: Extensible Worker transport routing and dynamic MCP selector

- Status: Accepted
- Date: 2026-09-03
- Refines: ADR-0011 and ADR-0013
- Public MCP contract: Core Manifest Revision 9

## Context

ADR-0013 introduced Worker-initiated TLS gRPC alongside authenticated loopback HTTP. Treating the public MCP `transport` selector as a closed `http | grpc` enum would make every future transport identifier a ChatGPT connector schema migration even when the routing contract itself had not changed. The Gateway also needs one authoritative way to expose which transports a Workspace can currently use and how omitted routing will resolve.

## Decision

### Transport identifiers are open

Workspace-bound Core tools accept an optional transport identifier string matching `^[a-z][a-z0-9.-]*$` with a maximum length of 64. HTTP and gRPC remain the current concrete providers; the public schema does not enumerate provider names.

### Discovery is authoritative

`list_workspaces` and `workspace_info` project the transports enabled for each Workspace, their observed health/mode, transport traits, and the deterministic omitted-selection result. Callers discover transport names from this projection instead of assuming a hard-coded provider list.

### Routing is deterministic and fail-closed

- explicit `transport` selects that provider exactly and never falls back;
- an unknown valid identifier returns `transport_unknown`;
- a registered provider not enabled by the selected Worker membership returns `transport_not_enabled`;
- omitted selection prefers healthy candidates, then unknown, then unhealthy, preserving configured membership order for ties;
- the same selection function drives the projected default and actual runtime routing.

### Traits describe transport behavior

Transport projection exposes request/response support, streaming mode, connection lifetime, and topology. The current descriptors are:

- HTTP: request/response, no streaming, stateless, direct;
- gRPC: request/response, bidirectional streaming, persistent, reverse.

### Connector migrations are about shape, not provider names

Adding a new provider identifier does not change the MCP schema while the dynamic string contract remains unchanged. A new transport still requires explicit implementation, security review, membership/enrollment support, and validation inside Queqiao. Any future change to the public input shape remains a Core Manifest revision.

## Consequences

- Future provider names do not force connector recreation or schema revision by themselves.
- Clients can make routing decisions from live Workspace discovery.
- Existing HTTP/gRPC memberships remain compatible.
- Explicit routing remains auditable because fallback is prohibited.
- Transport extensibility does not weaken Worker-authoritative policy or Gateway runtime validation.

## Validation

Final cross-device, routing, ChatGPT connector, schema-lifecycle, and repository-gate evidence is recorded in `docs/validation/worker-transport-final-acceptance-2026-09-03.md`.
