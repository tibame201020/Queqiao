# Security Policy

Queqiao is a security-sensitive Gateway/Worker substrate. Security reports are treated separately from ordinary feature requests and bug reports.

## Supported versions

Until a newer stable release is published, security fixes target the latest `0.7.x` release line and the default development branch.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting / Security Advisory flow for this repository when available.

Do not post secrets, bearer tokens, join codes, approval secrets, credential files, machine-specific runtime state, or exploit details in a public issue.

If private vulnerability reporting is not available, open a minimal public issue stating that you have a security report and avoid including sensitive technical details until a private coordination channel is established.

## What to include

When possible, include:

- affected version or commit;
- affected role (`Gateway`, `Worker`, `CLI`, protocol, policy, or extension);
- prerequisites and trust boundary involved;
- minimal reproduction steps;
- expected versus observed behavior;
- impact assessment;
- suggested mitigation, if known.

## Security model references

The current security and resource-safety contracts are documented in:

- `docs/security/security-baseline-v1-gate.md`
- `docs/security/security-baseline-v1-threat-matrix.md`
- `docs/resource-safety-baseline-v1.md`

Reports that demonstrate an authority-boundary bypass, workspace escape, command-policy bypass, credential exposure, OAuth/enrollment weakness, manifest/protocol downgrade, or fail-open routing behavior are especially important.
