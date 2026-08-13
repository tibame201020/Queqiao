# Protocol Bounded-Context Split Validation

- Date: 2026-08-13
- Result: PASS
- Branch: `feat/secure-agent-substrate-implementation`
- Ticket: Protocol bounded-context split
- Public MCP schema impact: none

## Purpose

Separate transport-neutral Queqiao domain contracts from the explicitly versioned Gateway-to-Worker protocol without changing the frozen Revision 4 public MCP contract or the current Worker HTTP wire paths.

## Implemented boundary

The source tree now has three explicit package roles:

### `@queqiao/contracts`

Owns transport-neutral Queqiao domain contracts used by config, policy, security, Workspace, and Core tool implementations, including:

- environment/Workspace identifiers;
- permission profile and public tool-name schemas;
- approval/assurance domain values;
- Workspace descriptor schema;
- bounded text-mutation constant.

It has no MCP SDK dependency and does not own Worker transport/version semantics.

### `@queqiao/worker-protocol`

Owns Gateway-to-Worker protocol details, including:

- `QUEQIAO_WORKER_PROTOCOL_VERSION`;
- the current `/v1` Worker HTTP API prefix;
- required Worker capabilities;
- Worker hello schema/type;
- Worker tool invocation response contract.

Gateway Worker clients and native Worker route construction consume this package directly.

### `@queqiao/protocol`

Remains temporarily as a compatibility facade. It re-exports the two new bounded-context packages and retains the legacy `QUEQIAO_PROTOCOL_VERSION` alias bound to the explicitly named Worker Protocol Version, plus historical v0 compatibility exports.

New Core/domain consumers were migrated away from the compatibility facade.

## Compatibility properties

This ticket intentionally preserves runtime behavior:

- Worker Protocol Version value remains `1.0`;
- Worker HTTP API prefix remains `/v1`;
- existing hard-coded `/v1` integration/security tests continue to pass;
- incompatible Worker protocol revisions still fail closed during handshake;
- missing required Worker capabilities still fail closed;
- rolling-upgrade read fallback remains limited to the existing 404 case;
- public MCP tool registration/schema code was not changed.

No new public MCP tool or input-schema revision was introduced.

## Build and dependency integration

Monorepo TypeScript references, workspace package dependencies, package lock data, and the self-contained package build resolver were updated for the new internal packages.

A source audit found no `@modelcontextprotocol/sdk` imports under `packages/**` after the split.

## Verification

The implementation worktree completed:

```text
npm install
npm run typecheck
npm test
npm run test:security
npm run test:cluster
npm run security:gate
npm run build:package
git diff --check
```

Observed results:

- dependency update completed with zero reported vulnerabilities;
- typecheck passed;
- full Vitest suite passed: 20 test files / 61 tests;
- Security Baseline suite passed: 14 test files / 50 tests;
- Gateway/Worker cluster suite passed: 4 test files / 13 tests;
- `security:gate` passed, including runtime dependency audit with zero reported vulnerabilities;
- package build passed.

The existing invalid-YAML reload test continued to emit its expected diagnostic while passing; it is not a protocol-split failure.

## Shadow runtime acceptance

Before rebuilding the candidate package, only the shadow Gateway/Workers were stopped. Process identity was checked before stopping Windows shadow processes, and only the separate shadow WSL unit was stopped.

During the shadow stop/build interval:

- stable local Gateway health remained HTTP 200;
- stable public health remained HTTP 200;
- stable WSL Worker service remained active.

The new candidate package was then started in the existing shadow topology. After restart:

- candidate Windows Worker health returned HTTP 200;
- candidate WSL Worker health returned HTTP 200;
- candidate Gateway reported both Windows and WSL environments online;
- shadow public health returned HTTP 200;
- stable public health remained HTTP 200.

After the candidate restart, the existing stable ChatGPT Queqiao Revision connector successfully executed `list_workspaces` and returned both native environments online. No stable service restart or stable public-route replacement occurred.

## Acceptance conclusion

The Protocol bounded-context split ticket is satisfied:

- Worker version/hello/capability/route ownership has an explicit Worker Protocol package;
- transport-neutral Core/domain packages depend on a distinct contracts package;
- Core packages do not import MCP SDK types;
- Gateway/Worker contract and security tests pass;
- frozen Revision 4 public MCP behavior is preserved.

The next dependency-ordered ticket is **MCP compatibility-window research**. That research is intentionally separate because it selects the exact upstream MCP specification/SDK compatibility window rather than changing Core/Worker semantics in this ticket.

The separate shadow ChatGPT connector binding from the blue/green Gate A remains pending; this ticket itself did not introduce a public MCP schema change requiring a new connector binding.
