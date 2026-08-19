# Contributing to Queqiao

Thanks for helping improve Queqiao.

Queqiao is a security-sensitive Gateway/Worker substrate. Changes are expected to preserve explicit authority boundaries, native-environment execution, bounded operations, and fail-closed behavior.

## Development workflow

1. Create a topic branch from the current default branch.
2. Keep changes scoped and avoid mixing refactors with security- or protocol-sensitive behavior changes.
3. Add or update tests for observable behavior.
4. Run the required local gates before opening a pull request:

```shell
npm run typecheck
npm test
npm run security:gate
npm run test:security
npm run test:cluster
npm run resource:gate
npm audit
```

5. Run `git diff --check` before committing.
6. Open a pull request and wait for the required Windows and Linux checks to pass.

## Security-sensitive changes

Changes involving OAuth, enrollment, Worker identity, workspace containment, command execution, MCP compatibility, manifest fingerprints, secret storage, or extension authority should include adversarial or regression coverage where practical.

Do not weaken policy or allowlists to make a test pass. Do not commit credentials, join codes, approval secrets, runtime secrets, machine-specific paths, or production state.

## Architecture and contracts

Before changing public behavior, review:

- `docs/architecture.md`
- `docs/adr/README.md`
- `docs/security/security-baseline-v1-gate.md`
- `docs/resource-safety-baseline-v1.md`

Public MCP tool names, protocol revisions, Worker protocol behavior, and deployment-manifest fingerprints are compatibility contracts. Treat changes to them as deliberate versioned changes rather than incidental refactors.

## Pull requests

A good pull request should explain:

- what changed;
- why the change is needed;
- which authority/security boundary is affected, if any;
- how the change was validated;
- whether any public contract changes.

Small, reviewable pull requests are preferred.
