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
| G3.3 | Supported Connector invocation boundary | Explicitly supported authorization and real tool invocation from the approved control plane; an observed ChatGPT reply or authenticated browser alone is insufficient | **NOT PASSED**: App UI selected and pre-Enter public draft confirmed in CI, but no displayed user turn or observed Connector result in live hosted read probe; prior safety-rejected write must not be rerouted |
| G3.4 | Restricted test publication and true idempotency | One date-specific test branch, one draft PR, exact article hash, independently verified commit and CI. Atomic target claim/remote conflict handling prevents retries from creating duplicate publication | Not proved |
| G3.5 | Unattended full E2E/PC independence | One run links task, Worker, content, Connector, commit, CI and disposed lease, with failure cleanup and no user PC dependency | Not proved |

## G3.3 read-only capability experiment (PR #149 onward; live acceptance ongoing)

An independent, reviewed-main-only manual `browser-harness-session-portability.yml`
dispatch may select `connector_read_probe=true`. This restores the existing
Session with the normal Gate 1 authentication controls, uses the **normal
user-facing ChatGPT App selector** to select GitHub, and submits **one**
public READ-only request for this Queqiao repository's default-branch HEAD
SHA. It must not substitute a textual `@GitHub` mention for actual App
selection. The main-only workflow compares the answer with its separately
pinned `github.sha` and requires a visible native tool card; a model claim,
matching answer without tool evidence, nonselection, challenge, timeout or
uncertain send is failure, not Connector proof. The verifier exposes only
bounded stage/boolean results. No new credential, API impersonation,
private data export, extra PAT, artifact, publication, GitHub write or PR
Secret is involved. Any safety or authorization rejection stops the probe;
there is no alternative routing around it.

This is a narrow **CI Browser App-read capability preflight**. It cannot
complete G3.3 on its own: a supported, approved same-controller control-plane
invocation and actual result correlation remain to be demonstrated. It does
not change the G3.2 PASS evidence or enable G3.4/G3.5.

### Actual read-only hosted observation — 2026-10-13

[Run 38376419572](https://github.com/tibame201020/Queqiao/actions/runs/38376419572)
on reviewed main `a4432706eb2d006330c3ed05472964f4065b2700` had successful
unit-tests and a FAILED live Session/Connector preflight. The sanitized
`queqiao.gate3.connector-read-preflight.v1` reported
`stage=app_selection`, `appSelected=false`, `toolObserved=false`,
`submitted=false` and `writeAttempted=false`. Normal `@GitHub` App
selection was not observed by this bounded UI probe; no prompt was
submitted, and no GitHub tool call or write was made. This result
**does not establish absent Connector OAuth nor permanent CI App
unavailability**: the selector/menu semantics must be independently
diagnosed in a further read-only slice. G3.3 remains NOT PASSED.
Issue #124 records the evidence; the previous separate safety rejection
of replayed-session-based automated Connector writing remains in force.

### G3.3 read-only native App diagnostics — 2026-10-13 (NOT PASSED)

- [PR #151](https://github.com/tibame201020/Queqiao/pull/151) added a seven-boolean native UI selector diagnosis (15 required CI PASS). Actual [Run 38380049699](https://github.com/tibame201020/Queqiao/actions/runs/38380049699) failed preflight; App selection not reached.
- [PR #152](https://github.com/tibame201020/Queqiao/pull/152) added a six-boolean fail-closed preflight diagnosis (required CI PASS). Actual [Run 38381085070](https://github.com/tibame201020/Queqiao/actions/runs/38381085070) observed authenticated=true, valid run/SHA=true, blankStart=true, editorEnabled=true, but editorVisible=false.
- [PR #153](https://github.com/tibame201020/Queqiao/pull/153) added one bounded normal Composer visibility wait (required CI PASS). Actual [Run 38381895492](https://github.com/tibame201020/Queqiao/actions/runs/38381895492) passed all six preflight signals. After normal @GitHub input, the visible native UI exposed a GitHub button/text, but no menu/listbox/dialog, option or menuitem.
- [PR #154](https://github.com/tibame201020/Queqiao/pull/154) accepted only a **unique** GitHub button absent before @GitHub and appearing after input (TDD RED/GREEN; required CI PASS, Windows Full Test PASS on one unchanged rerun). Reviewed main `fdc13942eb05a029a97bd69de7222db202ee22e5`, actual [Run 38383435702](https://github.com/tibame201020/Queqiao/actions/runs/38383435702): six preflight signals true; `appSelected=true`; `submitted=true`; `toolObserved=false`; `writeAttempted=false`. Failed at `tool_observation`, so **no independently observed GitHub tool result and no SHA-verified read**.

The App selector obstacle is narrowed, not the Connector authorization boundary itself. The existing narrow tool-card selector may not match normal ChatGPT UI, or no tool invocation may have occurred. Do not infer which without actual evidence. Next bounded experiment may diagnose sanitized user-visible tool/assistant/refusal semantics, but an Assistant claim or matching SHA alone is never proof of actual GitHub App tool invocation. No credential replay, direct GitHub API fallback, challenge bypass, raw response, screenshots, app inventory or cross-repository write. G3.3, G3.4 and G3.5 remain NOT PASSED; signal-notes/main and the daily scheduler are unchanged.

### G3.3 hosted tool and user-turn findings — 2026-10-13 (NOT PASSED)

- [PR #156](https://github.com/tibame201020/Queqiao/pull/156) merged as `9a7b7db4acc1bb7052410fd63749a01db7bfffcb` after all required CI PASS. Its real [Run 38391032937](https://github.com/tibame201020/Queqiao/actions/runs/38391032937) observed native App UI selection and one Enter; no known GitHub tool card, Assistant SHA, or `UNAVAILABLE` answer. Diagnostic: `no_observed_reply`. This does not establish whether a Connector invocation occurred.
- [PR #157](https://github.com/tibame201020/Queqiao/pull/157) merged as `881d68d9938c332ee268fea334d80d5a1167ad34` after all required CI PASS. Its real [Run 38392200632](https://github.com/tibame201020/Queqiao/actions/runs/38392200632) recorded `userTurnVisible=false`, `assistantSurfaceVisible=false`, `stopVisible=false`, `composerEnabled=true`, `dialogVisible=false`; a successful Enter was not an independently confirmed user turn.
- [PR #158](https://github.com/tibame201020/Queqiao/pull/158) added a fail-closed visible user-turn gate (TDD RED/GREEN, all required CI PASS, merged `e0c3c1094b692b48ff1e24ef8338594f573fa72f`). Its real [Run 38393395432](https://github.com/tibame201020/Queqiao/actions/runs/38393395432) FAILED at `user_turn` with `conversationCreated=true`, `promptEchoOutsideEditor=false`, `promptStillInEditor=false`. This does **not** establish whether submission failed or the mention-augmented message was rendered in a way the substring locator missed.

`submitted=true` in older receipts meant **one Enter key press**, not confirmed delivery. Do not infer absent Connector authorization from a missing Assistant/tool response where the user turn itself is unconfirmed. No second send, Session/cookie export, undocumented API fallback, credential replay, GitHub write, cross-repository publication or scheduler change is allowed. G3.3 remains NOT PASSED; future supported semantic UI evidence must independently establish the displayed user turn, selected App and real tool result. Issue #124 retains exact run-specific receipts.

### G3.3 submission/render boundary — PR #160–162 (2026-10-13; NOT PASSED)

- [PR #160](https://github.com/tibame201020/Queqiao/pull/160), merged `5cde18c2f138d56dd54a981935ce042d115e9bed` after all 15 required CI PASS, added native user-role and two public-fragment verification. [Run 38404274294](https://github.com/tibame201020/Queqiao/actions/runs/38404274294) confirmed authenticated Session and App UI selection but saw no user-role container or PUBLIC prompt fragments.
- [PR #161](https://github.com/tibame201020/Queqiao/pull/161), merged `892b2b7da54af03dc49863b4d9d3d7ce45325f36` after all required CI PASS, added **pre-Enter** Composer focus/content gate. Real [Run 38405379918](https://github.com/tibame201020/Queqiao/actions/runs/38405379918): all four draft signals were true (`editorFocused`, `middleInEditor`, `tailInEditor`, `editorEnabled`). Thus missing keyboard focus/input is ruled out for that Run; no post-Enter user turn was observed.
- [PR #162](https://github.com/tibame201020/Queqiao/pull/162), merged `856e70e78d4b0cd7727ab59d0a2111d09450ad6d` after all required CI PASS, added bounded post-send UI structure diagnostics. Actual [Run 38406723061](https://github.com/tibame201020/Queqiao/actions/runs/38406723061) again passed pre-Enter draft gate and observed conversation URL plus cleared Composer, but returned `no_visible_public_turn`: `mainVisible=true`, no native user container, no PUBLIC middle or tail in either main or visible body, no Assistant surface/dialog/challenge. This cannot establish whether backend delivery failed or the normal App-enabled UI is not rendering the submitted turn; no actual GitHub tool call/result was observed.

**Stop condition:** Do not keep varying keyboard/selector guesses or infer OAuth from a logged-in browser. Before another hosted App-enabled send, resolve the supported normal UI submission/tool-provenance boundary or independently demonstrate a product-supported control-plane invocation. Do not replay credentials into a denied integration route, add an independent cross-repo PAT, disable safety, log private session/transcript, or write to signal-notes. App selection, Enter, URL creation, Assistant claim or coincidental SHA are individually insufficient for G3.3 PASS. G3.4/G3.5 remain NOT PROVED.

### G3.3 A/B control experiment — same CI commit, independent fresh conversations (2026-10-13)

[PR #164](https://github.com/tibame201020/Queqiao/pull/164) repaired only the A1 no-App control preflight by reusing the existing bounded Composer wait and four boolean-only readiness signals. TDD RED/GREEN and all required CI PASS; Windows Adversarial Gate passed one unchanged rerun after an unrelated isolated CLI acceptance failure. Squash-merged main `1952ed34441f1593633fe8d1d03a8ba8423825f9`. A1/B1 both used that exact main commit, the same hosted workflow and independent manual dispatches (one new conversation and one send per run). No screenshots, raw transcript, session export or additional credentials.

| Arm | Actual hosted run | Observed outcome | Status |
| --- | --- | --- | --- |
| A1 / no App, `gate2=true` | [38410057637](https://github.com/tibame201020/Queqiao/actions/runs/38410057637) | `queqiao.gate2.receipt.v1`: promptSubmittedOnce=true, userTurnObserved=true, conversationCreated=true, assistantObserved=true, generationCompleted=true; validated synthetic answer | **PASS** |
| B1 / native GitHub App UI, `connector_read_probe=true` | [38410260833](https://github.com/tibame201020/Queqiao/actions/runs/38410260833) | Authenticated Session; selected visible GitHub App control; before Enter focused Composer contained both public prompt fragments. After Enter conversation URL created and Composer cleared, but no observed native user turn or public fragments in main/body, Assistant UI, dialog or challenge. `toolObserved=false`; `writeAttempted=false` | **FAIL CLOSED at user_turn** |

**Inference boundary:** No-App ChatGPT UI submission/completion is independently proven in the current hosted runtime. The App-enabled message submission/rendering boundary is not proven. This neither establishes missing GitHub OAuth nor a real GitHub tool invocation, and does not prove that the backend received or rejected the App-enabled request. App UI selection, an Enter key press, conversation route, matching model claim or independent connector authorization in this chat are **not** interchangeable with a provider tool-execution receipt.

**Stop/next:** Do not continue guessing selectors, trying alternative credential replay, bypassing environment refusal or sending duplicate prompts after uncertain sends. Obtain an explicitly product-supported App-enabled submission + tool-provenance surface/control-plane authorization. Only after an actual provider tool invocation and independently matched read-only result can G3.3 progress; only then consider G3.4 test branch/Draft PR and G3.5 correlated E2E. No new PAT or signal-notes/main/schedule changes.

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
