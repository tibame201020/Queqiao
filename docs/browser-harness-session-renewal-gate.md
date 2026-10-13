# Session renewal gate — Issue #101 P3

## Evidence and decision

GitHub-hosted Chrome in Run 38144351108 opened the unauthenticated ChatGPT
guest page with HTTP 200. In that same Runner, BOTH fresh and default
Contexts restored from the existing CHATGPT_BROWSER_SESSION_CAPSULE received
HTTP 403 and browser_challenge, with 23/23 eligible Cookies and 34/34
LocalStorage entries matched. This does not establish which service-side
rule caused rejection. Replaying the same capsule is not useful evidence.

The current capsule validator and renewal preflight are pure and operate
only on synthetic fixture data in GitHub PR tests. They can reject
incomplete/expired-only state, non-allowlisted origins, and a compressed
value too large for the existing CI workflow before any Secret change.
No private Session is supplied to these tests or committed to the repo.

## Legitimate renewal boundary

The account holder must use ChatGPT's normal first-party interactive sign-in
flow, with their existing sign-in provider and any required verification.
This is attended credential issuance, not a dependency of the production
Actions Runtime. Credentials, browser profiles and capsule values must NOT
be provided to a chat, PR, workflow log, repository file or artifact.

The automated browser capture-and-Secret-update action is intentionally
NOT part of this PR. It was blocked by the execution environment's safety
check and must not be recreated using an alternative tool to bypass it.
The existing GH Secret remains unchanged. The account holder must use
their approved credential-management channel to provision a new, valid
capsule; the old October 8 capsule file must not simply be uploaded again.
A successful human login on one machine does not prove Session portability
to a fresh GitHub-hosted browser.

Once the account holder independently updates the existing repository
Secret, start a NEW reviewed-main workflow_dispatch of
browser-harness-session-portability.yml. Never run private Session checks
in a pull_request job. A new run is required so it captures the newly
provisioned Secret. Keep the result aggregate only.

## P3 acceptance (strict)

Pass only when the GitHub Actions fresh browser produces BOTH independent
service-side Session evidence and an actual signed-in Composer without a
login link or browser challenge. Successful Secret presence, successful
capsule decoding, Cookie/Storage matching and a guest Composer do NOT
count. If the fresh Session still encounters HTTP 403 or browser_challenge,
record the run and stop; do not bypass verification or rotate browser/network
identity. P4 prompt-and-answer testing stays disabled until P3 passes.

Nothing here switches to OpenAI API, enables signal-notes daily production
publishing, adds a local always-on Worker, or exposes user data.
## Two-part Session Capsule transport (Issue #101 P3 size regression)

The attended, already authenticated attended Chrome 155 profile supplied
aggregate diagnostics only: 52 eligible Cookies, 51 ChatGPT LocalStorage
entries and 60,044 ASCII bytes of gzip/base64 capsule. The export
correctly stopped BEFORE overwriting the old GitHub Secret.

Do not discard arbitrary Cookies or LocalStorage to make the payload
fit; they can be necessary for portability. The reviewed main-only CI
gate now accepts two repository secrets:

- CHATGPT_BROWSER_SESSION_CAPSULE_PART_1
- CHATGPT_BROWSER_SESSION_CAPSULE_PART_2

For a valid gzip/base64 capsule (decoder max 65,536 chars), split the
original bytes in half, first half rounding up. Each Secret is a literal
ASCII string: qc1:<sha256-of-complete-capsule>:1/2:<first-half>
or qc1:<same-sha256>:2/2:<second-half>. Each part MUST be fewer than
48,000 characters. CI confirms both part indices, identical SHA-256,
complete reconstructed SHA-256 and original gzip/schema validation
BEFORE connecting to Chrome. Never log or upload Secret contents.
One missing part, mixed generations, wrong index or tampering fails
closed; NEVER fall back to old single-Secret value for partial update.
Original CHATGPT_BROWSER_SESSION_CAPSULE is used ONLY when both new
secrets are absent. This preserves backwards compatibility.

Only a NEW reviewed main workflow_dispatch receives the bearer-equivalent
Secrets; pull_request runs synthetic unit tests only. The account holder
must update both parts via an approved, local, in-memory, attended
provisioning operation. No Cookie, storage, capsule, part or profile
belongs in repo, PR, chat, command line args, shell history, issues, logs
or artifacts. Do not store plaintext parts in temporary files.
Successful update is NOT login proof; a fresh GitHub-hosted Chrome must
produce a separately confirmed first-party web session AND Composer.

Live-profile Chrome CDP may return zero context.storageState().origins
despite the verified first-party ChatGPT page having LocalStorage. For
attended provisioning, obtain that allowlisted ChatGPT origin directly
in the already verified first-party page (without logging entries),
while preserving the allowlisted Chrome Cookies. CI restore is unchanged.

No local always-on production dependency, new developer API, challenge
bypass or automatic signal-notes publication is introduced.
## Gate 2 — one real synthetic ChatGPT UI task (Issue #124)

Gate 1 is proved by main-only Run 38343842113: first-party authenticated
session independently confirmed, HTTP 200, usable signed-in Composer,
and success in a fresh GitHub-hosted Ubuntu/Xvfb/manual Chrome/CDP.

On the same reviewed main workflow, workflow_dispatch input gate2=true
is opt-in. Pull requests receive no repository Secrets and run synthetic
tests only. The existing default manual dispatch remains Gate 1 only.

Gate 2 has EXACTLY ONE prompt submission in a fresh blank / conversation:
Calculate 17 + 28. Reply with only the decimal number. Do not repeat the question.

Acceptance is fail-closed: Gate 1 real session must be confirmed first;
usable Composer and blank start must exist; exactly one Enter submission
(no retry after an uncertain send); the user prompt must actually appear
in the thread; URL must become a new /c/ conversation; distinct visible
assistant text must be exactly 45, outside user message; Stop must be
absent, Composer usable, and the answer stable on two 1.5-second checks.
The generated answer is NOT part of the sent prompt. If any condition
fails or a timeout occurs, fail with only a sanitized stage code.

Successful CI logs and GITHUB_STEP_SUMMARY store the run ID, booleans
and SHA-256 of the synthetic answer only. No conversation URL, private
content, screenshot, Cookie, token, LocalStorage or full browser dump
may be emitted or persisted. The synthetic test conversation itself
is an intentionally user-approved visible ChatGPT account action.
No signal-notes article, real account data prompt, daily schedule,
branch publication or worker lease is started by this Gate 2 slice.

Verification: synthetic red/green test and entire browser-harness-runtime
Vitest suite, typecheck, build, then PR CI. Only AFTER merge, execute a
fresh main workflow_dispatch with gate2=true and inspect the actual run.
A marker or printed receipt without independent observed user/assistant
UI and finished generation does not count.

### Gate 2 durable receipt v1

Successful real first-party UI acceptance is already demonstrated by main Run
38345287596 (PR #136). A later receipt-only hardening change does not replace
that run with a synthetic unit test, and a PR never receives Session Secrets.

For each attempt the sanitized receipt includes a deterministic
`gate2-<GITHUB_RUN_ID>-<GITHUB_RUN_ATTEMPT>` task ID, run ID, status
(`completed` or `failed`), semantic stage, completed boolean, observed
submission/user turn/conversation/assistant/generation flags. Only a completed
and fully validated assistant response has the synthetic answer SHA-256.
Any failed stage emits only `GATE2_FAILED_AT_<STAGE>`; original browser
exceptions, browser URL, session data and raw answer never enter the receipt.
The receipt is printed in job logs and written to the GitHub Step Summary
when available. If the summary itself is unavailable, the sanitized failure
receipt still appears in the job log and the workflow fails. No retry is
performed after uncertain submission. Re-running a GitHub workflow is a
different attempt and produces a distinct task ID; this is not yet an
across-runs deduplication guarantee for scheduled content publication.

## Gate 3 — synthetic content artifact and draft-only publication (#124)

Gate 3 is opt-in with manual `workflow_dispatch gate3=true` on reviewed
Queqiao main. It reuses the independent Gate 1 authentication in the same new
ephemeral CI Chrome; Gate 2 and Gate 3 cannot be selected together. It submits
one synthetic test-driven-development prompt, observes the real user turn and
independent assistant turn, waits for stable completed generation, then validates
only a three-key Traditional Chinese JSON answer. No retry after uncertain send.
Any challenge, timeout, extra fields, link/email, Markdown/HTML, missing data,
unsupported characters or incomplete generation fails closed. No raw Playwright
exception, private transcript, session material or browser URL is persisted.

The public synthetic article is deliberately `draft: true` with a fixed
`gate3-synthetic-YYYY-MM-DD` slug, static frontmatter and bounded validated
content. CI uploads `gate3-artifact.json` (article, intended path, sanitized
receipt and SHA-256) for seven days only after validation succeeds. It is not
proof of a signal-notes commit or a Gateway/Worker lease.

### Gate 3 handoff: existing ChatGPT GitHub Connector (no additional PAT)

The Gate 3 hosted workflow intentionally **stops after generation and artifact
validation**. It does not receive an extra cross-repository Token, invoke
`git push`, use a `GH_TOKEN` or merge/modify signal-notes main. The previous
`gate3_publish` Actions job and `SIGNAL_NOTES_GATE3_TOKEN` dependency were
removed because an Actions Shell does not inherit ChatGPT's already granted
GitHub Connector authorization.

Evidence: reviewed-main Queqiao Run 38353538530 produced a real authenticated
completed content task `gate3-38353538530-1` and the seven-day synthetic
artifact. An independent SHA-256 check confirmed the draft contents. ChatGPT
then used its already connected GitHub Connector in the active authorized
conversation to create `signal-notes` test branch
`gate3/synthetic-2026-10-13`, commit
`e9498df322401da29e87444bd27e13d250e14294` and **Draft PR #2**.
The test post stays `draft: true`; signal-notes/main stayed unchanged.
This proves a manual ChatGPT Connector handoff without provisioning a new PAT.

It does **not** prove the GitHub-hosted CI Chrome has autonomous GitHub Connector
invocation: browser login alone is insufficient. An attempt to wire a replayed
CI browser Session directly to Connector write automation was blocked by the
execution environment's safety check. Do not route around that block by a
different tool, hidden Token or shell identity. A future approved control
plane must independently demonstrate tool invocation and a GitHub-observed
write before any unattended Connector publication is accepted. Until then,
Gate 3 content generation and **manual** Connector handoff are separate
milestones. Daily production scheduling and merged release remain disabled;
#124 remains open for the unattended integration milestone.

### Gate 3 preflight diagnostic failure

Run 38349664418 independently confirmed the first-party authenticated Session
and aggregate Composer presence, but no prompt was submitted because Gate 3
preflight failed closed. The preflight now classifies four independent bounded
booleans (confirmed Session, blank conversation, editor visible, editor enabled)
and includes them only on preflight failure as sanitized evidence. No URL,
DOM content, browser exception or user state is logged. This is diagnostic
hardening, not a selector change or automated send retry. A later reviewed-main
run must independently prove real completion before Gate 3 can pass.
