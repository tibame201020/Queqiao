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

Run **Browser Harness Session Portability POC** on the `test/101-browser-session-portability` branch via GitHub Actions. Check the `session-portability` job for validated-secret, manual Chrome, and restore steps.

## Security

The capsule is a bearer-equivalent **authenticated browser session**, not a harmless configuration blob. Repository admins with access to Actions workflows may be able to execute code that uses it. Therefore the acceptance branch and workflow must be reviewed and tightly scoped before execution. Restrict the secret to trusted execution environments where possible.

Treat exported cookies and storage as credentials. The workflow must never print, upload, or store the decoded values. It must not enable unrestricted external navigation or capture HAR traces, screenshots, or browser state containing sensitive user information. Destroy temporary Chrome state after the job.

For a production design, prefer a dedicated account/session boundary with least privilege, explicit rotation, expiry, and revocation. Do not treat this proof of portability as production authorization.

## Evidence

Record only run ID, commit SHA, job status, and a sanitized authentication verdict. A missing-secret error means the browser login test was **not executed**; it is not evidence that session restoration failed. A browser challenge or expired session may also cause a false negative and must be classified separately.

After testing, revoke the test ChatGPT session and delete the repository secret. Do not merge this experimental workflow into a default branch as a general-purpose auth mechanism without a security review.
