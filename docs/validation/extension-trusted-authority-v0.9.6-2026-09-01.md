# Extension trusted authority validation — v0.9.6 — 2026-09-01

## Decision

Registered capabilities from an installed and attached Extension are a trusted execution-authority boundary. Workspace policy authorizes that boundary through the Core `extension` tool. Once `extension` is allowed, registered capability names are not re-authorized through capability-specific `tools.allow`, the legacy Workspace profile, declared Core capability ceilings, or the Workspace command allowlist.

Core tools remain subject to their existing Workspace policy. `extend` and `replace` contributions remain inside the invoked Core tool contract. Extension helper APIs continue to preserve Workspace identity/path containment and ProcessRunner timeout, cancellation, concurrency, and output bounds.

## Regression covered

v0.9.5 Access Profile convergence produced finite Core-only `tools.allow` lists. Registered Extension calls then re-entered Worker authorization using capability names such as `mcp` or `git_status`, which could never be selected by the Core-only Access Profile UI. This caused newly configured Workspaces to discover Extensions successfully but reject their capability calls.

## Verification

- TypeScript build/typecheck: PASS.
- Worker Extension/Git regression tests: PASS.
- Security suite: 57 files / 525 tests PASS.
- Full test suite: 88 files / 744 tests PASS.
- Cluster suite: 8 files / 30 tests PASS.
- Workstation suite: 16 files / 129 tests PASS.
- Isolated Workstation smoke: 2 files / 18 tests PASS.
- Resource safety baseline: PASS with no budget failures.
- Production dependency audit: PASS, 0 vulnerabilities.
- Negative coverage confirms a Workspace that does not allow Core `extension` still rejects direct and proxied registered Extension execution.
- SafeWorkspace traversal containment remains enforced for registered Extension filesystem helper calls.
