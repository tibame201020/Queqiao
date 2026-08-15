# Stage 6 ??Membership-Owned Config Cutover Validation

Date: 2026-08-15
Branch: `refactor/static-config-stage6`
Base: `main@4a35f65`

## Scope

Stage 6 completes the frozen Gateway/Worker config-domain cutover. Normal Gateway runtime routing is now derived only from the Gateway-owned persistent Worker membership registry. Static `config.environments`, `WorkerEndpointConfig`, and the reloadable static endpoint registry are removed from the normal runtime path.

The HTTP transport baseline remains loopback-only. This stage does not add remote transport, load balancing, automatic registration, or new public MCP tools.

## Runtime and CLI behavior

- `runtimeConfigSchema` no longer owns an `environments` field.
- Gateway runtime no longer reads Worker URLs or Worker tokens from normal config/environment variables.
- `MembershipWorkerRegistry` reads only `worker-memberships.json` through `WorkerMembershipStore`.
- A failed membership reload retains the last-known-good in-memory registry.
- `WorkerClient` consumes a transport descriptor rather than a static URL config shape.
- `config init` and `environment *` are deprecated with explicit guidance to role setup and membership commands.
- Current setup/enrollment surface is `gateway setup`, `gateway join-token`, `worker setup`, `worker join|list|update|remove`.
- Worker extension host `environmentId` is no longer validated against a static Gateway environment list; runtime identity/capability negotiation remains authoritative.

## Migration behavior

Legacy static endpoint syntax exists only in explicit migration compatibility code. Migration writes routing state into the separate Gateway membership registry and does not restore `config.environments`.

Migration is fail-closed for legacy remote/static Workers whose stable `workerId` and credential-file reference cannot both be established. It does not invent remote Worker identities, reuse the local Worker credential, or silently auto-enroll them. Such Workers require explicit trusted migration inputs or fresh enrollment.

## Validation

- TypeScript typecheck: PASS.
- Full suite: 41 files, 157/157 tests PASS.
- Security gate: 138/138 tests PASS.
- Runtime dependency audit: 0 vulnerabilities.
- Cluster gate: 28/28 tests PASS.
- Windows packaged install / `queqiao config paths`: PASS.
- Resource Safety baseline: PASS with unchanged budgets.
  - package footprint: 5.59 MiB
  - Gateway idle CPU: 0 s
  - Worker idle CPU: 0.078125 s
  - Gateway idle writes: 0 bytes
  - Worker idle writes: 0 bytes
  - Gateway idle log growth: 0 bytes
  - Worker idle log growth: 0 bytes
  - Gateway resident after workload: 84.32 MiB
  - Worker resident after workload: 71.86 MiB
  - failures: none

The Linux packaged Gateway/Worker integration fixture was migrated to persistent membership and Worker Protocol 3.0. Hosted Ubuntu CI is the release gate for that shell integration after the PR is opened.

## Static-path hygiene

Outside explicit migration compatibility code/tests and historical documentation, the current source/scripts do not contain `WorkerEndpointConfig`, the old `worker-registry-config` runtime, `environment add --...`, or `QUEQIAO_WORKER_URL`. Current README and `config.example.yaml` describe the membership/join model only.

## Acceptance

Stage 6 is acceptable for PR review when repository hygiene is clean and hosted Windows/Ubuntu package, security, cluster, and Resource Safety checks pass. Stage 7 production acceptance/promotion remains a separate user-approved stage.
## Hosted CI regression fixes

The first PR #20 hosted run exposed two test-fixture/harness regressions, not runtime gate failures:

- Linux packaged cluster: the persistent membership fixture had a fixed `workerId`, while the Worker config omitted that same identity. The Gateway correctly rejected the handshake as unreachable. The fixture now pins the identical Worker identity in config and membership.
- Windows self-contained package: `npm pack` runs `prepack -> check`, causing the async-security suite to execute again under a loaded hosted runner. The runtime process deadlines remained 2s/1s, but Vitest's default 5s outer test ceiling expired. Only that test-harness ceiling is now 10s; Queqiao process/security/resource deadlines are unchanged. A local Windows `npm pack` with the complete prepack/check path passes after the adjustment.

Neither fix relaxes a runtime security or resource budget.
