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
