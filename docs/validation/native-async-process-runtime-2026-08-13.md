# Native async process runtime validation — 2026-08-13

## Scope

This validation covers the native process-runtime refactor needed before exposing asynchronous execution through the public `run` and `shell` tool schemas.

Core Manifest Revision remains 4 in this slice. No public MCP input schema changes are included here.

## Runtime contract

`ProcessRunner.start()` starts one bounded native executable without a shell and returns only after Node reports successful OS process spawn acceptance.

The returned metadata is deliberately native and non-durable:

- native PID;
- `startedAt` timestamp;
- configured lifetime timeout;
- explicit `stdout: "discarded"` / `stderr: "discarded"` policy.

Queqiao does not create a Job ID, JobManager, JobStore, tmux session, output spool, or durable recovery layer.

## Cancellation boundary

- cancellation before successful spawn acceptance rejects the start and terminates the process tree;
- the concurrency slot is not released until the pre-acceptance child actually closes;
- once `start()` resolves, the initiating request signal is detached and later request disconnect/cancellation does not terminate the accepted process;
- synchronous `run()` remains request-cancellation coupled.

## Resource and lifetime enforcement

Accepted async processes:

- retain one shared `ProcessRunner` concurrency slot until exit;
- remain subject to the configured maximum lifetime;
- use inherited minimal environment policy and trusted PATH executable resolution;
- use ignored stdout/stderr streams so there is no unbounded in-memory output or hidden output retrieval surface;
- are terminated as process trees at lifetime expiry;
- are terminated on orderly Worker shutdown through the shared `ProcessRunner.shutdown()` path.

A Worker crash/restart does not provide durable recovery or reattachment semantics.

## Tests

`packages/process-runtime/src/index.test.ts` verifies:

1. existing argv-only synchronous execution;
2. synchronous timeout/output bounds;
3. synchronous cancellation coupling;
4. async acceptance metadata and discarded output policy;
5. request cancellation after acceptance does not terminate the child;
6. cancellation present before acceptance rejects without leaving capacity allocated;
7. accepted async processes retain concurrency capacity until exit;
8. async lifetime termination prevents late side effects;
9. orderly shutdown terminates tracked async processes;
10. shell-syntax executable rejection and concurrency enforcement remain intact.

## Gates

- `npm run typecheck` — PASS
- `npm test` — PASS, 25 files / 95 tests
- `npm run test:security` — PASS, 16 files / 69 tests
- `npm run test:cluster` — PASS, 4 files / 13 tests
- `npm run security:gate` — PASS; audit reports 0 vulnerabilities
- `npm run build:package` — PASS
- `git diff --check` — PASS

No stable or shadow runtime was restarted for this source-level runtime refactor.
