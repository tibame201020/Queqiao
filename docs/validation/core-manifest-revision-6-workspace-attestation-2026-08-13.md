# Core Manifest Revision 6 workspace targeting and deployment attestation — 2026-08-13

## Trigger

A strict ChatGPT Shadow acceptance of the Revision 5 candidate rejected the release for two contract/observability gaps even though filesystem, execution, async execution, Git, containment, policy, cross-environment routing, and OAuth persistence passed:

1. `workspace_info` had an empty input schema and therefore could not explicitly target a non-default Workspace such as the WSL acceptance Workspace.
2. the authenticated MCP session could not independently observe the Core Manifest Revision or Deployment Manifest Fingerprint used by the bound candidate.

The rejection is retained as release evidence; the acceptance standard is not downgraded.

## Revision 6 contract

Core Manifest Revision advances from 5 to 6.

`workspace_info` now accepts an optional bounded `workspaceId`:

- supplied: resolve and inspect that explicitly configured Workspace;
- omitted: preserve the existing default-Workspace behavior;
- `open_workspace` remains stateless and does not establish hidden server-side selection/session state.

No new public tool is introduced. Core remains 10 tools and the enabled first-party Git extension remains 7 tools in the candidate deployment.

## Safe deployment attestation

`list_workspaces` now includes a `deployment` projection produced from the same `@queqiao/operations` composition truth that powers CLI diagnostics. The projection contains only:

- `coreManifestRevision`;
- `deploymentManifestFingerprint`;
- `publicToolCount`;
- `workerProtocolVersion`;
- `supportedMcpProtocolVersions`.

It does not expose OAuth/Worker/approval secrets, tokens, extension module paths, runtime state paths, logs, or additional local filesystem data. Workspace descriptors retain their existing authenticated semantics.

The fingerprint is not hard-coded into the Gateway result. It is deterministically derived from the effective public Core + enabled public extension manifest.

## Regression evidence

The standard MCP vertical test now proves that:

- `workspace_info({ workspaceId: <non-default> })` returns the explicitly requested Workspace;
- `list_workspaces` returns Revision 6 deployment attestation;
- the attested fingerprint equals the fingerprint independently computed from the canonical Deployment Manifest used by the actual `tools/list` contract;
- Worker Protocol 2.0 and the supported MCP compatibility window are visible through the safe projection;
- the existing no-argument `workspace_info()` behavior remains valid.

Operations tests retain Revision 4/5 migration semantics while proving that the Revision 6 `workspace_info` schema differs from the old non-targetable contract and therefore produces a new Deployment Manifest Fingerprint.

## Gates

After the Revision 6 remediation:

- full test suite: 31 files / 117 tests PASS;
- security suite: 23 files / 91 tests PASS;
- cluster suite: 4 files / 15 tests PASS;
- `npm run security:gate`: PASS;
- production dependency audit: 0 vulnerabilities;
- package build: PASS;
- `git diff --check`: PASS.

Historical Revision 5 validation documents remain unchanged.
