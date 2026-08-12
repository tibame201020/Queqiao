# ADR-0001: Production modular monorepo

- Status: Accepted
- Date: 2026-08-12

## Context

The validated single-workspace MCP server proved ChatGPT connectivity and OAuth, but
its process-level boundaries cannot safely evolve into a multi-environment product.

## Decision

Queqiao is an npm workspace monorepo. Deployable applications and reusable domain
packages are separate TypeScript projects with explicit references. Production
boundaries are established before feature migration from the validation server.

The old validation server is behavioral reference material, not the new core.

## Consequences

- Gateway, Worker, and CLI can have different dependencies and privilege envelopes.
- Shared contracts can be tested without starting a network service.
- Initial delivery takes longer than extending the validation server.
- Cross-package APIs require deliberate versioning and ownership.

