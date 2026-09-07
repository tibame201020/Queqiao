# Audit / Observability Foundation Validation — 2026-09-07

## Scope

This evidence covers the durable local audit foundation implemented on the candidate branch.
It does not claim Dashboard UI or physical-network acceptance.

Validated behavior:

- Audit Event Schema v1 with bounded subject/detail projection.
- Sensitive-key, URL-query, join-code, bearer-token, and JWT-shaped-value redaction.
- Bounded local JSONL storage: 1 MiB active file, four rotated generations, 30-day append-time retention pruning, and no idle maintenance writer.
- Global, named Gateway, and named Worker CLI query scopes with exact category/outcome/action filters.
- Gateway audit events for OAuth outcomes, enrollment start/confirm, reverse gRPC Worker session attach/detach, and transport selection/failure.
- Worker audit events for tool outcomes and dedicated Extension calls.
- CLI management audit events for successful Workspace add/edit/remove and Extension install/attach/detach/uninstall mutations.
- Packaged CLI reads the same role-local audit stores used by managed Gateway/Worker runtimes.

## Security evidence

Automated tests verify that audit records do not persist raw OAuth approval secrets, authorization codes, access tokens, Worker membership/session credentials, tool input/content, or Extension capability arguments.

Audit remains non-authoritative: existing Gateway/Worker policy and Worker-final-authority contracts are unchanged.

## Repository gates

The repository-defined release gate was run on Windows. The outer execution wrapper reached its 120-second limit only after the following stages had passed:

| Gate | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `npm test` | PASS — 115 files / 863 tests |
| `npm run test:workstation` | PASS — 15 files / 126 tests |
| `npm run test:security` | PASS — 76 files / 617 tests |
| `npm run test:cluster` | PASS — 17 files / 70 tests |
| `npm run dev:workstation:verify -- --smoke` | PASS — 4 files / 21 tests |

The remaining release-gate stages were then run directly:

| Gate | Result |
| --- | --- |
| `npm run resource:gate` | PASS |
| `npm run build:package` | PASS |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |
| `git diff --check` | PASS |

Resource Safety reported a 10.37 MiB package, zero idle Gateway/Worker write bytes, and no failures.

## Packaged acceptance

`apps/cli/src/cli-isolated-acceptance.test.ts` passed 10/10 and exercises packaged global/Gateway/Worker audit queries, including a real managed Gateway + Worker enrollment flow.

## Clean-checkout CI regression

The first PR run exposed a missing TypeScript project-reference edge: clean runners installed `@queqiao/audit`, but app projects could typecheck before its declarations were built. The CLI, Gateway, and Worker tsconfigs now reference `packages/audit` explicitly. The fix was verified with `npx tsc -b --clean` followed by `npm run typecheck`, plus the 13 focused audit/runtime tests.

## Residuals / non-goals

- No Dashboard audit UI is included in this slice.
- Retention pruning runs during append maintenance; it is not a wall-clock background deletion service.
- This evidence is repository/local-runtime validation, not physical-host LAN/VPN/firewall acceptance.
