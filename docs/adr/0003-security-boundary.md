# ADR-0003: Security is independent from OAuth and policy

- Status: Accepted
- Date: 2026-08-12

## Context

OAuth is required for the public MCP handshake, but future workspace policy may require
stronger user intent for selected operations. Examples include approving an action on
the local machine or entering a short-lived code through the MCP client.

Embedding these flows in OAuth handlers would couple client authentication, workspace
authorization, user-presence verification, secret storage, and UI concerns.

## Decision

`packages/security` is a first-class module. OAuth is an authentication adapter that
produces a security principal through the single `queqiao:access` handshake scope.
OAuth does not grant read, write, or execution capabilities. `packages/policy` independently decides
whether an operation is denied, allowed, or requires step-up assurance.

Security providers fulfill step-up through methods such as:

- local approval in the environment that will execute the action;
- a short-lived, attempt-limited, one-time code;
- future platform authenticators or external approval providers.

Approval is bound to a canonical digest of the complete requested operation. A grant
also binds the client principal, environment, workspace, and tool. Grants are
short-lived and consumed exactly once.

## Consequences

- Adding a verification method does not change OAuth or workspace execution code.
- Changing workspace capabilities does not require changing the OAuth grant.
- Gateway and Worker can enforce the same grant contract at both trust boundaries.
- Temporary codes cannot become reusable workspace passwords.
- The system requires durable challenge state, clock handling, replay prevention,
  secure secret storage, audit redaction, and explicit failure behavior.
- Codes typed into a chat may be retained by the client, so they must contain no
  durable secret and must expire quickly after one attempted action.
