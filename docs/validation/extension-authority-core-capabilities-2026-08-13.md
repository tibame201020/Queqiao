# Extension authority and Core capability validation — 2026-08-13

## Scope

This validation covers the extension authority envelope and Worker Core capability API introduced after the deterministic extension host/composition work.

The security model remains **trusted local in-process TypeScript extensions**. This work does not claim OS-process sandboxing for malicious extension code. It ensures that Queqiao extension composition, replacement, and the supported Core capability API cannot bypass the Worker-authoritative Workspace/process policy envelope.

## Authority boundary

- Workspace tool policy accepts generic validated tool names so extension tools participate in the same allow/deny/step-up vocabulary as Core tools.
- Tool profile ceilings are derived from the original registered tool capabilities (`workspace:read`, `workspace:write`, `workspace:exec`).
- ToolRuntime runs an immutable authority guard against the original contract before any extension before/wrap/after hook or replacement implementation.
- Replacement definitions must preserve the original name, metadata, input schema, annotations, risk, and required capabilities.
- Registered extension implementations must match their deployment manifest declaration.
- Extenders cannot request capabilities outside the target contract; replacement declarations must match the target contract capabilities.

## Worker Core capability surface

The Worker invocation context no longer exposes `WorkspaceCatalog`, `SafeWorkspace`, or `ProcessRunner` directly to tool implementations/extensions. Each invocation receives a bound `WorkerCoreCapabilities` instance carrying:

- the selected Workspace,
- the original tool name,
- the original contract capability ceiling,
- the request cancellation signal,
- the existing bounded ProcessRunner behind narrow methods.

Read/write/edit methods delegate to `SafeWorkspace`; process execution remains command-allowlisted and bounded by `ProcessRunner`; native shell is only available to the `shell` Core contract.

## Adversarial evidence

`apps/worker/src/extension-authority.test.ts` verifies:

1. a replacement cannot execute when Workspace policy denies the original tool;
2. a read replacement cannot escalate to write or process execution, even in a coding Workspace;
3. replacement contract/schema/capability broadening is rejected during composition;
4. registered extension tools participate in generic Workspace deny policy before implementation execution;
5. extension reads remain behind SafeWorkspace path containment.

The adversarial suite is included in `npm run test:security`.

## Gates

- `npm run typecheck` — PASS
- `npm test` — PASS, 23 files / 82 tests
- `npm run test:security` — PASS, 15 files / 57 tests
- `npm run test:cluster` — PASS, 4 files / 13 tests
- `npm run security:gate` — PASS; `npm audit --omit=dev --audit-level=moderate` reports 0 vulnerabilities
- `npm run build:package` — PASS

No stable Gateway/Worker process was restarted or replaced for this source-level validation. The stable Queqiao connector was probed after the gates and both Windows and WSL environments remained online.
