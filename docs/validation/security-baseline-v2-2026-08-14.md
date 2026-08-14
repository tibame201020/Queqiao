# Security Baseline v2 Audit Evidence — 2026-08-14

## Baseline

Audit base: `main@431f2b2f0bd848329f04f584788db4c3f74db588` after Resource Safety Baseline v1 was frozen.

Pre-change controls were re-run before source edits:

- Security Baseline v1: **93/93 PASS**.
- Production dependency audit: **0 vulnerabilities**.
- Resource Safety Baseline v1: **PASS** on the local Windows baseline.
- Repository: clean, no open issues or pull requests at audit start.

## Read-only system review

The review covered the public MCP/Gateway boundary, OAuth/session handling, Worker authentication and authority, Workspace/path/Git/process containment, shell/run semantics, config/secrets, extension composition, CI supply chain, logging, resource-safety interaction, and management-plane prerequisites.

### Existing controls confirmed

- Worker listener remains loopback-only.
- Worker endpoint credentials are required outside public health.
- OAuth redirect/resource/PKCE/JWT/refresh-token replay controls remain adversarially tested.
- Native process creation remains centralized in the bounded ProcessRunner for production runtime code.
- Extension modules are explicit trusted local modules; Workspace content is not scanned as executable extension code.
- Extension identity/version, declared contributions, replacement contracts and capability ceilings are validated before execution.
- Production dependency audit was clean and required CI uses `npm ci --ignore-scripts` with least-privilege workflow permissions.

## Confirmed finding: step-up policy fail-open

The canonical runtime config accepts Workspace `stepUp` rules, while the pre-v2 Worker maintained a separate schema that dropped `stepUp`. Worker invocation authority therefore never evaluated the rule.

A temp-only adversarial reproduction configured `write_file` with a local step-up requirement and called the Worker directly with a valid Worker credential but no approval grant. Before the fix:

```json
{"status":200,"written":true}
```

The write completed. This was classified **High** because an explicitly configured security policy was not enforced at the native authority boundary.

Security v2 remediation:

1. Worker now consumes the canonical Workspace schema instead of maintaining a divergent copy.
2. A matching `stepUp` rule fails closed at Worker authority with `step_up_required`.
3. No approval grant is fabricated; full approval runtime remains future work.
4. The security suite asserts the rejected write does not create the target file.

## Confirmed finding: Gateway listener drift

Before v2, runtime config contained `gateway.listen.host`, but the Gateway entrypoint hard-bound `0.0.0.0`. Production socket metadata confirmed the stable Gateway was listening on all IPv4 interfaces while the Worker was loopback-only.

This did not bypass OAuth/Host validation, but it exposed a plain-HTTP LAN socket outside the intended local reverse-proxy/Funnel boundary and made config semantics misleading.

Security v2 remediation:

- runtime config constrains Gateway host to `127.0.0.1`;
- CLI init/migration and config example emit loopback;
- Gateway loader carries the host;
- entrypoint uses a shared listener helper;
- tests reject `0.0.0.0` and assert the real Node listener reports `127.0.0.1`.

Stable/Shadow config migration and socket acceptance are release steps because current deployed config predates this constraint.

## Supply-chain hardening

Required workflow Actions were mutable major tags before v2. Security v2 pins reviewed commits:

- `actions/checkout`: `11d5960a326750d5838078e36cf38b85af677262` (`v4` at review time)
- `actions/setup-node`: `49933ea5288caeca8642d1e84afbd3f7d6820020` (`v4` at review time)
- `actions/upload-artifact`: `ea165f8d65b6e75b540449e92b4886f43607fa02` (`v4` at review time)

No workflow permission expansion is introduced.

## Deferred findings — not claimed fixed

### Windows fresh-install ACL inheritance

Current stable production ACL metadata is restricted to SYSTEM/current-user authority at the hardened roots. A fresh `config init` sandbox demonstrated that Windows file/directory creation still inherits parent ACLs rather than independently creating a protected ACL boundary. Under ordinary per-user LocalAppData the inherited principals were SYSTEM, Administrators and the current user; a deliberately permissive parent also propagated the extra principal.

This is recorded as a **pre-CLI setup blocker**, not as an active demonstrated remote compromise of the current stable installation. Explicit Windows ACL provisioning/doctor verification remains required before setup UX is accepted.

### Durable redacted audit trail

Current logging records bounded HTTP metadata and does not claim a durable auth/policy/config/tool security-event store. That audit trail is a Dashboard prerequisite. It is deliberately deferred because persistent audit writes must be designed together with retention/rotation and must re-pass Resource Safety Baseline v1.

### Worker credential rotation

Coordinated no-downtime Worker credential rotation remains service-lifecycle/CLI work.

## Shadow credential exposure containment during validation

A diagnostic command intended to inspect Shadow log tails selected more files than intended and emitted the contents of Shadow-only credential files into the tool response. The affected values were treated as exposed immediately.

Containment actions:

- the Shadow Gateway approval secret was rotated;
- the Shadow Gateway JWT signing secret was rotated;
- the Shadow Windows Worker credential was rotated;
- the Shadow WSL Worker credential and the Gateway-side copy were rotated together;
- the existing Shadow OAuth client registry was preserved, while access tokens signed by the old JWT were intentionally invalidated;
- no stable-production credential was read, rotated, or changed;
- no exposed value is recorded in repository documentation, source, tests, or Git history.

The incident also reinforced a Security v2 rule for future doctor/audit tooling: diagnostics must use explicit allowlisted metadata fields and explicit file targets rather than recursive broad file selection around secret-bearing runtime directories.

## Focused implementation validation

After the v2 implementation changes and canonical Worker-schema alignment:

- build: PASS;
- focused security/config suites: **16/16 PASS**;
- step-up fail-closed regression: PASS;
- Gateway loopback schema/listener regressions: PASS.

## Shadow candidate acceptance

Security v2 was deployed only to the isolated Shadow lane before PR creation. Stable production was not changed.

Observed candidate runtime:

- Shadow Gateway: `127.0.0.1:7675`, health 200, candidate bundle, stderr empty;
- Shadow Windows Worker: `127.0.0.1:7678`, health 200, candidate bundle;
- Shadow WSL Worker: `127.0.0.1:7679`, health 200, candidate bundle;
- Gateway health reported both Windows and WSL environments online;
- the configured public reverse-proxy/Funnel MCP path remained reachable after loopback binding and returned the expected 401 challenge for an unauthenticated request.

A temporary Shadow Workspace step-up rule was then applied to `write_file`. A direct authenticated Worker call without any approval grant returned:

```json
{"status":403,"error":"step_up_required","fileCreated":false,"pass":true}
```

The test rule and target file were removed/restored in the same bounded validation operation.

Because the Shadow JWT signing key had been rotated during credential-exposure containment, the pre-existing ChatGPT Shadow access token correctly became invalid. Rather than restoring an exposed key, a one-time local OAuth acceptance client was created against the candidate Gateway. Through the real OAuth token path and MCP transport it observed:

- public tool count: **17**;
- Core Manifest Revision: **6**;
- Deployment Manifest Fingerprint: **`sha256:68eac0d73d8efea95cfde694b33d44220049fb6180b60657b3d8b6ee0a9d59ad`**;
- Worker Protocol: **2.0**;
- Windows: online, `shadow-win-git` present;
- WSL: online, `shadow-wsl-git` present.

The one-time OAuth validation client entry was removed afterward and the candidate Gateway was restarted; read-back confirmed zero validation-client residue, loopback binding, health 200, and both environments still online. The user-facing ChatGPT Shadow connector still requires reauthorization because retaining the old signing key would violate the containment decision.

Full GitHub-hosted Windows/Ubuntu CI and stable release acceptance remain subsequent release gates and must pass before Security Baseline v2 is frozen.
