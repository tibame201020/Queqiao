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

The attended, already authenticated Chrome 155 Jeff profile supplied
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
