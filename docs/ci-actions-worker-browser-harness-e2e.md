# Issue 124: GitHub Actions Gateway / Worker / Browser Harness

The isolated workflow runtime-provider-browser-controller.yml reuses
Phase 3 Gateway -> OIDC-attested Actions Worker reverse-WebSocket registration.
On the test branch feat/124-actions-worker-browser only, the Worker adds
one fixed Node command to its existing exact-argv allowlist. The command
invokes public-browser-acceptance.js on Worker-hosted headless Chrome.
The controller calls authenticated MCP run via Gateway, then read_file
on the SAME Worker. The receipt must match actual child GitHub Actions
Run ID, environmentId, public page navigation and DOM interaction.
The controller completes the lease and confirms child run disposal.

This is an isolated synthetic CI-only browser test; no ChatGPT login,
session Secret, persistent profile, user computer, or signal-notes
publication is required or modified.

Unproven: actual GitHub-hosted E2E until CI Run passed; ChatGPT session
portability remains separately blocked by browser challenge. Do not
activate the production 05:00 schedule or claim content generation works.

Worker subprocess environment variables are intentionally sanitized. The POC
Workflow writes only the numeric child GITHUB_RUN_ID to an untracked
ci-browser-metadata.json file; the fixed browser program validates it with
a strict schema and writes ci-browser-receipt.json in the Worker checkout.
Neither file contains tokens, cookies, browser profiles or user data.

## Actual isolated GitHub Actions acceptance — 2026-10-10

Controller GitHub Actions Run 38048667385: SUCCESS.
OIDC child Worker Run 38048686376: completed/cancelled on normal cleanup.
Runtime Lease 2639dabf-47b6-4056-955a-20b7516d961f: disposed.
MCP run and read_file both routed to environment
gha_2639dabf47b64056955a20b7. Verified receipt shows
runId 38048686376, example.com, one DOM click, synthetic echoed input
and QUEQIAO_CI_BROWSER_HARNESS_OK. The controller did not read
any ChatGPT credentials or rely on the local PC.

This is a *branch-scoped test*, not an unrestricted manually dispatchable
production job. Run it from feat/124-actions-worker-browser while that
test branch exists; the main branch remains excluded from the browser
execution allowlist. Real ChatGPT authentication is still BLOCKED by
session portability/browser challenge and is a separate acceptance gate.
