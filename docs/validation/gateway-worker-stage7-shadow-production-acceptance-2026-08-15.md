# Gateway / Worker Refactor Stage 7 — Shadow Production Acceptance

Date: 2026-08-15

## Result

**PASS — Shadow production acceptance completed.**

**Stable promotion status: NOT YET PROMOTED.** Promotion remains a separate owner-approved action after this acceptance evidence is reviewed and merged.

## Candidate

- Base `main` merge before Stage 7 acceptance: `8e5d7a0cbe6a3ef4dc754c38be7702c46d699f95`
- Stage 7 release-gate commit: `62b883d96e8ec9f91543437d043ef66c1d6f4a48`
- Branch: `release/gateway-worker-stage7-acceptance`
- Runtime product code changes in Stage 7: **none**
- Stage 7 tracked changes are release-gate coverage only:
  - atomic enrollment fault injection for membership persistence failure after daily credential persistence;
  - environment-ID parameters for the reusable MCP Inspector validator, preserving the existing defaults.

## Repository release gates

Final local validation after the Stage 7 test addition:

- TypeScript typecheck: **PASS**
- Full suite: **158 / 158 PASS**
- Security gate: **139 / 139 PASS**
- Runtime dependency audit: **0 vulnerabilities**
- Cluster gate: **28 / 28 PASS**
- Package build: **PASS**
- `git diff --check`: **PASS**

The Security and Resource Safety contracts were not relaxed for Stage 7.

## Worker Protocol and enrollment fault matrix

Worker Protocol 3.0 and enrollment coverage was re-run rather than inherited from an earlier release:

- Protocol 3.0 requires stable `workerId`.
- Legacy Protocol 2.0 remains parser-only rolling-upgrade compatibility.
- Membership-backed routing rejects Protocol 2.0 and stable-identity mismatch.
- Legacy mandatory-capability validation remains scoped to Protocol 2.0.
- Protocol 3.0 accepts an empty optional-capability set.
- Join tokens remain one-time, expiry-bounded and optionally identity-bound.
- Join rejects unreachable endpoints, wrong Worker identity and invalid provisional confirmation credentials.
- A failed confirmation cannot reuse the transaction.
- Gateway restart invalidates uncommitted join tokens.
- Transport update requires the existing daily credential and the same stable Worker identity.
- CLI credential replacement rollback remains covered.
- **Stage 7 added direct fault injection at the membership-persistence boundary:** after the provisional daily credential is persisted and the Worker authenticates successfully, an injected membership-store commit failure must delete the persisted daily credential, leave membership empty and make the transaction non-reusable.

Targeted protocol/enrollment matrix: **24 / 24 PASS** before the final full/security runs.

## Fresh Shadow enrollment acceptance

A new external Shadow runtime was created instead of reusing prior Shadow membership or credentials. Runtime configuration, state and secrets remained outside the repository.

The candidate topology was created through the supported management lifecycle:

1. fresh Gateway setup;
2. fresh Windows Worker setup;
3. fresh WSL/Linux Worker setup;
4. Gateway-created one-time token for the Windows Worker;
5. real `worker join` and membership commit;
6. a separate one-time token for the WSL/Linux Worker;
7. real WSL/Linux `worker join` through the public Shadow ingress and membership commit.

No membership JSON was hand-edited.

Observed result:

- Windows Worker environment: `stage7-windows`
- WSL/Linux Worker environment: `stage7-wsl`
- Gateway liveness: both environments reachable
- Gateway restart: both memberships and daily credentials reloaded successfully
- Worker restart: candidate Workers returned with the same stable identities
- Stable deployment remained healthy throughout the Shadow acceptance.

The WSL/Linux Worker continued to use the existing loopback-only HTTP transport baseline; no transport-security restriction was weakened to complete the test.

## First-party Git extension composition

Fresh setup intentionally exposes Core tools only. The first-party Git extension is not an implicit setup default.

For the production-like Shadow deployment, `@queqiao/extension-git` (`dev.queqiao.git`) was explicitly configured in external runtime configuration as trusted and enabled, consistent with the frozen extension contract. The disposable validation workspaces were explicitly granted the coding profile and `git` command authority.

No change was made to Core/extension ownership and Git was not hard-coded into setup.

## Public MCP production acceptance

The candidate was exercised through the real HTTPS Shadow ingress with OAuth and MCP Inspector-compatible flow.

Observed public contract:

- public tools: **17 exactly**
- first-party Git tools: **7 exactly**
- Core Manifest Revision: **6**
- Worker Protocol: **3.0**
- deployment fingerprint: **exact match**
  - `sha256:68eac0d73d8efea95cfde694b33d44220049fb6180b60657b3d8b6ee0a9d59ad`
- supported MCP revisions, exact set:
  - `2025-03-26`
  - `2025-06-18`
  - `2025-11-25`
  - `2026-07-28`

Real public MCP calls also verified native routing on both environments:

- Windows `workspace_info` + `git_status`: **PASS**
- WSL/Linux `workspace_info` + `git_status`: **PASS**

The final pre-evidence rerun again returned 17 tools, 7 Git tools and the exact frozen fingerprint.

## OAuth/session persistence across Gateway restart

A real authorized public MCP client was established before the restart. Sensitive token material was held only in temporary external runtime state and removed after the test.

The following sequence passed:

1. public OAuth registration + PKCE authorization;
2. access and refresh tokens issued;
3. official MCP SDK session listed the 17-tool surface and both Stage 7 workspaces;
4. Shadow Gateway process restarted while Workers remained running;
5. the **pre-restart access token** remained accepted for MCP calls;
6. the **pre-restart refresh token** rotated successfully after restart;
7. the newly issued access token successfully called MCP again.

Result:

- authorized client registry persistence: **PASS**
- access-token continuity across Gateway restart: **PASS**
- refresh-token rotation across Gateway restart: **PASS**
- no forced reauthorization during this persistence gate.

## Resource Safety

### Local Windows candidate

Packaged Resource Safety baseline and soak were re-run on the Stage 7 candidate.

- baseline: **PASS**
- soak: **PASS**
- unpacked package footprint: approximately **5.59 MiB**
- Gateway idle writes: **0**
- Worker idle writes: **0**
- Gateway idle log growth: **0**
- Worker idle log growth: **0**
- second-phase Worker resident growth during soak: approximately **0.41 MiB**
- failures: **none**

### Hosted Windows and Ubuntu

GitHub Actions workflow dispatch:

- workflow: `Resource Safety Baseline`
- run: `31861475165`
- candidate head: `62b883d96e8ec9f91543437d043ef66c1d6f4a48`

Results:

- Windows baseline: **PASS**
- Ubuntu baseline: **PASS**
- Windows soak: **PASS**
- Ubuntu soak: **PASS**

The only workflow annotation was GitHub Actions' Node runtime deprecation notice for pinned upstream actions; it did not fail a Queqiao resource gate.

## Final health snapshot

Immediately before recording this evidence:

- Shadow local health: **200**
- Shadow public health: **200**
- Stable local health: **200**
- Stable public health: **200**
- Stage 7 WSL/Linux Worker runtime: **active**
- Shadow environments: `stage7-windows`, `stage7-wsl`

## Promotion boundary

Stage 7 Shadow acceptance is complete, but this document does **not** promote Stable.

Stable promotion requires a separate explicit owner approval. Promotion must preserve the existing Stable external configuration/state and rollback point, deploy the accepted package/code identity, then re-run Stable public MCP, Windows/WSL routing, OAuth/session and health verification before the release is considered promoted.
