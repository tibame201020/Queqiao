# Security Baseline v1 threat matrix

Status: Candidate audit

Ratings describe risk to Queqiao's MCP authentication, routing, authorization, and
native execution boundary. Extension package provenance is assessed separately.

| Area | Threat | Severity | Current disposition | Gate evidence |
|---|---|---:|---|---|
| OAuth | Redirect manipulation or open redirect | Critical | Protected: allowed origins plus exact registered URI; credentials/fragments rejected | `security-baseline.test.ts` |
| OAuth | Authorization code interception/replay | Critical | Protected: PKCE S256, exact redirect/client binding, single-use code | `security-baseline.test.ts` |
| OAuth | Wrong issuer, audience/resource, or token type | Critical | Protected: JWT verification and claim checks | `security-baseline.test.ts` |
| OAuth | Refresh token replay | Critical | Protected: rotation, reuse detection, authorization-family revocation, legacy migration | `security-baseline.test.ts` |
| OAuth | Approval-secret brute force through spoofed proxy IP | High | Protected: per-IP limit plus proxy-independent global attempt budget | integration gate |
| OAuth | Anonymous registration storage exhaustion | High | Protected: expiring pending clients, separate pending/authorized capacities, serialized atomic writes | integration gate |
| MCP | Missing, forged, or stolen bearer token | Critical | Missing/forged protected; theft retains bearer capability until expiry or revision revocation | adversarial JWT tests; accepted OAuth bearer residual |
| MCP | Authenticated request/resource exhaustion | High | Protected by body limits, per-client rate/concurrency, and tool-specific limits | request budget and runtime tests |
| Gateway | Host-header/DNS rebinding | High | Protected by MCP SDK allowed-host validation | vertical integration test |
| Gateway | Public health leaks roots/policy | High | Protected: public health exposes only environment ID, online state, and workspace count | security and app tests |
| Routing | Workspace ID ambiguity | Critical | Protected: routing fails closed when more than one Worker claims an ID | `worker-registry.test.ts` |
| Routing | Worker identity mismatch | Critical | Protected: configured and claimed environment IDs must match | `worker-registry.test.ts` |
| Routing | Attacker-controlled Worker endpoint/SSRF | Critical | Protected in v1 baseline: loopback HTTP only, no URL credentials/query/fragment, token minimum | `config.test.ts` |
| Worker | Missing/incorrect Worker credential | Critical | Protected by timing-safe credential comparison; Worker binds loopback only | security integration test |
| Worker | Gateway policy bypass or stale Gateway decision | Critical | Protected: native Worker re-checks profile/tool/command policy immediately before execution | Worker permission tests |
| Filesystem | Traversal, symlink, or junction escape | Critical | Protected by lexical and canonical containment with no symlink targets | workspace tests on Windows/Linux gate |
| Filesystem | Oversized/binary/search exhaustion | High | Protected by size, depth, pagination, result, timeout, ignored-directory, and cancellation limits | workspace tests |
| Process | Shell injection or command substitution | Critical | Protected: no shell, basename-only executable, local allowlist | process and permission tests |
| Process | Timeout, output, cancellation, concurrency exhaustion | High | Protected by ProcessRunner limits and termination | process tests |
| Config | Partial write, invalid reload, or fail-open policy | High | Protected by validated atomic files and last-known-good runtime state | config/policy tests; hot-reload ChatGPT evidence |
| Approval | Grant substitution or replay | Critical | Contract protected: canonical complete-request digest, principal/environment/workspace/tool binding, expiry and single consumption | security package tests; runtime integration deferred |
| Secrets | Leakage through public logs/health/errors | High | Health/log payload redaction protected; restrictive cross-platform file provisioning remains CLI setup work | tests plus setup acceptance pending |
| Worker auth | Credential rotation without downtime | Medium | Design pending CLI setup; current rotation requires coordinated restart | deferred to CLI setup |
| Audit | Durable redacted security event trail | Medium | Contract not implemented | required before Dashboard, not a Critical/High freeze blocker |

## Residual-risk policy

- TLS termination and public availability are provided by the configured Funnel/reverse
  proxy. Queqiao validates proxy configuration and never accepts non-HTTPS public URLs
  outside localhost.
- ChatGPT currently uses OAuth bearer tokens rather than proof-of-possession tokens.
  A stolen valid access token can act as that connector until its one-hour expiry or an
  authorization revision revokes it. This is an explicit protocol residual, not an
  unbounded Queqiao permission grant; Worker policy remains authoritative.
- Local compromise of the same operating-system account is outside the remote MCP
  adversary boundary and can already access that user's files and process credentials.

## Remaining freeze work

1. Add integration assertions for global approval throttling and registration lifecycle.
2. Verify GitHub runners pass on both Windows and Linux after push.
3. Configure branch protection to require the Security Baseline workflow.
4. Run the public Funnel acceptance without changing the nine-tool manifest.
