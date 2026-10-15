# Issue #124 — Complete Gate 3 delivery and evidence contract

Gate 3 is NOT considered complete merely because its independent CI browser,
authenticated ChatGPT content, and manually coordinated GitHub Connector tasks
have individually succeeded. Acceptance requires one correlated execution.
This document is the scope and progress ledger, not an assertion of completion.

**CURRENT G3.4/G3.5 CONTRACT (ADR-0017; accepted 2026-10-15):** ChatGPT uses the existing connected GitHub App for the separately approved test-branch/one-file/Draft-PR write. Queqiao Hosted Worker supplies the strictly validated synthetic result and original **read** audit. GitHub independently supplies commit/blob/PR and exact-head content CI readback. Correlate these without calling the GitHub App action a Gateway action. **No second App, `G34_APP_ID`, `G34_APP_PRIVATE_KEY`, PAT or Hosted target credential is mandatory for this delegated POC.** Sections below about a CI-usable installation token and original Gateway **write** event describe a historical proposed Hosted-autonomous alternative; they are superseded as *G3.4 acceptance requirements* but retained for traceability. The optional PR #181 writer remains unregistered/default-disabled. G3.3 Route B PASS and historical results remain unchanged. **G3.4/G3.5 PASS (ADR-0017 delegated POC)** was subsequently independently accepted using Hosted Run 38677390566, the original public article, observed native connected-App writes and successful exact-head target CI 38678003939. Earlier separate runs and operator-assisted target PR #3 were not reused or promoted.

### G3.4/G3.5 final joined acceptance (2026-10-15; immutable original evidence)

**G3.4/G3.5 PASS (ADR-0017 delegated POC)**. [Queqiao PR #183](https://github.com/tibame201020/Queqiao/pull/183) was merged into reviewed source `main` `e8d255e1af5f3e48ff27af87587ae447e48f678e` after required CI 13 SUCCESS / 4 expected skipped / 0 failed and local 1346 passed / 23 skipped / 0 failed. Main-only manually approved [Controller Run 38677390566](https://github.com/tibame201020/Queqiao/actions/runs/38677390566) (`gate3_worker`, `gate3_mcp_audit`, `gate3_delegated_handoff` all selected) created real authenticated synthetic ChatGPT content on ephemeral Worker Run `38677426703`. Both `phase3-e2e` and independent `gate3-audit-recheck` SUCCESS, with distinct original Gateway `gate3.read_artifact` / `gate3.read_public_head` events. Controller independently verified Worker `cancelled`, lease `42462270-e86e-4786-a959-cfc56dc85772` `disposed`, then published only the bounded public synthetic handoff (GitHub Actions artifact `11946399405`, original ZIP SHA-256 `1211f7c32c251f5c3014cda8ae00a6009e548bbf480805e65384343c38a25b13`, 7-day retention). Four original Actions archives were fetched independently through the existing connected GitHub App and matched by Controller/Worker ID, task, date, source revision, original audit event IDs and cross-file hashes. The handoff's stage `publication=not_observed` / `fullGatePassed=false` remains historical truth for the **pre-publication** CI run; do not mutate it to indicate downstream actions.

On separate explicit owner approval, ChatGPT actually invoked the **existing connected GitHub App** to create `tibame201020/signal-notes` branch `gate3/synthetic-2026-10-16`, add **only** `src/content/posts/gate3-synthetic-2026-10-16/index.md` (28 lines, `draft: true`), then open [Draft PR #4](https://github.com/tibame201020/signal-notes/pull/4) (`OPEN/DRAFT`, unmerged). Original article SHA-256 `46dcbc5f7576e9612f7cfe86d2336f6bbf1d0235d433cf683a007ebbc179ec14` was independently bound to target Git blob `c906b01e9cd6b52dd22a0b824f7fd075d41aac99`, read back via the connected App and original GitHub REST. Target commit `d35b7e2bee2502d22823b6912067851d8eeb18ee` had exactly one parent, the pinned target base `96c05a2434ddb1829cc6be3f8189439cf3a71ce7`, and exactly one `added` path. [Target `content` CI Run 38678003939](https://github.com/tibame201020/signal-notes/actions/runs/38678003939) and original job `116235895440` completed `success` on that **exact head SHA**. Post-write readback showed **signal-notes/main remains at `96c05a2434ddb1829cc6be3f8189439cf3a71ce7`** and the test branch remained at the exact tested head; no merge or schedule change. Full sanitized original provider-attributed evidence is also archived in [Issue #124 final acceptance comment](https://github.com/tibame201020/Queqiao/issues/124#issuecomment-6183950548).

**Provider boundary:** Gateway read provider = `queqiao_custom_mcp`; ChatGPT connected GitHub App write provider = independently observed native branch/file/PR actions. Their successful functional handoff is verified by shared immutable task/date/article SHA and trusted original GitHub data; a matching hash alone is *not* product-native App attestation. No new GitHub App, target PAT, Gateway original GitHub write claim or exported App token. There was no production 05:00 schedule switch. This **does not prove an App action inside the CI runner**, unattended autonomous publication, or a physically switched-off personal PC (**no physically powered-off PC assertion**). G3.5 demonstrates no always-on personal PC runtime dependency: the ChatGPT Browser Harness/Queqiao Worker were GitHub-hosted; the interactive ChatGPT-controlled target write is allowed by ADR-0017. Optional Hosted autonomous writer PR #181 remains disabled; #170 Windows Adversarial remains separate.

**Slice B native UI-only preflight:** `native_mcp_preflight` manual reviewed-main CI mode now checks whether the restored ChatGPT session visibly offers a Queqiao app candidate, with no Send or tool execution. This cannot establish a fixed endpoint or native MCP invocation; #185 remains NOT ACCEPTED until two independent original Hosted proofs. See ADR-0018 for exact limitations.

**Verified Slice B result (Runs 38686156534 and 38687047541): Queqiao candidate NOT OBSERVED** in a first-party-authenticated CI ChatGPT session; GitHub same-session positive control candidate visible in the second run. Both native tool execution and fixed ingress remain unverified. Original sanitized receipts/digests: see ADR-0018; source Issue #185 remains OPEN / NOT ACCEPTED.

**Named Tunnel transport: VERIFIED (private Hosted Run 38689173302)** ? existing owned fixed DNS, ephemeral cloudflared connector, worker membership, external health 200, unauthenticated MCP 401, TLS valid and Cleanup all independently confirmed. Offline same hostname returns 530: persistent dispatch and same-CI ChatGPT model-native tool invocation remain MISSING; this is NOT #185 full architecture acceptance. See ADR-0018.

**Architecture follow-up [#185](https://github.com/tibame201020/Queqiao/issues/185) / [ADR-0018](adr/0018-ci-native-chatgpt-runtime-acceptance.md): NOT ACCEPTED as a separate, stronger gate.** The G3.4/G3.5 PASS above is for ADR-0017 interactive delegated publication only. It does not prove that the ChatGPT session *inside CI* natively invokes Queqiao through a stable URL, provisions runtime on actual model demand and receives a routed result in the same conversation. Existing controller-script MCP calls, per-run quick tunnel, and external ChatGPT App writes do not count. Preserve previous source receipts and scoped PASS without promoting them to this new architecture gate.
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
| G3.3 | Supported Connector invocation boundary | Approved Route B same-task custom MCP public GitHub HEAD, original Gateway audit and independent post-run witness | **PASS (Route B CI OAuth scope): PRs #177/#178; Hosted Run 38585809542**; native GitHub App L3 remains separate |
| G3.4 | ChatGPT-delegated test publication and true idempotency (ADR-0017) | Same-task Hosted Worker artifact ? approved action via existing connected GitHub App ? one date branch/file/Draft PR ? original GitHub content/commit/PR readback and exact-head target CI; separate provider attribution | **PASS (ADR-0017 delegated POC): original Hosted Controller 38677390566 / Worker 38677426703; actual connected-App Draft PR #4, source article SHA-256 46dcbc5f7576e9612f7cfe86d2336f6bbf1d0235d433cf683a007ebbc179ec14; exact-head target content CI 38678003939 SUCCESS** |
| G3.5 | Full cloud-delegated E2E / PC independence (ADR-0017) | Correlated Worker task, ChatGPT connected-App action, target commit/CI, independent readback and disposed lease without an always-on user PC; explicit user/ChatGPT orchestration permitted, autonomous scheduler separate | **PASS (ADR-0017 delegated POC): independent post-Run readback, original Gateway read events, verified `leaseState=disposed` and Worker `cancelled`; no always-on PC runtime dependency. No claim the physical PC was off or App invocation occurred inside Actions** |

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

### G3.3 layered observer correction (PR #166; actual hosted L1/L2 PASS)

The previous `user_turn=false` is a **headless observer result, not proof of missing delivery**. A user-provided normal ChatGPT UI screenshot (not copied into this repository) shows the native GitHub App mention, a rendered user message and a correct historical HEAD SHA `e0c3c1094b692b48ff1e24ef8338594f573fa72f` at 19:54 Asia/Taipei. GitHub confirms this exact HEAD was created at 19:53:41 and was replaced only at 20:01:04. Hosted Run 38393395432 was executing from 19:53:50 to 19:55:23 against that commit. This strongly suggests an observer false negative; the screenshot lacks an independently captured Run ID/URL pair and provider execution receipt. Do not assert a causal linkage from matching timestamps alone.

PR #166 retains one standard native GitHub App selection and **exactly one** normal Enter. Before submission the Composer must contain the complete PUBLIC prompt and a `QG3-<run_id>-<run_attempt>` marker. The reply remains SHA-only. The verifier tracks three independent levels:

- **L1 UI delivery:** normal conversation route, unique PUBLIC marker rendered outside the Composer and Composer cleared; no mandatory undocumented user-role attribute
- **L2 UI result:** L1 plus complete, stable 40-character Assistant SHA outside the Composer/user turn and exact equality with the independently pinned `github.sha` of the reviewed-main workflow
- **L3 provider execution:** a real, authorized provider tool-execution receipt correlated to this task; a matching SHA, native App badge or DOM tool card alone is **not sufficient**

If the rendered marker is not observed after a bounded wait and generation is settled, the harness may reload the **same existing conversation once**, without ever resubmitting. An uncertain state is recorded as `observer_unconfirmed`, not a claim that the user message failed. `ui_verified` represents **only** L1+L2, not full G3.3. `providerReceiptVerified=false` and `l3=not_proved` remain explicit until an independently supported control-plane receipt exists. The CI log contains only run metadata and bounded booleans/enums; no private conversation URL, user screenshot, raw response, Session, credentials or account identity is committed or uploaded. PR CI cannot restore Session; only reviewed-main manually dispatched hosted E2E may do so.

#### Verified reviewed-main layered POC — 2026-10-14

PR #166 passed all required unit/Windows/Linux CI checks and was squash-merged to `623f326b380ab5bbf34a4ad512261f4ad453909c`. Its reviewed-main manually dispatched [Hosted Run 38515396065](https://github.com/tibame201020/Queqiao/actions/runs/38515396065), attempt 1, executed exactly that commit. Both the unit-tests job and the real Session portability job completed **SUCCESS**. The sole bounded `queqiao.gate3.connector-layered.v1` receipt reported:

- Public Run Marker: `QG3-38515396065-1`, matched in the normal rendered user-facing conversation; `markerSeen=true`
- `status=ui_verified`; `appSelected=true`, `submitted=true`, `replySeen=true`, `replyStable=true`
- `l1=confirmed`, `l2=confirmed`, `l3=not_proved`
- SHA-only reply matched the independently pinned workflow `github.sha` (the reviewed main commit above); the raw answer and private conversation URL were never logged
- `reloaded=true`: one same-conversation reload occurred without any additional submission
- `toolUiObserved=false`, `providerReceiptVerified=false`, `writeAttempted=false`

**Acceptance boundary:** Actual hosted UI L1/L2 PASS resolves the earlier false-negative observer ambiguity. A successful workflow with `ui_verified` is intentionally NOT complete G3.3: the approved provider's tool-execution receipt tied to this exact run is still missing. G3.3 remains **NOT PASSED** at L3, and G3.4/G3.5 remain NOT PROVED. Continue only through supported authorization/tool-provenance channels; do not replay browser credentials, infer provider invocation from matching SHA, mutate signal-notes, or add an independent PAT.

### G3.3 L3 native App provenance boundary — PR #168

The reviewed-main [Run 38515396065](https://github.com/tibame201020/Queqiao/actions/runs/38515396065) already proved native GitHub App UI delivery and exact stable pinned HEAD: **L1/L2 PASS**. Browser Harness has no independently authenticated native GitHub App execution record for that specific conversation; `toolUiObserved=false` and `providerReceiptVerified=false`. Re-running the same public SHA lookup adds no provider provenance. The native GitHub App is not the same as Queqiao's separate custom MCP Connector; a successful custom MCP read or separate in-chat GitHub App call must not be substituted.

**Authoritative source and access:** OpenAI documents that App calls are recorded in its Compliance Logs platform. The Compliance Platform is available to eligible Enterprise/Edu workspaces, subject to the required admin permissions and app-log coverage; access is not implied by browser login or a connected user account. The present CI workflow has no approved, authenticated original app-activity log producer or supported provider receipt. No new Admin key, user credential, PAT or Compliance export has been requested or added.

The `connector-l3-evidence.ts` pure classifier rejects `normal_ui`, `independent_github_read` and `another_chat_tool`. A candidate requires a separately approved original App activity record, independently authenticated by a trusted producer and correlated to **the same conversation, public Run Marker, GitHub read action and provider result**. Even this only returns `candidate_for_independent_review`, not an automatic L3 PASS. A record's self-declared `source` or booleans alone do not authenticate its origin. There is currently no trusted producer wired to the CI browser process; do not invent one from intercepted private APIs, tokens or session cookies.

**Runtime safety fix:** `assessReadLayers` is now UI-only and hard-stops at `l3=not_proved`, even if a caller injects a forged `providerReceiptVerified=true` field. The emitted public read-only receipt retains its explicit `providerReceiptVerified=false` diagnostic. Future L3 promotion requires a product-supported independent authenticated provider verification implementation, new TDD and real hosted evidence. G3.3 remains NOT PASSED until then. Do not expand to G3.4/G3.5 or modify signal-notes/main/schedule.

Official product references:
- https://help.openai.com/en/articles/11487775-connected-apps-in-chatgpt
- https://help.openai.com/en/articles/11509118-admin-controls-security-and-compliance-for-plugins-and-apps
- https://help.openai.com/en/articles/9261474-compliance-api-%20forenterprise-customers

### G3.3 next provider decision (Proposed ADR-0016; no scope change yet)

Official product guidance confirms app calls are part of OpenAI Compliance Logs, but the platform requires an eligible Enterprise/Edu workspace and authorized access; per-App activity record coverage and correlation fields must be verified independently. No supported original native GitHub App activity log producer is connected to this POC. Separately, Queqiao has an OAuth MCP Gateway and a rotating redacted audit store, but no independently retained, same-task GitHub tool-execution receipt. Neither a correct Browser answer nor existing generic audit events completes G3.3.

[ADR-0016](adr/0016-gate3-provider-provenance.md) is **Accepted: Route B, Queqiao custom MCP**, by explicit owner approval on 2026-10-14. The native GitHub App L1/L2 PASS remains historical UI evidence only; it cannot satisfy custom MCP tool execution. The new L3 requires an authenticated, server-originated and independently verified same-task receipt. #170 Windows Adversarial must be repaired first, with full CI; this provider selection does not enable a write tool, grant new credentials, or mark G3.3 complete. G3.4/G3.5 NOT PROVED.

### G3.3 Route B receipt contract — PR #173 (implementation pending)

ADR-0016 now accepts **Queqiao custom MCP** as the future Gate 3 execution provider. This is a replacement acceptance route, **not retrospective proof** of native GitHub App invocation. The completed native App UI Run 38515396065 remains historical L1/L2 evidence only; a new, same-task custom MCP hosted run must be validated before Route B L3 PASS.

PR #173 starts with a pure fail-closed `queqiao.gate3.connector-execution.v1` verifier. A candidate must match the expected Controller and Worker IDs/attempts, environment, lease, task/logical target, repository, read-only tool action, request/result SHA-256, non-identifying principal digest and original event ID, and have a **separately authenticated Gateway audit witness** for the identical event/action/task/result. Extra/private fields, fabricated success, wrong provider, a self-attested UI/model receipt or unrelated GitHub read are rejected. The verifier returns at most `candidate_for_independent_review`, not `L3=verified`. A trusted server-originated recorder, durable independent retrieval, supported connected-app invocation and real hosted same-task acceptance are **subsequent** TDD deliverables; this schema is not their implementation.

No new OAuth privilege, GitHub PAT, production writing, schedule switch or signal-notes mutation is part of this PR. Existing #170 Windows packaged CLI regression remains independently tracked and necessary CI may not be waived.

### G3.3 Route B — server-side audited Worker read (implementation slice; not hosted L3 PASS)

The opt-in `Gate3McpAuditRead` service in `apps/gateway/src/poc-gate3-audit-read.ts` is wired through the actual authenticated Gateway `/mcp` / `tools/call` path as `gate3_read_artifact`. The service is **absent by default**: only a trusted server-side Controller injection may register it, and it accepts **no caller-controlled task/lease/repository input**. Actual enabled production/hosted wiring has not yet been implemented.

The service requires an OAuth principal with `queqiao:access`; a fresh, ready/running Runtime Lease whose actual Worker, provider Run/environment and immutable controller metadata match the server-side binding; a read permission for `runtime/gate3-artifact.json`; the real WorkerRegistry routed read; and `verifyRoutedGate3Content` (content trace and route validation). It derives the request and result SHA-256 from the executed operation, generates an event ID in the Gateway and **awaits** `AuditLogStore.append` before returning a sanitized `queqiao.gate3.connector-execution.v1` receipt. Uncertain/failing executions cannot be retried inside the one-shot service. The normal `AuditLogStore` is rotating JSONL and does **not** itself provide an independently signed remote attest; the verifier can reopen the store and correlate its original event, but this is only `candidate_for_independent_review`, never automatic L3 PASS.

TDD includes malformed/expired lease, wrong route, denied/failed Worker read, audit append failure, duplicate invocation, missing OAuth principal, opt-in tool exposure and real MCP Client `tools/call` propagation. Full G3.3 still needs actual hosted Controller/Worker injection plus independently retained and re-fetched source evidence, without publishing to signal-notes or adding credentials. The historical native GitHub App L1/L2 Run 38515396065 remains separate.

### G3.3 Route B hosted original audit candidate (new opt-in; acceptance pending)

The normal `runtime-provider-browser-controller.yml` now has a separate, disabled-by-default `gate3_mcp_audit` input, only valid together with `gate3_worker` on manually dispatched main. The Gateway boot process enables `gate3_read_artifact` only with that explicit Controller opt-in and checks the local GitHub Actions event/ref. A deferred, single-use service derives the **unique** ready Worker Lease from the actual `GitHubActionsRuntimeCoordinator.list()`, matching original Controller run/attempt/date and immutable `GITHUB_SHA`; model tool input is empty and cannot choose a Lease. It refuses ambiguous/expired/wrong-worker records. OAuth, real routed Worker read and server-side audit append remain mandatory.

After the original same-Worker G3.2 synthetic artifact becomes available, the Controller makes **one** audited MCP tools/call, checks the response against the independently validated G3.2 proof, then reopens Gateway's original audit JSONL in another process. A sanitized `queqiao.gate3.hosted-audit.v1` record (only public run/commit identifiers, synthetic proof, original redacted event and SHA-256, ephemeral non-identifying principal digest) is archived in a seven-day immutable GitHub Actions artifact. A separate `gate3-audit-recheck` job with `actions:read`, no session/approval secret and no publishing permission downloads and rechecks that exact same-run artifact.

**Boundary:** this proves only an auditable Queqiao MCP read of the *synthetic Worker artifact* if a real hosted run succeeds. Even `candidate_for_independent_review` is not native-App provenance, not a separately signed product receipt, and not a GitHub HEAD read or `signal-notes` write. Do not mark G3.3 complete or G3.4/G3.5 passed until the accepted target GitHub operation and associated hosted evidence are implemented and checked independently. No PAT, personal conversation, Browser Session, raw model text or user identity enters the repo/artifact. Standard PR CI never restores a live Browser Session.

### G3.3 Route B — verified same-run synthetic Worker audit (2026-10-14)

Implementation: [PR #175](https://github.com/tibame201020/Queqiao/pull/175) merged at `979435313032c44e3c55bc829f7638b1d19e6488`, all 13 required PR CI checks passed. A manual main-only `gate3_worker=true`, `gate3_mcp_audit=true` [Hosted Run 38569718518](https://github.com/tibame201020/Queqiao/actions/runs/38569718518), attempt 1 and exactly that immutable source revision, returned **both jobs SUCCESS**: `phase3-e2e` and a separately executed, credential-free `gate3-audit-recheck`. It did not modify `signal-notes` or publish an article.

The same-task ephemeral Worker Run was `38569775824`. Real verified synthetic content SHA-256: `bb252e084a899bbfd0c45d066c3084690d8d2a0efc6d851917f1391d45f9c69c`. Controller observed actual one-shot Queqiao MCP `gate3_read_artifact`, the server-generated audit event after the routed read, and `leaseState=disposed` / `workerConclusion=cancelled`. Its `queqiao.gate3.hosted-audit.v1` verdict was `candidate_for_independent_review`, `writeAttempted=false`. The separate job downloaded the matching sanitized, seven-day immutable Actions archive and emitted `queqiao.gate3.archive-recheck.v1` with `archivedEventVerified=true`, `githubTargetRead=not_observed`, `writeAttempted=false`.

Source archive: `gate3-audit-evidence-38569718518-1`, Actions artifact ID `11897211276`, size 1004 bytes; it was also re-downloaded through the connected GitHub App. Independently checked ZIP SHA-256: `a7906f179cbcefed5e0f2ffc128e344e4b9cc16c821193c217ea49ae71ea1fa1`. The original sanitized Gateway audit event ID matched receipt.eventId and its recomputed event SHA-256 matched the archived digest. No raw Browser Session, personal identity, OAuth token, raw model output or conversation was exported.

**Acceptance:** the actual Route B synthetic Worker-read + same-run Gateway audit + independently archived/re-fetched witness sub-gate is PASS. **Full G3.3 NOT PASSED**: this tool only read the synthetic Worker content and the accepted GitHub default-branch HEAD **target read remains not observed**. No custom MCP result retroactively proves the native GitHub App call. The legacy G3.2 completion receipt retains `connector:not_observed`; do not silently upgrade that schema. The next TDD slice must implement a separately auditable, same-Controller read-only GitHub target tool and independently verify its result, before reconsidering G3.3. G3.4/G3.5 remain NOT PROVED.

### G3.3 Route B — read-only GitHub HEAD target (PR #177 implementation contract)

The next opt-in tool is `gate3_read_public_head`. It is registered only together with
the existing `gate3_mcp_audit` main-only Controller enablement. Its empty MCP input
cannot choose the target, Run, Lease, repository, OAuth identity or authorization.
It requires the **previous successful audited Worker content read by the same OAuth
principal** and re-resolves the unique live server-side Lease before one fixed public
GET of `tibame201020/Queqiao` default-branch `main` HEAD. The observed SHA must
exactly equal the Controller's immutable source revision; if main moves meanwhile,
the attempt fails closed instead of silently accepting a different target.

A distinct Gateway `gate3.read_public_head` event, with run/attempt, Worker,
environment/lease, task/logical key, request/result hash and pseudonymous OAuth
principal digest, must be appended before the second tool success receipt. No
PAT, replayed ChatGPT session, user-selected URL or GitHub write is involved.
The controller separately reopens the Gateway audit, retains a restricted
`queqiao.gate3.hosted-github-audit.v1` artifact cross-linked to the original
Worker archive by hash and principal digest, and a credential-free separate
job downloads **both** original event archives and checks their correlation,
content SHA, event IDs and tamper resistance. Failure or uncertain execution is
one-shot; there is no replay.

The earlier actual Run 38569718518 proves only Worker synthetic content read,
not this new GitHub target tool. At PR implementation time, G3.3 remained pending a
separate reviewed-main manual Hosted Run and independently re-fetched original
evidence. The next section records that actual acceptance; G3.4/G3.5 are separate gates.

### G3.3 Route B — Hosted public GitHub HEAD audit E2E accepted (2026-10-14)

[PR #177](https://github.com/tibame201020/Queqiao/pull/177) merged via squash at `fc9d54b871b01cbd476a8338f39e5f57a060a8a7` after **13 required CI SUCCESS, 4 expected skipped, 0 failed**, including Windows Full Test and #170's Windows Adversarial gate. [Main-only manual Hosted Run 38585809542](https://github.com/tibame201020/Queqiao/actions/runs/38585809542), attempt 1, used exactly that immutable source SHA, with `gate3_worker=true` and `gate3_mcp_audit=true`. Both `phase3-e2e` and the independent, no-Session `gate3-audit-recheck` jobs completed **SUCCESS**.

The actual ephemeral Worker Run was `38585898277`, environment `gha_066d8f7019504fd0b8a71eb7`, Lease `066d8f70-1950-4fd0-b8a7-1eb7f4282347`. Verified synthetic content SHA-256: `88ddae222643536aa6df235eed2ae6b3933984cef328a1cbcd4d620cf09b9faa`. The same authorized MCP Client first executed `gate3_read_artifact`, then the distinct, opt-in `gate3_read_public_head` against one fixed public GET `https://api.github.com/repos/tibame201020/Queqiao/branches/main`; the observed HEAD matched the pinned `fc9d54b871b01cbd476a8338f39e5f57a060a8a7`. Request SHA-256: `648ae84a29d03cc93cbf25025d0e5bdc4d82d5a50a67006d530d4c5ebb4d2f30`; result SHA-256: `8830c80e22b0abe716fe700704f319bd6a5663e09bf739ef91abfc4c1117c111`.

The two original Gateway event IDs are **distinct**: Worker-read `048dec1a-9bef-402c-8af9-396f5d5ba0ec` and public HEAD-read `da6e695b-a8f2-4a51-a761-847c05dd4d8d`. Reopened Gateway audit, receipts and independently archived events matched Controller Run/attempt, Worker Run/attempt, Lease/environment, task/logical key, request/result hashes and the **same non-identifying OAuth principal digest**, without revealing the principal. Lease ended `disposed`; Worker ended `cancelled` as expected. No GitHub or signal-notes write was attempted.

GitHub Actions retained seven-day sanitized artifacts: Worker completion `gate3-worker-proof-38585809542-1` (ID `11905097866`); original Worker-read audit `gate3-audit-evidence-38585809542-1` (ID `11905132560`); original GitHub HEAD audit `gate3-github-evidence-38585809542-1` (ID `11904858109`). The separate job fetched both event archives and emitted `queqiao.gate3.github-archive-recheck.v1` with `archivedEventVerified=true`, `githubTargetRead=verified`, `provider=queqiao_custom_mcp`, `verdict=candidate_for_independent_review`, `writeAttempted=false`. The original Worker-only archive correctly retains `githubTargetRead=not_observed`; it was **not** modified or retroactively promoted.

A third, separately initiated post-Run download of both archived JSON files, after Controller/Worker termination, re-ran both independent validators successfully. Exact downloaded JSON SHA-256: Worker audit `af7d6d35f90a2ab91e0821146780059b6f4f32f936fcc9791932c275cb2fa45f`; GitHub audit `7781f58ce6250dab07d564b623404be5ea46adfd1b1c8d015b48d0d841141be5`.

**Acceptance: G3.3 Route B hosted read-only Controller/Worker + public GitHub HEAD + independently retained Gateway execution provenance = PASS for the expressly approved CI OAuth MCP scope.** This is **not** original/native ChatGPT GitHub App L3, proof of a separately signed product attestation, or proof of an end-user in-ChatGPT custom-app click. It authorizes no PAT, GitHub publishing permission, production scheduling switch or signal-notes mutation. Gate 3 as a whole is **not complete**: G3.4/G3.5 remain NOT STARTED; Issue #124 stays open for their separate gates. Keep G3.2's legacy `connector:not_observed` receipt unchanged.

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

### G3.4 restricted draft-publication contract (first TDD slice; NOT accepted)

The #177/#178 G3.3 Route B Hosted read is **PASS** in its approved CI OAuth scope. It does **not** grant a GitHub write. `poc-gate3-draft-contract.ts` now implements a side-effect-free G3.4 preflight, with RED (missing implementation) then GREEN four focused tests. It validates the strict synthetic article/receipt/trace against an expected Worker run/attempt and a fixed Queqiao source / signal-notes target. These caller-supplied values are NOT original Worker or provider provenance: the future writer must independently obtain the authenticated live routed Worker proof and both original G3.3 Gateway events for the same task before trusting this preflight. The output is `queqiao.gate3.draft-plan.v1` with `publicationState=preflight_only`, `draft=true`, `mainWriteAllowed=false` and `productionScheduleAllowed=false`. This object is NOT an approval, a remote claim or evidence of publication. Never log the article content.

One logical date maps to **only** `tibame201020/signal-notes` ref `refs/heads/gate3/synthetic-YYYY-MM-DD`, exact path `src/content/posts/gate3-synthetic-YYYY-MM-DD/index.md`, base `main`, one Draft PR. The remote inventory must be obtained from an independently authenticated live GitHub provider, including all PR states for the exact head branch (not just open PRs). A missing/incomplete/unknown inventory, existing ref or any past PR fails closed. An empty snapshot merely authorizes an **attempt** at GitHub's atomic create-ref; it is not an atomic claim itself. Concurrent create-ref, HTTP 422 or uncertain response => halt and independently re-read; never check-then-upsert, retry a possibly executed write, force-update, delete the existing ref, or reuse an old draft. Verify GitHub target main SHA before creating the restricted ref.

**Separate write-authorization prerequisite (not yet fulfilled):** an approved, repo-scoped provider credential for target `signal-notes` with `contents:write` and `pull_requests:write` (for example an explicitly approved short-lived GitHub App installation token). The source Queqiao `GITHUB_TOKEN` is repository-scoped and MUST NOT be represented as signal-notes write authorization. No independent PAT, credential export, model-supplied permission flag or Browser Session replay. Enable the write capability only behind a new explicit main-only opt-in and independent owner approval for the exact target action. Do not modify `signal-notes` while this approval and supported CI credential path are absent.

Next bounded implementation slice after that approval: TDD fail-closed allowlisted writer, one atomic create-ref at pinned target main, create the **single exact synthetic file** on that ref, read-after-write and compare blob/article SHA, create one Draft PR to `main`, and independently check GitHub API commit/tree/path/PR metadata. The existing target `.github/workflows/content-validation.yml` triggers on PRs into `main`; verify its required checks for the **exact resulting commit SHA** in a distinct independent job. Persist original sanitized provider-side write event with same Controller/Worker/Lease/task/principal plus an independently downloadable archive; no article, token, user identity or session in artifact. A failure leaves an auditable quarantined test branch, not a success claim. Run reruns and concurrent duplicate tests, rejected/uncertain response tests, no-main-write checks and #170 Windows Adversarial unchanged. A real reviewed-main Hosted run and separate no-secret remote recheck are required to mark **G3.4 PASS**. G3.5 and physical PC-off remain separate. No production publishing or 05:00 schedule switch.

### G3.4 approved isolated target integration witness (2026-10-15; operator-assisted, NOT Hosted G3.4 PASS)

The owner approved precisely one synthetic file, `signal-notes` test branch `gate3/synthetic-2026-10-15` and a Draft PR, **without** main merge or production schedule change. At execution time the target `main` was `74ecd4261e729e3edb0077f5aae5dfa961f05f42`. Original GitHub branch and all-state PR inventories showed the proposed branch/PR absent. An existing authorized operator connection, **not the Hosted Controller's cross-repository credential**, made one atomic GitHub create-ref from that base. No new independent PAT or target CI secret was created.

The committed file is only `src/content/posts/gate3-synthetic-2026-10-15/index.md` (`draft: true`), constructed as a bounded synthetic TDD **operator fixture**, not falsely attributed to a Hosted Worker conversation. Original GitHub read-after-write confirmed one `added` file, commit `a18c244c5b071b833757c5bb4c0e5859a38f8bf6`, parent exactly `74ecd4261e729e3edb0077f5aae5dfa961f05f42`, Git blob `fb27faf3ce4c0c48283f50016306fb7ec52ac9b1`, exact article SHA-256 `fc47987126c1261c5afee525a0687563f674c203cd1a95d7433d19d8bd1f5674`. [Target Draft PR #3](https://github.com/tibame201020/signal-notes/pull/3) is `OPEN`, `draft=true`, base `main`, exact head `gate3/synthetic-2026-10-15` and **one changed file**. Target [content-validation Run 38668658061](https://github.com/tibame201020/signal-notes/actions/runs/38668658061) completed SUCCESS for that exact commit SHA. Target `main` remained at the parent SHA at post-check. No PR merge, source/target production schedule change, or additional target file.

Added pure `assessRestrictedDraftReadback` contract + TDD regression tests: reject parent/commit/path/article hash/branch/PR/CI mismatches and forged success fields. Its verdict is deliberately `operator_assisted_target_consistent`, **not an authenticated source of evidence by itself**, and explicitly sets `hostedWriteObserved=false`, `fullGatePassed=false`. Real facts above were separately read from the authenticated target GitHub provider. Re-running the existing date must fail preflight because the branch and PR now exist; never retry a possibly executed create or force-reuse the branch.

**Remaining for actual G3.4 PASS:** a separately approved, CI-usable and target-restricted GitHub App installation write path (or another explicitly supported and approved equivalent), built as a new opt-in one-shot Queqiao MCP operation on a future authorized fresh date. The Queqiao-source `GITHUB_TOKEN` cannot write `signal-notes`; no target-scoped CI credential exists at this check. TDD must bind the fresh live Controller/Worker/Lease, validated original synthetic artifact, original G3.3 Gateway events, atomic ref claim, write action and Gateway original audit, commit/PR and exact-head target CI, and a later no-secret independent witness. Do not count operator-assisted PR #3 as same-task Hosted publication or G3.5 PC-off acceptance. Keep Issue #124 OPEN and #170 independently tracked.

CI stability note for the G3.4 target-readback PR: on its first head, Security Baseline Windows Adversarial Run 38669002849 failed on two attempts in the pre-existing `apps/worker/src/git-extension.test.ts` negative worktree/junction test: Vitest's 5-second default expired under concurrent Windows native Git setup, with subsequent Windows `EBUSY` temporary directory cleanup. This was unrelated to the isolated G3.4 verifier; the original six `400` rejection checks remain in place. The test's **own** timeout is bounded at 20 seconds and temporary directory cleanup now uses Node `fs.rm` bounded Windows-compatible `maxRetries=5,retryDelay=200` (errors still propagate). Neither job selection nor Windows Adversarial CI is skipped/relaxed. New unchanged-source CI evidence must pass before merge; this is not historical Run 38669002849 being retroactively marked PASS. #170 remains independently tracked.

### G3.4 Hosted provider writer implementation slice (NO Hosted execution or target authorization yet)

`apps/gateway/src/poc-gate3-draft-provider.ts` implements a REST-backed, testable, **not exposed in the MCP server and not called by the current Hosted workflow** one-shot target-submission adapter. TDD first failed because the module was absent; then tests verified ordered `GET /installation/repositories` (exactly one target `tibame201020/signal-notes`, reject a source-only GitHub token or broad multi-repository installation token), pinned `main` SHA, complete absent ref and all-state PR inventory, **one atomic GitHub `POST /git/refs`**, single `PUT` new contents with no overwrite `sha`, same-branch exact bytes/parent/sole-file readback, and single `POST /pulls` with `draft=true`, `base=main`, `maintainer_can_modify=false` followed by original target readback. A successful result is `submitted_pending_target_ci`, `hostedGatePassed=false` and contains no credential or article content. HTTP disagreement, invalid JSON, 422, transport uncertainty and ambiguous existing target all fail without retry/delete/reset/upsert. There is no method to merge or enable production scheduling. No direct user URL, GitHub PAT, browser session or alternate target.

**Not authorization or acceptance:** the provider module is intentionally not registered as an MCP tool. Future server-side composer must first independently authenticate the live same-task Worker/Lease and same OAuth principal, verify both already persisted original G3.3 Gateway audits and the exact fresh Worker artifact before invoking it; append a durable Gateway write-intent before the first provider mutation, record a sanitized completed/failed provider event, and only then hand off read-only target CI checking to a separate post-Run witness. Never call this adapter directly using model-supplied fields. The current Queqiao Actions secrets do not include target GitHub App credentials; never use `github.token` from the Queqiao source as cross-repository authority. For Hosted enablement, configure a repo-scoped GitHub App installation selected **only** for `tibame201020/signal-notes` with Contents write and Pull requests write; mint a short-lived installation token only inside an explicitly owner-approved main-only G3.4 Controller run and keep App ID/private key entirely in Actions private configuration, never repository/artifact/log. Add a fresh, independently approved date; `2026-10-15` is already claimed by Draft PR #3 and may NOT be reused. PR/tests for this slice must not dispatch a target write or claim G3.4 PASS. G3.3 remains PASS in its approved scope; #124 and #170 stay open.

The same slice adds `poc-gate3-draft-service.ts` as an **unregistered** server-side one-shot coordinator gate, with TDD against two original Gateway event queries (the same principal and task), live pinned Controller/Worker/Lease, fresh trusted routed Worker reread, exact original read receipt SHA and strict `prepareGate3DraftPlan`. It appends a sanitized original Gateway `gate3.draft_intent` before any target side effect, calls the restricted provider at most once, and on a confirmed returned Draft PR appends `gate3.draft_submission` with `stage=submitted_pending_target_ci`. An uncertain provider result writes only a sanitized failure class and never exposes token, content, personal identity or raw remote error. Audit-intent failure stops before provider action. The new module is intentionally **not registered** in `mcp.ts` or automatically started by any workflow: installing and restricting an official Hosted write credential, main-only opt-in, independent archived Gateway write audit and exact target CI witness remain prerequisites. This is code-ready staging with mocked REST, not a performed Hosted publication and not G3.4 PASS.

### ADR-0017 supersession ledger (2026-10-15)

G3.4 primary mode is now **ChatGPT-delegated publication via the existing connected GitHub App**; the original Gateway is the Worker/read-audit provider, not the GitHub write provider. The previous required extra App ID/private key/target-only Hosted installation token and Gateway write event are **superseded as mandatory acceptance gates**, without erasing their historical proposal or PR #181 optional, default-disabled implementation. No new secret/installation or signal-notes mutation occurs in this contract revision. The independent immutable evidence correlation helper reports only `hash_and_task_consistent`, `nativeAppExecution=not_established_by_hash_correlation`, `gatewayWriteObserved=false`, `gatePassed=false`. A real supported connected-App action and fresh same-task Hosted Worker proof must still be jointly accepted; old operator-assisted Draft PR #3 cannot be promoted. G3.5 is cloud/PC independence of that delegated workflow, not a promise of an unattended publishing scheduler. See [ADR-0017](adr/0017-gate3-chatgpt-delegated-publication.md).

### G3.4 + G3.5 single-run delegated handoff (implementation slice; not an acceptance claim)

To avoid stitching an unrelated synthetic target PR to an older Hosted task, PR #183 introduces an opt-in **main-only** `gate3_delegated_handoff` input. It requires both `gate3_worker=true` and `gate3_mcp_audit=true`; default is false. The CI-run ChatGPT Browser Harness writes a strictly validated three-field synthetic TDD response on a real ephemeral Actions Worker. The Controller retrieves the original public `gate3-artifact.json` from that same routed Worker, verifies `gate3.trace.v1` / the original Worker result hash and writes its exact bytes to a private runner temp file, **not** any cookies, profile, full conversation, session token or connector credential. Existing same-run G3.3 original Gateway read/HEAD audit is verified, then Controller waits for Worker cancellation and `leaseState=disposed`, producing `gate3-controller-complete.json`.

Only *after* those proofs is a bounded `queqiao.gate3.delegated-handoff.v1` produced and uploaded (`gate3-delegated-handoff-<controller-run>-<attempt>`, 7-day retention). It embeds the validated public synthetic article, immutable source receipt/trace and exact SHA-256 digests linking original Worker audit + GitHub HEAD audit + disposal proof. No target GitHub API write, target App impersonation, provider-token export, new PAT or production 05:00 schedule is executed by CI. The result remains `publication=not_observed`, `fullGatePassed=false`. A separate `gate3-audit-recheck` job downloads the handoff and **three original immutable archives**, runs original Gateway event verification and strict independent handoff verification against the real run ID, attempt and source SHA, and refuses missing/mutated/unrelated content or non-disposed lease. The public article can then be passed by ChatGPT directly to its *already connected* GitHub App, only upon separately approved fresh-date/target write scope. An independently observed connected-App operation and exact-head target CI must be correlated with the handoff; successful handoff alone is not G3.4/G3.5 PASS. A cloud-hosted GitHub runner proves no *runtime dependency* on the personal computer, but a physically turned-off PC is not asserted without independent observation. Existing Draft PR #3/date `2026-10-15` remains occupied; do not reuse it. ADR-0017 remains the acceptance authority; the unregistered optional Autonomous writer PR #181 stays disabled. #124 and #170 remain OPEN.
