# Async Disconnect and Resource Security Gate ¡X 2026-08-13

## Scope

This evidence closes the security gate for Core Manifest Revision 5 `run` / `shell` `mode: sync | async` semantics. It adds no job manager, durable process registry, output store, or restart recovery contract.

## Cancellation defect found and fixed

The official MCP client cancellation path exposed a real compatibility defect in the 2025-era stateless Streamable HTTP adapter. A `notifications/cancelled` POST was served by a fresh `McpServer`, so the SDK-local request AbortController map did not contain the original `tools/call` request ID. The notification was acknowledged but could not terminate the original synchronous process.

The Gateway now owns a bounded, ephemeral cancellation-correlation registry keyed by OAuth `client_id` plus MCP request ID. It stores only an AbortController and expiry timer. It is not durable state and carries no process output or Queqiao job identity.

Security properties:

- cancellation correlation is scoped to the authenticated OAuth client; another client cannot cancel the same numeric/string request ID;
- total and per-principal entry counts are bounded and fail closed when capacity is exhausted;
- stale entries expire and abort before removal;
- valid `tools/call` request IDs are registered before SDK dispatch, closing the cross-POST cancellation race;
- tool execution combines the official SDK request signal with the correlated signal;
- leases are released on terminal JSON response, SSE completion/cancel, adapter close, or TTL expiry.

## Vertical acceptance

Using the official MCP client against a real Gateway + Worker + native `ProcessRunner` test stack:

- cancelling a synchronous `run` request propagates through MCP -> Gateway -> Worker and terminates the native process tree;
- after an asynchronous process has been successfully accepted, initiating-request cancellation no longer terminates that accepted process;
- accepted async execution and synchronous execution share the same Worker concurrency capacity;
- synchronous output remains bounded while asynchronous stdout/stderr remain explicitly discarded;
- asynchronous process lifetime limits remain enforced;
- orderly Worker shutdown terminates tracked asynchronous children;
- no Worker-restart durability/recovery behavior is promised or tested.

Async redirection is not part of Revision 5, so there is no redirection path that can bypass Workspace write containment.

## Mixed-version fail-closed evidence

Worker Protocol 2.0 is required by the Revision 5 Gateway. The Gateway handshake test explicitly presents a Worker Protocol 1.0 hello and confirms rejection before Workspace access. This prevents an old Worker from silently dropping the new async mode semantics and executing a request synchronously.

## Automated gates

- `npm run typecheck`: PASS
- full suite: 27 test files / 108 tests PASS
- `npm run test:security`: 18 test files / 81 tests PASS
- `npm run test:cluster`: 4 test files / 15 tests PASS
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities
- `npm run build:package`: PASS
- `git diff --check`: PASS

The intentionally invalid YAML reload case and unsupported-future-MCP-revision case continue to emit expected stderr during their adversarial tests; they are passing negative tests, not release failures.

## Delivery boundary

This ticket does not deploy or restart the stable Gateway or either stable Worker. The separate stable ChatGPT connector remains the recovery path. A separate Shadow Connector is still intentionally deferred until the final candidate public manifest, including the first-party Git extension surface, is frozen.
