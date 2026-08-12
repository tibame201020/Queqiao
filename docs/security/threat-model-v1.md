# Queqiao security threat model v1

## Trust domains

- The public MCP client and network are untrusted.
- Gateway OAuth state, signing keys, worker tokens, and configuration are sensitive.
- Gateway and native Workers are trusted Queqiao components with distinct duties.
- Workspace contents are untrusted input, including filenames, symlinks, and text.
- Extension package provenance is a separate software supply-chain concern, equivalent
  to MCP servers or editor extensions, and is not the subject of this threat model.

## Security claims

Queqiao authenticates the MCP connector, routes only configured workspace IDs, applies
workspace profile and tool policy, constrains bundled filesystem/process primitives,
and keeps native workspace operations in their environment's Worker. Configuration
mutation is local administrative authority.

Queqiao's security responsibility is the MCP server, Gateway, routing, authorization,
and Worker execution boundary. It must prevent an internet client from converting MCP
connectivity into permissions that were not locally configured, even when requests,
tokens, tool arguments, workspace contents, or network peers are malicious.

## Primary threats

- OAuth authorization-code interception, CSRF/state confusion, redirect manipulation,
  PKCE downgrade, dynamic-client-registration abuse, refresh-token replay, and bearer
  token theft or reuse against the wrong resource/audience.
- Connector or session compromise attempting to exceed the locally configured
  workspace, profile, tool, command, environment, or approval boundary.
- Gateway confused-deputy behavior, workspace-ID ambiguity, forged Worker identity,
  stolen Worker credentials, routing to attacker-controlled endpoints, and lateral
  movement between Windows, WSL, or future environments.
- Path traversal, symlink/junction escape, unsafe process invocation, argument and
  output abuse, cancellation failure, resource exhaustion, malformed MCP messages,
  oversized requests, and rate-limit bypass through proxy-header spoofing.
- Secret leakage through logs, errors, health endpoints, configuration files, audit
  events, process lists, or Dashboard/CLI responses.
- Policy/config races, partial writes, stale authorization decisions, fail-open reloads,
  and replay of a previously valid approval for a different operation.

## Required controls before management UI

- strict OAuth redirect, state, issuer, audience/resource, PKCE, token lifetime,
  refresh rotation/replay handling, revocation, and rate-limit tests;
- worker mutual authentication design, token rotation procedure, loopback/private
  binding, endpoint allowlisting, identity pinning, and fail-closed routing;
- secret redaction and restrictive storage permissions;
- bounded request bodies, filesystem traversal, search, process concurrency, output,
  timeout, and cancellation;
- structured audit events for authorization, policy decisions, configuration changes,
  extension activation, and tool execution without secret or file-content leakage;
- authoritative policy re-check at the native Worker immediately before execution;
- hostile MCP and routing tests covering malformed input, replay, impersonation,
  ambiguous workspace IDs, offline/stale Workers, and proxy-header spoofing;
- Dashboard and CLI mutations sharing one application/service layer and authorization model.

## Deferred controls

Local approval, one-time codes, and user-presence assurance are compatible future
additions. Extension hub review, provenance, signing, dependency auditing, and runtime
isolation belong to a separate extension supply-chain design if that ecosystem is
introduced; they do not replace MCP boundary security.
