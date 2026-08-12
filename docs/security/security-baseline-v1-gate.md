# Security Baseline v1 gate

Status: Candidate — not frozen

The gate is a required, repeatable release control. It does not certify that Queqiao
is vulnerability-free; it guarantees that the documented adversarial invariants and
known Critical/High dependency threshold are checked on every pull request and main
branch update.

## Local command

```text
npm run security:gate
```

## GitHub Actions

`.github/workflows/security-baseline.yml` runs the adversarial suite on Windows and
Linux and performs a production dependency audit. The workflow uses no repository
secrets, grants only `contents: read`, uses a lockfile install with lifecycle scripts
disabled, and has bounded execution time.

## Current enforced invariants

- OAuth redirect origins are allowlisted and exact registered redirect URIs are bound
  to authorization codes.
- Authorization Code flow requires PKCE S256; codes are single-use and verifier-bound.
- OAuth resource/audience, issuer, token use, client, and authorization revision are
  validated.
- Refresh tokens rotate on every use; replay revokes the client's authorization family.
- MCP rejects missing, forged, wrong-audience, and wrong-token-type bearer tokens.
- Worker APIs reject missing or incorrect Worker credentials.
- Worker policy denial cannot fall back to a legacy invocation route.
- Workspace traversal and symlink/junction escapes remain rejected.
- Profiles, tool/command policy, approval binding, process limits, timeout, cancellation,
  and output limits remain covered by the selected security suites.

## Freeze criteria

Security Baseline v1 may be frozen only after the full threat matrix is classified,
all Critical/High findings are closed or explicitly accepted, the gate passes on both
operating systems, and the branch protection rule requires this workflow.
