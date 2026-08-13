# ADR-0007: Separate domain contracts, Worker protocol, and MCP adapter

- Status: Accepted
- Date: 2026-08-13
- Refines: ADR-0002

## Context

Queqiao currently has a single `packages/protocol` boundary that contains stable domain identifiers, public tool naming, and Gateway-to-Worker wire schemas. The Gateway also owns MCP server construction directly. Those concerns evolve for different reasons and on different compatibility clocks.

The secure-agent-substrate direction requires Queqiao to remain usable by MCP clients without making Core runtime, policy, workspace, execution, or extension contracts depend on a particular MCP SDK revision.

It is also necessary to distinguish several versions that are currently easy to conflate: the Queqiao release, the Core public manifest, a resolved deployment manifest, the Gateway-to-Worker protocol, and the upstream MCP specification revision.

## Decision

Queqiao separates three bounded contexts.

### Domain contracts

Transport-neutral contracts own stable Queqiao identifiers and values used by Core runtime code. They must not import MCP SDK result/content types or treat an MCP specification revision as a Core version.

### Worker protocol

Gateway-to-Worker hello, capability negotiation, invocation, cancellation, and compatibility semantics belong to an explicitly versioned Worker Protocol. A Worker Protocol Version is independent from both the public MCP manifest and the upstream MCP specification revision.

The current loopback HTTP Worker transport is an implementation of this boundary, not the boundary itself. A later persistent outbound transport may replace it without redefining Core tool semantics or the public MCP contract.

### MCP adapter

MCP-specific server construction, Streamable HTTP transport, supported MCP protocol revisions, OAuth/resource integration, public tool-schema serialization, and domain-result conversion belong at the MCP adapter boundary.

Remote HTTP(S) MCP remains Queqiao's supported client transport. Local stdio MCP is not added by this decision.

The adapter supports an explicit finite MCP specification compatibility window. The exact initial revisions and SDK mechanism are selected and tested by the dedicated compatibility research/implementation tickets rather than guessed in this ADR.

## Version ownership

The following are distinct and must be named explicitly in code and diagnostics:

- Queqiao release version;
- Core Manifest Revision;
- Deployment Manifest Fingerprint;
- Worker Protocol Version;
- supported MCP specification revision window.

A change in one dimension does not silently imply a change in the others.

## Migration rule

The package/module split may be incremental, but new code must move toward these ownership boundaries. During migration, compatibility exports are allowed where needed to preserve verified Revision 4 behavior, provided they do not reintroduce MCP-specific types into Core runtime packages.

## Consequences

- Core runtime and security logic can be tested without MCP transport types.
- Gateway/Worker compatibility can evolve independently from client-protocol compatibility.
- MCP compatibility failures can be isolated at the adapter boundary rather than leaking client-specific branches into Core.
- A second client protocol can be added later only when a real requirement exists; this ADR does not create a speculative universal protocol framework.
- Existing Revision 4 validation remains historical evidence and is not rewritten by the refactor.
