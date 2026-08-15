# Gateway Liveness and Diagnostics — Stage 5 Validation

Date: 2026-08-15

## Scope

Stage 5 separates cheap advisory Worker liveness from Workspace discovery and functional diagnostics.

The public MCP tool surface and Core Manifest contract are unchanged. Worker Protocol remains 3.0.

## Runtime behavior

- A single Gateway `GatewayLivenessMonitor` owns low-frequency Worker probes.
- Default probe interval is 30 seconds; configuration is bounded to 5 seconds through 1 hour.
- Gateway `/health` reads an in-memory liveness snapshot and performs no Workspace discovery or Worker request itself.
- Worker `/health` is a minimal liveness endpoint and no longer exposes default Workspace or Workspace count.
- A liveness probe uses bounded `/health` plus authenticated Worker hello/identity validation.
- Liveness state is advisory only. A failed probe never vetoes a real invocation.
- Successful real Worker communication restores `reachable` immediately.
- A successful enrollment confirmation triggers one immediate bounded liveness probe so newly joined membership does not remain stale until the next periodic interval.
- CLI `doctor` reads Gateway liveness rather than legacy static Worker endpoints.
- Worker-native functional doctor remains optional. Stage 5 does not invent OS-native diagnostics in the Gateway when no Worker doctor capability is advertised.

## Targeted evidence

Covered behaviors include:

- health snapshots do not trigger probes;
- one Gateway scheduling loop with coalesced overlapping probes;
- configured low-frequency interval bounds;
- liveness failure followed by successful real invocation restores reachability;
- CLI doctor ignores legacy static environment endpoints;
- absence of optional Worker-native doctor capability is reported explicitly;
- enrollment success remains atomic while refreshing liveness immediately.

## Validation results

- TypeScript typecheck: PASS
- Full suite: 41 files, 157/157 tests PASS
- Security gate: 36 files, 138/138 tests PASS
- Runtime dependency audit: 0 vulnerabilities
- Cluster gate: 8 files, 29/29 tests PASS
- Resource Safety Baseline: PASS
  - package: 5.59 MiB
  - Gateway idle CPU: 0.046875 s
  - Worker idle CPU: 0 s
  - Gateway/Worker idle writes: 0/0 bytes
  - Gateway/Worker idle log growth: 0/0 bytes
  - failures: none

The first Resource Safety attempt failed only because the harness still waited for the removed legacy health field `online:true`. Updating the harness assertion to the Stage 5 liveness contract `reachable:true` made the unchanged resource budgets pass; no resource limit was relaxed. The hosted Linux package integration required the same readiness-assertion update; its legacy static Worker hello intentionally remains Protocol 2.0 to preserve the Stage 4 rolling-upgrade compatibility check.

## Acceptance

Stage 5 is ready for PR review when Git hygiene and hosted CI remain green.
