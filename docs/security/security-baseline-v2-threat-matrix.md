# Security Baseline v2 Threat Matrix

This matrix records the Security v2 delta on top of the frozen Security Baseline v1 threat model and adversarial matrix.

| Threat / boundary | Audit result | Security v2 control | Verification |
|---|---|---|---|
| Workspace `stepUp` configured but ignored by native Worker | **Confirmed High, fail-open before v2** | Worker consumes the canonical Workspace schema; a matching step-up rule is rejected with `step_up_required` until approval grants are integrated | Worker adversarial regression proves the mutation is rejected and no file is created |
| Gateway config says one host while entrypoint silently binds another | **Confirmed Medium drift** | `gateway.listen.host` is constrained to `127.0.0.1`; Gateway loader carries it; entrypoint uses a tested listener helper | Config rejects `0.0.0.0`; Node listener test asserts `127.0.0.1` |
| LAN/plain-HTTP access bypasses the intended local reverse-proxy/Funnel boundary | **Reduced by loopback binding** | Gateway and Worker verified listeners are both loopback-only; public TLS exposure remains outside the Core listener | Config + listener tests; Shadow/stable socket acceptance before promotion |
| Malicious/compromised MCP client invokes filesystem or process tools | Covered by v1 | OAuth authenticates connector; Worker re-checks Workspace/profile/tool/capability/command/path/process constraints | Existing v1 security suite remains required |
| Malicious extension exceeds declared authority | Covered by current implementation | Only explicit `trusted:true` local modules load; module identity/version and declared contribution/capability ceiling are validated; Worker capability authority remains final | Existing extension authority/composition tests |
| Workspace/repository content is treated as executable extension | Not observed | Extension host never scans Workspace/repository content for modules | Source architecture + extension tests |
| Path traversal, symlink/junction escape, external Git worktree | Covered by v1 | Native Workspace containment and Git containment remain unchanged | Existing Workspace/Git adversarial tests |
| Arbitrary native executable or implicit shell | Covered by v1 | `run` requires command allowlist; `shell` requires explicit Workspace shell grant; process limits/cancellation remain bounded | Existing Worker/process tests |
| Worker endpoint exposed publicly | Covered | Worker schema/listener accepts/binds IPv4 loopback only and requires token outside `/health` | Existing config/Worker tests + release socket acceptance |
| Stolen OAuth access token | Residual | Short-lived bearer access token, issuer/audience/token-use checks, authorization revision, refresh replay revocation | Existing OAuth security tests; bearer theft remains documented residual |
| OAuth redirect/resource/PKCE downgrade | Covered by v1 | Registered redirect origins, PKCE S256, resource binding, one-time authorization codes | Existing Gateway adversarial tests |
| Approval-secret brute-force through spoofed proxy identity | Covered by v1 | Global approval-secret rate limit independent of proxy identity | Existing Gateway adversarial test |
| Public health leaks roots/policy/secrets | Covered by v1 | Sanitized public health only | Existing security test |
| Fresh Windows setup inherits overly broad ACL from parent | **Confirmed Medium before v2** | Setup/migration explicitly protect runtime directories/files and replace inherited ACLs with current-user + SYSTEM authority; ACL failure aborts setup | Windows adversarial test starts beneath an Everyone-writable inherited parent and verifies protected, non-inherited exact SID authority |
| Durable audit logging causes uncontrolled disk writes | **Medium pre-Dashboard blocker** | Durable audit trail intentionally deferred; any implementation must be bounded/redacted and re-pass Resource Safety | Resource Safety v1 remains required; no durable security event store claimed yet |
| Worker credential cannot rotate without restart | **Medium pre-CLI blocker** | Deferred to service lifecycle/rotation design | Must be resolved before setup/service lifecycle is considered complete |
| Workflow action tag is retargeted upstream | **Medium supply-chain risk before v2** | Required Actions pinned to reviewed commit SHAs; workflow permissions remain `contents: read` | Static workflow review + GitHub Actions execution |
| Dependency install executes unexpected lifecycle scripts in CI | Covered | Required workflows use `npm ci --ignore-scripts`; package allow-scripts remains explicit | Workflow inspection + dependency audit |
| Production dependency vulnerability | Covered | `npm audit --omit=dev` required | Security workflow |
| Security hardening increases RAM/disk pressure | Cross-baseline risk | Resource Safety Baseline v1 remains required on Windows + Ubuntu | Resource Safety GitHub checks |

## Severity interpretation

- **High** means a configured security policy could be bypassed at the native enforcement layer.
- **Medium** means meaningful attack-surface, provisioning, supply-chain, or operational-hardening work is required before the next product surface, but the current default stable deployment is not demonstrated to be remotely compromised by that finding.

Security v2 does not convert deferred controls into claims. CLI setup/doctor and Dashboard work must close their listed blockers explicitly.
