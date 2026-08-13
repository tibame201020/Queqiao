# Structured Worker Error Semantics Candidate Validation

- Date: 2026-08-13
- Issue: #5
- Branch: `fix/structured-worker-errors`
- Status: local candidate gates PASS; Shadow acceptance pending

## Scope

Preserve machine-readable Queqiao error semantics across Worker -> Gateway -> MCP without changing the public tool manifest or connector tool schemas.

The existing MCP tool failure representation remains `isError: true` with text content. The text now serializes a bounded Queqiao error envelope:

```json
{
  "code": "process_capacity",
  "message": "Worker process concurrency limit reached",
  "layer": "worker",
  "retryable": true
}
```

No MCP `outputSchema` or `structuredContent` migration is introduced. Core Manifest Revision remains 6 and the existing 17-tool public manifest is unchanged.

## Implementation contract

- Worker HTTP error codes are preserved by the Gateway Worker client instead of being reduced to status + message.
- Known Gateway-side failures use stable machine-readable codes for common agent recovery decisions.
- Error envelopes contain only `code`, `message`, `layer`, and `retryable`.
- `layer` distinguishes Gateway-generated failures from Worker-returned failures.
- `retryable` is derived by Queqiao; Worker responses do not gain a new wire field.
- Human-readable messages remain available but are not the stable agent decision surface.

Representative coverage includes:

- Worker `tool_denied` -> `layer: worker`, `retryable: false`;
- Worker `process_capacity` -> `layer: worker`, `retryable: true`;
- Gateway `workspace_not_found` -> `layer: gateway`, `retryable: false`.

## Local candidate gates

The isolated feature worktree completed:

```text
npm run typecheck
npm test
npm run test:security
npm run test:cluster
npm run security:gate
npm run build:package
git diff --check
```

Observed results:

- typecheck: PASS;
- full Vitest suite: 31 files / 118 tests PASS;
- security suite: 23 files / 92 tests PASS;
- cluster suite: 4 files / 15 tests PASS;
- production dependency audit: 0 vulnerabilities;
- package build: PASS;
- diff check: PASS.

## Release boundary

This candidate does not introduce job/process management, new public tools, new tool arguments, or a connector manifest migration. Shadow validation must use the existing Shadow connector against the existing Revision 6 manifest and must prove the agent-facing error envelope before PR promotion.
