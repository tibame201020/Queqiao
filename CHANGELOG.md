# Changelog

## 0.7.0 - 2026-08-19

First public npm release candidate for the current Queqiao Secure Agent Substrate.

### Highlights

- One public OAuth-protected MCP Gateway routes to native Windows and WSL/Linux Workers.
- Core Manifest Revision 6 with ten Core tools and a deterministic deployment manifest; the accepted production-like composition enables the first-party Git extension for 17 public tools total.
- Worker Protocol 3.0 with explicit Worker identity, persistent Gateway-owned membership, bounded liveness observation, and fail-closed compatibility checks.
- Named role-local CLI lifecycle: `gateway setup|serve|stop|status`, `worker setup|serve|stop|status`, explicit `workspace add`, and no OS service/autostart installation.
- Atomic Worker enrollment with one-time join tokens, versioned `qjq1:` join codes, provisional credentials, confirmation, live health/protocol verification, and rollback on failure.
- Bounded MCP compatibility window for `2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28`; unknown future revisions fail closed.
- Worker-authoritative Workspace, filesystem, process, tool, command, shell, and Git containment policy.
- `run` and `shell` support bounded synchronous and asynchronous native execution without introducing a durable Job abstraction.
- Trusted local extension composition with deterministic diagnostics and Deployment Manifest Fingerprint.
- Security Baseline v2, Resource Safety Baseline v1, self-contained package checks, Windows/Ubuntu adversarial CI, and dedicated cross-platform CLI setup-flow protection.
- Real ChatGPT, Windows, WSL/Linux, package, Shadow, and Stable promotion acceptance evidence is retained under `docs/validation/`.

### Accepted deferred controls

These are not release blockers for 0.7.0 and are not claimed as implemented:

- GUI Dashboard frontend; the shared Dashboard-ready operations/diagnostics contract is already implemented.
- Durable redacted security audit history and its retention/rotation policy.
- Automatic or zero-downtime Worker credential rotation.
- Full interactive step-up approval-grant runtime; configured step-up policy currently fails closed.
- Untrusted extension sandboxing, marketplace/Hub, or runtime malware adjudication.
- Non-loopback remote Worker transport such as a future mutually authenticated or gRPC binding.
