# ADR-0004: Minimal tools and a transport-neutral extension runtime

## Status

Accepted

## Context

Queqiao must support coding-agent capabilities across Windows, WSL, Linux, and later
environments without turning the Gateway into a collection of framework-specific
tools. The MCP client also caches or refreshes public tool schemas independently from
Queqiao configuration hot reloads.

Hard-coding every tool directly in the MCP request handler prevents independent
testing, makes policy interception inconsistent, and couples implementations to the
public transport. A single generic `invoke(action, arguments)` tool would avoid schema
changes, but would remove useful input schemas, weaken discoverability, and make
authorization and audit records less precise.

## Decision

Queqiao uses a small set of orthogonal, typed public tools. Existing public names stay
stable during the compatibility period. New coding primitives will converge on read,
write, edit, and environment-native process execution rather than language- or
framework-specific operations.

All tools, including bundled core tools, register through `@queqiao/tool-runtime`.
The runtime owns deterministic registration order, unique names, manifest validation,
input validation, lifecycle sealing, and ordered before/after hooks. The contract is
transport-neutral: tool implementations return domain values, and the Gateway MCP
adapter alone converts those values into MCP content.

Extensions are explicitly configured, trusted local TypeScript modules, similar in
shape to pi-coding-agent extensions. They declare a stable reverse-domain ID, semantic version, supported execution
environments, per-tool capabilities, risk, annotations, schemas, and handlers. Tool names
are globally unique in a public manifest. Silent overrides are forbidden. A failed
activation rolls back all tools registered by that extension.

Workspace filesystem and process implementations execute only in native Workers.
Gateway extensions may perform routing, composition, authentication integration, and
result adaptation, but MUST NOT access workspace files or spawn workspace processes.
The Worker-side runtime uses a versioned internal invocation route. During rolling
upgrades, Gateway may use a narrowly scoped legacy fallback only when the new route
returns `404`; authorization failures must never trigger fallback.

Extension loading and enablement are local administrative operations. There is no
marketplace, remote installation protocol, package review, dependency allowlist, or
third-party ecosystem managed by Queqiao. An extension may use npm packages chosen by
its author; dependency provenance and behavior are the local administrator's
responsibility. MCP clients cannot load extensions or increase their permissions. OAuth authenticates
the connector through `queqiao:access`; effective capability is the intersection of
workspace profile, workspace policy, extension declarations, Worker capabilities,
and any runtime approval requirement.

Tool implementation and policy changes may hot reload without changing MCP schemas.
Adding, removing, or changing a public tool schema increments a manifest revision and
may require the MCP client to refresh or reconnect. Queqiao does not conceal schema
changes behind an untyped generic invocation tool.

## Consequences

- Core and locally configured extension tools follow one registration and interception path.
- MCP, a future local CLI agent, and tests can adapt the same domain-level runtime.
- Public schemas remain useful to models and security tooling.
- Dynamic implementation changes are distinct from public schema changes.
- Automatic package discovery and remote installation are intentionally unsupported.

## Extension supply-chain boundary

Extension provenance, marketplace review, signing, dependency auditing, and malicious
package detection are software supply-chain concerns. They are intentionally separate
from Queqiao's MCP server security model, which remains responsible for authentication,
authorization, routing, Worker identity, containment, and execution safety.

A locally loaded TypeScript extension has the operating-system privileges of its host.
This fact defines the extension execution model, but does not weaken Queqiao's security
obligations for requests arriving through MCP.

Consequently:

- extension paths must be explicitly configured by a local administrator;
- configuration records the intended host (`gateway` or a native Worker);
- MCP tools cannot load, enable, disable, or reconfigure extensions;
- startup fails closed for invalid manifests, duplicate tool names, or activation
  failures;
- public schema changes still create a manifest revision and connector migration;
- extensions requiring adversarial isolation must run as a separately designed
  process/service and are outside the v1 in-process contract.

## Compatibility rollout

1. Register the verified `workspace_info`, `read_file`, `list_workspaces`, and
   `open_workspace` tools through the runtime without changing their MCP contracts.
2. Route `read_file` through the Worker-side runtime and versioned tool invocation
   envelope while preserving rolling-upgrade compatibility.
3. Introduce atomic write and unique-match edit primitives with authoritative Worker
   policy, containment, symlink/junction, and size-limit tests.
4. Introduce process execution only after cancellation, output limits, command policy,
   concurrency limits, and approval integration pass production acceptance gates.
5. Validate one explicitly configured local TypeScript extension as the first non-core
   registration, without introducing remote installation or a marketplace.
