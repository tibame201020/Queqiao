# CI-only Browser Harness Gate — Issue #124

## Scope

The isolated workflow .github/workflows/browser-harness-ci-runtime.yml
runs on GitHub-hosted Ubuntu, installs the project dependencies,
launches a fresh temporary Chrome profile and connects to Chromium CDP
using the existing playwright-core dependency.

It does not require or read a ChatGPT account, browser profile, session
capsule or local Queqiao Worker/Gateway. The test navigates to public
https://example.com, checks the page title and origin, fills a synthetic
input, clicks a button, and checks the actual DOM update. A generated
JSON receipt records the real GitHub Actions run ID. CI validates the
receipt and uploads a short-retention artifact.

## Acceptance criteria

- public-browser-verdict.test.ts must PASS, including fail-closed
  receipt validation and rejection of extra keys.
- The workflow must show QUEQIAO_CI_BROWSER_HARNESS_OK after actual CDP
  browser interaction, rather than echoing a marker directly.
- ci-browser-harness-receipt.json must include the real GitHub Run ID,
  expected example.com navigation and exactly one DOM interaction.
- The job must pass without the local computer and without ChatGPT
  secrets. The temporary CI Chrome profile is deleted at exit.
- No website challenges or login flows are bypassed or simulated.

## Boundaries

This gate proves the CI Chromium + Playwright Harness infrastructure.
It is not the authenticated ChatGPT session portability gate, and not a
Gateway -> Worker -> Harness production transaction. Both require their
own end-to-end proof, including a real authenticated composer and
collected answer. Earlier CI Chrome accepted the session capsule but
reported CHATGPT_BROWSER_CHALLENGE. The existing secret and session
portability workflow remain unchanged.

No daily signal-notes workflow, branch or Pages deployment is modified.
