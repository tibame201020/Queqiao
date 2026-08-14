# Security Baseline v2 Gate

Security Baseline v2 is the pre-management-UI hardening gate for Queqiao as a remote MCP control substrate. It extends, rather than replaces, Security Baseline v1.

## Required invariants

1. **Native Worker remains final authority.** Gateway authentication or extension composition never grants filesystem/process authority by itself.
2. **Configured step-up policy must never fail open.** Until an end-to-end approval-grant runtime exists, any tool matched by a Workspace `stepUp` rule is rejected at the Worker with `step_up_required` before mutation or execution.
3. **Gateway verified listener is loopback-only.** The runtime config accepts `127.0.0.1` for `gateway.listen.host`; the entrypoint uses that value and the Node listener is tested to bind IPv4 loopback. Public TLS exposure belongs to the configured reverse-proxy/Funnel boundary.
4. **Worker listener remains loopback-only** and Worker endpoints remain protected by the per-environment credential.
5. **Filesystem, process, Git and extension authority remain bounded** by the existing v1 containment and capability gates.
6. **Required GitHub Actions use reviewed immutable commit SHAs** and retain least-privilege workflow permissions.
7. **Resource Safety Baseline v1 remains green.** Security hardening must not introduce idle write churn, material memory pressure, or lifecycle leakage.
8. **Public MCP contract remains stable** unless a separately reviewed contract change is intentional.

## Required CI

On pull requests and `main`:

- typecheck;
- full test suite;
- adversarial `test:security` suite on Windows and Ubuntu;
- production dependency audit;
- self-contained package/cluster checks;
- Resource Safety Baseline on Windows and Ubuntu.

Security v2 specifically adds regression coverage for canonical Workspace-policy parsing, step-up fail-closed enforcement, and the loopback Gateway listener.

## Accepted residuals / deferred controls

The following are **not** claimed as implemented by Security Baseline v2:

- **Windows fresh-install ACL hardening.** Current production metadata is restricted, but `config init` still relies on parent ACL inheritance. Explicit cross-platform provisioning/doctor verification is required before CLI setup is considered complete.
- **Durable redacted security audit trail.** HTTP metadata logging exists, but durable auth/policy/config/extension/tool audit events are a Dashboard prerequisite. Adding them must re-run Resource Safety because they change disk-write behavior.
- **Worker credential rotation without downtime.** This remains part of service-lifecycle/CLI work.
- **Full step-up approval runtime.** Security v2 deliberately fails closed instead of pretending an approval challenge has been satisfied.
- **Bearer-token theft before expiry/revocation.** Access tokens remain bearer credentials; compromise is bounded by token lifetime and authorization revision/revocation controls.
- **Untrusted extensions.** Extensions are explicit trusted local modules; provenance/sandboxing is a separate future product boundary.

## Release rule

Any future CLI setup/service lifecycle or Dashboard work must preserve this gate. A change that weakens one of these invariants requires an explicit security review and updated adversarial evidence rather than a silent exception.
