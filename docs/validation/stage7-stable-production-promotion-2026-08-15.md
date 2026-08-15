# Gateway / Worker Stage 7 — Stable Production Promotion

- Date: 2026-08-15
- Result: **PASS**
- Promotion target: Stable production deployment
- Source merge: `78e6a9533da9ca749c9a4172ec170a5f34e97fc3` (`Complete Gateway Worker Shadow production acceptance (#21)`)
- Promotion status: **PROMOTED**

## Promotion boundary

This record is append-only production acceptance evidence following the separately reviewed and merged Shadow acceptance. It does not rewrite prior validation history.

Stable external runtime configuration, secrets and Gateway state remained outside the repository. A rollback snapshot was created before any Stable process was stopped. The rollback path retained the previous Windows Gateway/Worker/CLI bundles, Windows production configs, WSL production config and Worker bundle, and a copy of the pre-promotion Gateway state.

No secret, token, OAuth authorization code, public hostname or machine-specific runtime path is committed in this document.

## Accepted code identity

`main` was fast-forwarded to the merged Stage 7 acceptance commit before promotion. Production bundles rebuilt from `main` were compared byte-for-byte by SHA-256 with the already accepted Stage 7 Shadow candidate.

Exact matches:

- Gateway bundle: `3F61C4F0BF1CC2BF89FD10D977D24788F6F26AA93DC237FE60E24B32F83E033B`
- Worker bundle: `4A015A7EB31ADB527B5FCDCD5684D6FA926FBD46D8D8EB8298D2EF665F3426D6`
- CLI bundle: `9CFB786BB4BED6E069DF68F7FDAF18F4370433BF7ABF4565065FE5DA990DD198`

The Stable deployment therefore received the same executable bundle identity that passed the Shadow production acceptance.

## Pre-promotion migration dry-run

The previous Stable deployment still used the pre-Stage-6 static environment configuration. Promotion did not start by overwriting that runtime.

A parallel disposable migration cluster was built from copies of the real Stable external configuration and credentials, on isolated validation ports. Two stable Worker UUIDs were explicitly assigned and the legacy trusted environment endpoints were materialized into the Gateway-owned membership registry.

The new runtime parser accepted all staged production configs while preserving:

- first-party Git extension composition;
- five Windows production workspaces;
- four WSL/Linux production workspaces;
- existing Worker credential files;
- existing Gateway OAuth/JWT secret references and state directory.

Parallel validation then proved:

- Windows Worker authenticated hello: HTTP 200, Worker Protocol 3.0, exact workerId match;
- WSL/Linux Worker authenticated hello: HTTP 200, Worker Protocol 3.0, exact workerId match;
- Gateway membership health: HTTP 200;
- both environments reachable simultaneously.

Stable remained healthy during this dry-run.

## Promotion transaction and rollback discipline

The production cutover was launched as a delayed external promotion transaction so the controlling Queqiao request could complete before the old Stable Gateway was stopped.

The transaction:

1. verified pre-promotion Stable local health;
2. stopped only the Stable Gateway, Stable Windows Worker and Stable WSL/Linux Worker;
3. atomically installed the new Gateway and Windows Worker configs;
4. installed the Gateway membership registry;
5. installed the accepted Gateway, Worker and CLI bundles;
6. atomically installed the WSL/Linux Worker config and accepted Worker bundle;
7. restarted Windows and WSL/Linux Workers;
8. restarted the Gateway;
9. required local Gateway health 200, loopback-only listeners and an active WSL/Linux production service before declaring success.

The promotion script contained an automatic rollback path that restored the previous configs and bundles, removed the new membership file and restarted the old services if any acceptance condition failed.

Observed result:

- promotion status: **SUCCESS**;
- automatic rollback triggered: **NO**;
- Gateway local health: **200**;
- WSL/Linux production Worker service: **active**;
- Gateway management listener: loopback-only;
- Gateway listener: loopback-only;
- Windows Worker listener: loopback-only.

The rollback snapshot remains available outside the repository after successful promotion.

## Stable configuration cutover

Post-promotion structural validation confirmed:

- Gateway config contains no legacy `environments` field;
- Windows Worker config contains no legacy `environments` field;
- Windows Worker has a stable workerId;
- Gateway membership registry contains exactly two Workers;
- Windows membership workerId matches the Windows Worker config;
- WSL/Linux membership is present;
- Gateway management listener uses the Stable loopback management port;
- first-party Git extension remains explicitly configured;
- Stable local health is HTTP 200;
- Stable public health is HTTP 200.

The Stable runtime therefore now uses the Gateway-owned persistent membership model rather than the legacy static endpoint routing source.

## Existing ChatGPT connector / OAuth continuity

The same pre-existing `Queqiao stable` ChatGPT connector was used to control the release before and after the Gateway restart. After promotion it immediately completed new authenticated typed tool invocations without re-binding the connector or refreshing its public tool schema.

Gateway OAuth state was also compared structurally against the pre-promotion rollback snapshot:

- pre-existing OAuth client records: **4**;
- current OAuth client records after the post-promotion Inspector run: **5**;
- all pre-existing client IDs still present: **YES**.

This confirms that the production Gateway state was preserved through promotion instead of being recreated.

## Post-promotion public MCP acceptance

The promoted Stable public HTTPS endpoint was exercised with `@modelcontextprotocol/inspector@2.2.0` using OAuth and Streamable HTTP.

Observed public contract:

- public tools: **17 exactly**;
- named Git tools: **7 exactly**;
- `workspace_info.workspaceId`: targetable;
- Core Manifest Revision: **6**;
- Worker Protocol: **3.0**;
- deployment fingerprint: `sha256:68eac0d73d8efea95cfde694b33d44220049fb6180b60657b3d8b6ee0a9d59ad` — **exact frozen match**;
- MCP revisions: exact bounded set
  - `2025-03-26`
  - `2025-06-18`
  - `2025-11-25`
  - `2026-07-28`.

Real native routing was exercised after promotion:

- Windows broad coding workspace routed to environment `windows` and completed real Git status against the Queqiao repository;
- WSL/Linux broad coding workspace routed to environment `wsl` and completed real Git status against a contained ComfyUI repository.

The existing ChatGPT connector also executed typed Git discovery/status operations successfully after promotion.

## Shadow cleanup

After Stable post-promotion acceptance completed:

- the Stage 7 Shadow Windows Gateway/Worker processes were stopped;
- the Stage 7 transient WSL/Linux Shadow Worker was stopped;
- Stable remained HTTP 200 after Shadow shutdown.

Shadow external runtime material may remain available for release forensics, but no Shadow process is required to keep Stable operational.

## Final release decision

**PASS — Stable promotion accepted.**

The Gateway / Worker refactor through Stage 7 is promoted to the Stable production deployment. The promoted runtime preserves Worker-authoritative policy, OAuth state, loopback-only Worker transport, explicit first-party extension composition, the frozen 17-tool public MCP contract and the accepted Resource Safety / Security baselines.
