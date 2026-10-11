# Browser Harness session portability acceptance (POC)

Status: experimental. This does **not** mean a ChatGPT-driven Queqiao task has succeeded.

## Target

Prove that a fresh GitHub-hosted Ubuntu runner can use Queqiao Browser Harness' manual Chrome + CDP model to open an already authenticated ChatGPT session. This is Gate 1 of the Browser Harness runtime migration.

1. Start Ubuntu/Xvfb and a fresh Chrome profile, outside the Playwright launcher.
2. Attach Playwright over loopback CDP.
3. Restore only ChatGPT/OpenAI cookies and ChatGPT localStorage from the repository secret `CHATGPT_BROWSER_SESSION_CAPSULE`.
4. Navigate to `https://chatgpt.com/`.
5. Accept only if the ChatGPT composer exists and login/sign-up and browser challenge checks are negative.

Gate 2 will trigger a harmless test prompt and verify the response. Gate 3 will invoke Queqiao tools through the already configured ChatGPT connector. Neither is covered by Gate 1.

## Setup and execution

Repository maintainers must create the Actions **repository secret** named `CHATGPT_BROWSER_SESSION_CAPSULE` before queuing a **new** acceptance workflow run. The value is a gzip/base64 Playwright-compatible cookies/localStorage capsule. Never paste it in issues, PRs, commits, workflow logs, artifacts, or chats. Existing workflow runs may have been queued before a secret was added; create a new run rather than relying on rerun behavior.

The `pull_request` event executes **unit-tests only**. It never injects the session Secret into unmerged PR code. After review and merge, manually dispatch **Browser Harness Session Portability POC** against the protected `main` branch. Check the `session-portability` job for validated-secret, manual Chrome, and restore steps.

## Security

Never expose this Secret to a `pull_request` workflow. The capsule is a bearer-equivalent **authenticated browser session**, not a harmless configuration blob. Repository admins with access to Actions workflows may be able to execute code that uses it. Therefore the acceptance branch and workflow must be reviewed and tightly scoped before execution. Restrict the secret to trusted execution environments where possible.

Treat exported cookies and storage as credentials. The workflow must never print, upload, or store the decoded values. It must not enable unrestricted external navigation or capture HAR traces, screenshots, or browser state containing sensitive user information. Destroy temporary Chrome state after the job.

For a production design, prefer a dedicated account/session boundary with least privilege, explicit rotation, expiry, and revocation. Do not treat this proof of portability as production authorization.

## Evidence

Record only run ID, commit SHA, job status, and a sanitized authentication verdict. A missing-secret error means the browser login test was **not executed**; it is not evidence that session restoration failed. A browser challenge or expired session may also cause a false negative and must be classified separately.

After testing, revoke the test ChatGPT session and delete the repository secret. Do not merge this experimental workflow into a default branch as a general-purpose auth mechanism without a security review.
## Session restore diagnostics (Issue #101, October 2026)

The acceptance script compares the decoded capsule against Chrome's
actual cookies before and after ChatGPT navigation. Cookies with a
positive expiry at or before the test clock are excluded from eligible;
session cookies with expires=-1 or 0 remain eligible. Comparisons use
cookie identity and value only in memory. Logs contain source, eligible,
expired, matched, missing, changed counts, NEVER names or values.

The ChatGPT localStorage report contains aggregate expected, observed,
matched counts, status and storageStateReadable. A missing observable
origin means not_observed, not restored. Neither Playwright storageState
nor the decoded capsule is logged, persisted, captured or uploaded.

Interpretation:
- If pre-navigation matched is less than eligible, Chrome restoration
  is incomplete regardless of ChatGPT server response.
- If cookies are initially present and subsequently absent, their
  state changed during navigation.
- If cookies remain matched yet verdict is browser_challenge,
  client-side restoration occurred but server acceptance is unproven.
  Do not bypass challenges or call them successful login.
- Authenticated still requires a real ChatGPT composer and no login
  links or challenge. This gate does not submit prompts.

Only manual dispatch on reviewed main may access the existing Secret.
PR checks run only unit tests without it. Queue a NEW main workflow
run following merge, as reruns may retain captured Secret revisions.
This change creates no credentials or user browser profiles in repo.

## Unauthenticated control comparison (Issue #101)

The existing approved, main-only workflow uses one GitHub-hosted Chrome
process and one Actions Runner. Before injecting the current session
capsule into the original Chrome context, it creates a new isolated
incognito BrowserContext with explicitly empty Playwright storage state.
The control context visits the ChatGPT home page without cookies or
localStorage, performs NO login and NO challenge interaction, and then
is closed. Only a sanitized verdict and isolation boolean are kept.

The original context then restores the same existing capsule as before.
The acceptance output adds control verdict and a comparison of both
outcomes. Both-contexts-challenged means the challenge affects both
fresh and restored contexts in this CI run; it does NOT prove a precise
root cause. Restored-only-challenged is a difference worth investigating,
not proof that the capsule is invalid. A navigation error or pending
page remains inconclusive. Successful login still requires a real
authenticated composer in the restored context.

The test is not a challenge bypass, browser fingerprint alteration,
network/IP rotation, password login, external browser host, profile
persistence, or alternative API. No page content, screenshots, cookies,
localStorage keys/values, or browser state are logged/uploaded.
The Session Secret stays in the existing manually dispatched main job,
never in PR tests.
## Guest Composer and authentication evidence (Issue #101)

CI Run 38136907842 found that an explicitly empty incognito
BrowserContext displayed a Composer. The former heuristic incorrectly
called this authenticated, which is a false positive. The acceptance
contract now returns guest_composer whenever a Composer is visible
without separate verified session evidence. The hybrid readiness check
must reject guest_composer.

For a restored context that has a Composer and is not on a login or
challenge page, the script makes a single same-origin, read-only check
of the ChatGPT website's session status. This is an INTERNAL, UNSTABLE
website route, not a supported developer API or a new content backend.
The browser discards the returned response locally and forwards ONLY
a confirmed/not_confirmed/unavailable boolean verdict. No account
identifier, token or response JSON is logged, committed or uploaded.

A successful acceptance requires an authenticated session indication
and a usable Composer at the same time. If the website session check
is unavailable, the gate fails closed rather than reporting login.
Neither session check nor any other POC code interacts with or bypasses
browser security challenges. Continue using the existing repository
Secret in the manually dispatched reviewed main workflow; no new
credentials and no local host runtime are involved.
## Read-only HTTP and expiry diagnostics (Issue #101 P1)

The main-only Session Portability gate now compares BOTH the no-session
incognito control and the restored Context in the SAME CI Chrome/Runner.
The extra HTTP diagnostics observe existing network responses without
intercepting, blocking, retrying, altering or bypassing authentication
or browser challenges. Only response status categories from the exact
chatgpt.com and auth.openai.com hosts are counted; status 401/403/429,
other 4xx, 5xx, 2xx, 3xx and other are reported as aggregate totals.
Final main-document HTTP status, a bounded redirect count and a
destination class (chatgpt/auth/other/unknown) are recorded without
any URL path, query, request headers, response body, cookie identity,
username, account identifier, token or browser storage.

The decoded capsule's Cookie expiries are counted as session, expired,
remaining up to 24h, within 7 days and beyond 7 days. Individual expiry
timestamps and Cookie identifiers are not printed. These buckets do
not prove which Cookie is required for authorization. A redirect or
HTTP 403/429 does not by itself establish why the website decided to
show a browser challenge.

The script does not upload HAR files, screenshots, traces, raw page
responses or browser profiles. If navigation fails, the diagnostic
records navigation_error without printing the raw Playwright exception,
which might include a private URL. The existing Secret remains
accessible only to a new, manually dispatched and reviewed main run;
PR checks receive no Session Secret.