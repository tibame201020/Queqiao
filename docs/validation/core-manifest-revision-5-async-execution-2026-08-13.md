# Core Manifest Revision 5 async execution validation — 2026-08-13

## Scope

This validation covers the public `run` / `shell` schema migration that exposes bounded native asynchronous execution through `mode: "sync" | "async"` while preserving the existing synchronous behavior by default.

## Public manifest migration

Core Manifest Revision changes from **4** to **5**.

The only intended Core public tool contract changes in this slice are:

- `run.mode`: optional input with default `"sync"`; allowed values `"sync" | "async"`;
- `shell.mode`: optional input with default `"sync"`; allowed values `"sync" | "async"`;
- public descriptions explicitly state that async returns after native process start and does not retain stdout/stderr.

Existing calls that omit `mode` continue to execute synchronously. The Gateway MCP vertical-slice test exercises the existing no-`mode` `run` call successfully through the official MCP SDK.

The empty-extension Deployment Manifest Fingerprint therefore migrates from:

- Revision 4: `sha256:bc96f482e2c5b395d466565706712ea76d067bdf14b4be801d5395ad4673c1fe`
- Revision 5: `sha256:d71cb701dca2a6f40f8d26420179cf0becee570d7b9ecbf8edb4779bdb37921b`

A dedicated operations test asserts that Revision 5 differs from the recorded Revision 4 fingerprint and that both process tools expose the expected mode enum/default in their canonical MCP input schemas.

## Worker protocol migration

Worker Protocol changes from **1.0** to **2.0**. The existing HTTP route family remains `/v1` because the endpoint family did not change; the handshake/wire semantics did.

This protocol bump is security/correctness critical. Without it, a new Gateway could send `mode: "async"` to an old Worker whose input parser might strip the unknown field and silently execute synchronously. Exact Worker Protocol 2.0 negotiation fails closed instead of allowing that semantic downgrade.

The current Worker hello advertises:

- `workspace-routing`
- `tool-invocation`
- `async-process-v1`

Worker Protocol 1.0 hello documents are rejected by the current parser.

## Mode-dependent Worker results

Shared domain and Worker Protocol schemas define:

### Sync

The Revision 4 result shape is preserved:

- exit code / signal;
- bounded stdout/stderr;
- duration;
- timeout/abort/output-limit flags.

### Async

Accepted async execution returns only native start metadata:

- native PID;
- `startedAt` timestamp;
- configured lifetime timeout;
- `stdout: "discarded"`;
- `stderr: "discarded"`.

No Queqiao Job ID, execution ID, session ID, output spool, durable recovery or reattach API is introduced.

Gateway Worker clients validate the mode-dependent Worker result schemas and reject malformed results fail-closed.

## MCP output contract decision

Revision 5 does **not** publish an MCP `outputSchema` for `run` or `shell`.

The pinned official MCP TypeScript SDK 2.0 server implementation was inspected locally. Registering an `outputSchema` causes the SDK to require/validate `structuredContent`, while Queqiao's established MCP callback currently returns text content. Adding `outputSchema` in this ticket would therefore be a separate MCP response-model migration, not merely documentation of the Worker wire result.

Mode-dependent result schemas are instead fixed at the shared domain/Worker Protocol boundary while the MCP response representation remains unchanged.

## Routing evidence

Worker integration tests verify through `/v1/tools/...` that:

1. omitted `mode` dispatches to the synchronous process executor;
2. explicit `mode: "async"` dispatches to the async start executor;
3. `shell` async mode uses the native shell resolver and the same Worker authority envelope;
4. all three calls remain subject to Workspace coding/profile/tool policy.

Gateway Worker-client tests verify a valid Protocol 2.0 async result and reject malformed async results such as captured stdout.

## Gates

- `npm run typecheck` — PASS
- `npm test` — PASS, 25 files / 99 tests
- `npm run test:security` — PASS, 16 files / 72 tests
- `npm run security:gate` — PASS; audit reports 0 vulnerabilities
- `npm run test:cluster` — PASS, 4 files / 15 tests
- `npm run build:package` — PASS
- `git diff --check` — PASS

No stable Gateway/Worker process was restarted or replaced for this source-level manifest migration.
