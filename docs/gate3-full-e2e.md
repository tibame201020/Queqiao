# Issue #124 — Complete Gate 3 delivery and evidence contract

Gate 3 is NOT considered complete merely because its independent CI browser,
authenticated ChatGPT content, and manually coordinated GitHub Connector tasks
have individually succeeded. Acceptance requires one correlated execution.
This document is the scope and progress ledger, not an assertion of completion.

## Required topology

Manual reviewed-main Actions dispatch → Gateway runtime lease → ephemeral
OIDC Worker and reverse WebSocket → real authenticated content task →
strictly validated public draft → approved GitHub Connector invocation →
signal-notes **test branch + Draft PR** → target content CI → disposed
lease and cancelled Worker. No local always-on PC, independent cross-repo
PAT, production daily schedule, or merge to signal-notes/main.

## Delivery slices and stop conditions

| Slice | Deliverable | Pass condition | Status |
| --- | --- | --- | --- |
| G3.1 | Immutable public `gate3.trace.v1`, deterministic date logical target, run-attempt identity, and pre-upload verification | Unit tests, PR CI and real hosted artifact with matching run ID, hash and explicit unobserved downstream stages | **PASS: PR #145; Run 38359475732** |
| G3.2 | Same-task Worker-to-content task bridge | A **single** Controller Run records Worker Run ID, authenticated content result and hash-bound receipt; no simulated or stitched Run IDs | **PASS: PR #147; Controller 38365316946 / Worker 38365362251** |
| G3.3 | Supported Connector invocation boundary | Explicitly supported authorization and real tool invocation from the approved control plane; an observed ChatGPT reply or authenticated browser alone is insufficient | Blocked: earlier replayed-session-to-Connector automated write was rejected by execution-environment safety check; do not route around it |
| G3.4 | Restricted test publication and true idempotency | One date-specific test branch, one draft PR, exact article hash, independently verified commit and CI. Atomic target claim/remote conflict handling prevents retries from creating duplicate publication | Not proved |
| G3.5 | Unattended full E2E/PC independence | One run links task, Worker, content, Connector, commit, CI and disposed lease, with failure cleanup and no user PC dependency | Not proved |

## G3.2 implementation contract (PR #147; acceptance pending)

A **manual, reviewed-main** `runtime-provider-browser-controller.yml` dispatch
accepts `gate3_worker=true` and a pinned `gate3_date`. The Controller
supplies only an allowlisted non-secret Provider task profile, immutable
source SHA, Controller Run ID/attempt and date to the new ephemeral Worker.
The Provider rejects incomplete/malformed task metadata before dispatch,
and OIDC binds the new Worker Run and reverse WebSocket to the Lease.

The Worker reads the pre-existing two-part ChatGPT Session Secrets only
within its main-only isolated content step, and runs the existing synthetic
`session-acceptance.ts` and `gate3-trace-verify.ts` directly inside the
Worker. No Session data is passed via Controller, Gateway, Worker inputs,
repository, MCP tools, logs, artifact or profile export. Checkout uses
`persist-credentials: false`. This executes **content generation only**;
it does not invoke ChatGPT's GitHub Connector or perform a cross-repo write.

After real Worker registration, the Controller polls only
`read_file(gate3-artifact.json)` through the authenticated routed MCP
membership. It recomputes the public article/trace validation and requires
the **actual dispatched Worker Run ID**, pinned date and immutable hash.
Malformed results fail closed. Only after this does it complete the Lease,
observe provider Worker cancellation, and emit a sanitized
`queqiao.gate3.controller-complete.v1` receipt tying Controller Run/attempt,
Worker Run, Task ID, logical date key, SHA, environment and disposed Lease.
A real successful hosted Controller/Worker pair and independently downloaded
proof are still required before marking G3.2 PASS.

Legacy public-only Browser tests remain separate. Pull requests do not run
the live G3.2 mode. There is no automatic Connector write, signal-notes
publication or production schedule change.

## G3.2 actual same-task hosted acceptance — 2026-10-13

PR #147 merged to reviewed main `9d57a47fa0295dae10aadd073f5d1921a8da2330`
after **15 required CI checks SUCCESS**. Manual
[Controller Run 38365316946](https://github.com/tibame201020/Queqiao/actions/runs/38365316946)
SUCCESS dispatched its own distinct
[Worker Run 38365362251](https://github.com/tibame201020/Queqiao/actions/runs/38365362251)
at the same commit, then observed OIDC/reverse WebSocket enrollment.
The Worker itself completed a real authenticated ChatGPT synthetic UI task
(`authenticated`, user/assistant turns and generationCompleted all true).
Its locally verified public artifact had task
`gate3-38365362251-1`, logical target
`gate3/synthetic-2026-10-13`, pinned date and article SHA-256
`6f3c999b0d11db0744f9febe80072ed2a29cbfe7aeb5d14441a65f0018bd4d60`.

The same Controller used authenticated, correctly routed MCP `read_file`
to inspect the actual Worker artifact and independently verify the exact
Worker Run, task, date, path, hash and unchanged downstream `not_observed`
states. It then verified Lease
`ee9f4f43-777b-4578-8fce-e7a4de693898` as `disposed` and the
Worker GitHub conclusion as `cancelled` (expected provider disposal).
Controller SUCCESS uploaded the sanitized, public
`gate3-worker-proof-38365316946-1` (artifact ID `11796806963`).
The artifact was independently downloaded and its exact shape and all
critical correlation fields were checked against the two Run logs.
No article body, Session Secret, browser profile or account data was
uploaded as proof.

**G3.2 PASS applies to this one correlated hosted content execution only.**
GitHub Connector and target content CI remain `not_observed`; this was not
a cross-repo publication or full Gate 3 completion. The runtime was hosted,
but physical PC-off was not independently witnessed. Keep #124 OPEN.

## G3.1 actual acceptance — 2026-10-13

PR #145 merged reviewed-main SHA `204afe0c89ef6339e99a8b552276a09177b83698`
after 15 required CI checks passed. Real hosted
[Run 38359475732](https://github.com/tibame201020/Queqiao/actions/runs/38359475732)
completed SUCCESS with authenticated user and assistant turns and finished
synthetic answer. In-job trace verification completed successfully before
upload. The seven-day public artifact `gate3-synthetic-38359475732-1`
(ID `11794465320`) was independently downloaded and verified:
`taskId=gate3-38359475732-1`,
`logicalKey=gate3/synthetic-2026-10-13`,
`articleSha256=225580b6e3a7d7d8746256248812fe1383e2f2d053d76aa03704ff6e50aa4c71`,
same path and `draft: true`. Worker, Connector, target CI and lease all
remain `not_observed` in this trace; earlier independent demonstrations
cannot be pasted together into one completed task.

## G3.1 trace contract

`gate3.trace.v1` is generated only from a successfully validated
`gate3.receipt.v1` + exact draft article. The public artifact contains
`article`, `path`, `receipt`, `trace`. A separate GitHub Actions
step independently recomputes and validates every field against
`github.run_id` and `github.run_attempt` **before** upload. Invalid
or extra fields, a mismatched hash/path, wrong run, or any fabricated
downstream stage stop the job. No raw browser state or secret enters the
trace or PR CI.

The manual Gate 3 dispatch requires `gate3_date=YYYY-MM-DD` when `gate3=true`. GitHub persists that input across reruns; CI validates the date before restoring the session. A rerun after midnight must not silently switch the target date. There is no enabled production schedule.

`logicalKey=gate3/synthetic-YYYY-MM-DD` is stable across reruns, whereas
`taskId=gate3-<run_id>-<run_attempt>` distinguishes attempts. The pure
`assessGate3Target` rejects a known duplicate logical target; it is **not**
an atomic publication claim and is not currently used to write GitHub.
Never interpret its unit-test pass as cross-run idempotent publication.

The trace starts with stage `content_validated`. `worker`,
`connector`, `targetCi` and `lease` are all `not_observed`.
There is no synthesized success for disconnected runs. Future stage
evidence must originate from actual provider receipts and independent
remote observation, all bound to the same task identity.

## Previously independently proven substrate (not combined)

- Authenticated content, [Gate 3 Run 38355846584](https://github.com/tibame201020/Queqiao/actions/runs/38355846584): validated public synthetic artifact on main, not a Connector write.
- Gateway/Worker/public Browser, [Controller Run 38357477604](https://github.com/tibame201020/Queqiao/actions/runs/38357477604) and distinct [Worker Run 38357516610](https://github.com/tibame201020/Queqiao/actions/runs/38357516610): authenticated MCP run/read, public synthetic DOM action and disposed lease. Not an authenticated ChatGPT task.
- [signal-notes Draft PR #2](https://github.com/tibame201020/signal-notes/pull/2): manually coordinated through already authorized GitHub Connector, not autonomous CI Connector invocation.

Only GitHub Secrets hold existing Session transport. No credentials, session
capsule, raw conversation, screenshot, user identifier or profile in repo,
logs, trace, PR or artifacts. Keep Issue #124 OPEN until G3.2–G3.5 pass.
