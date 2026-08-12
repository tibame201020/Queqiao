# ADR-0002: One public Gateway and native Workers

- Status: Accepted
- Date: 2026-08-12

## Context

Windows and WSL must execute filesystem and process operations natively. Publishing a
separate MCP connector per environment creates duplicated OAuth, unstable schemas,
and multiple public tunnel routes.

## Decision

One Gateway owns the public MCP and OAuth endpoints. Each environment runs a Worker
that establishes an outbound authenticated channel to the Gateway. The Gateway routes
opaque workspace handles but cannot execute workspace operations.

## Consequences

- One tunnel and one ChatGPT connector cover multiple environments.
- WSL operations stay in WSL and do not traverse `\\wsl$` from Windows.
- A disconnected Worker affects only its own environment.
- The internal channel needs protocol negotiation, identity, reconnect, cancellation,
  backpressure, and defense-in-depth authorization.

