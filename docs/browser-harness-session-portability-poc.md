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