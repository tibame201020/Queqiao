# Secure Agent Substrate Architecture Handoff Validation

- Date: 2026-08-13
- Result: PASS
- Branch: `feat/secure-agent-substrate-implementation`
- Scope: Wayfinder Phase 0 — architecture handoff into permanent ADRs and current architecture documentation.

## Purpose

Translate the resolved Secure Agent Substrate Wayfinder decisions into append-only repository architecture records before production source refactoring begins. This validation does not claim that protocol separation, extension DAG composition, async execution, or Git-extension behavior has already been implemented.

## Architecture records added

The following append-only ADRs were added:

- ADR-0007 — separate transport-neutral domain contracts, explicitly versioned Worker protocol, and MCP adapter responsibilities;
- ADR-0008 — trusted local TypeScript extension loading, deterministic register/extend/replace composition, Worker authority ceiling, and deployment-manifest semantics;
- ADR-0009 — Workspace as explicit authority boundary with repository/worktree/project-marker discovery interpreted by extensions/clients rather than Core authority;
- ADR-0010 — bounded `run` / `shell` `sync | async` execution modes without a durable Job domain or Core tmux dependency.

Existing ADRs were not rewritten to pretend these later decisions had always been the contract. The ADR index was extended to reference the new records.

## Architecture document correction

`docs/architecture.md` was updated to distinguish:

1. the current verified Revision 4 runtime;
2. current implemented package/module responsibilities;
3. accepted Secure Agent Substrate target boundaries that remain to be implemented.

The stale statement that `packages/workspace` was a future package was removed. The document now records it as an implemented safe Workspace primitive package.

The document also explicitly distinguishes Queqiao release version, Core Manifest Revision, Deployment Manifest Fingerprint, Worker Protocol Version, and the supported MCP specification revision window.

## Frozen baseline preservation

The architecture handoff preserves the frozen Revision 4 public tool contract as current verified behavior and treats later public-schema evolution as an intentional future Core Manifest Revision.

Historical Revision 4 and Security Baseline validation evidence was not modified.

## Verification

The implementation worktree completed after the architecture edits:

```text
git diff --cached --check
npm run typecheck
npm test
```

Observed results:

- staged whitespace check passed;
- machine-specific/secret-like literal scan of the staged diff passed;
- typecheck passed;
- full Vitest suite passed: 18 test files / 57 tests;
- stable Gateway remained healthy;
- shadow candidate Gateway remained healthy.

The expected invalid-YAML diagnostic emitted by the existing reload-regression test remained present while the test suite passed; it is not a Phase 0 failure.

## Acceptance conclusion

Wayfinder Phase 0 acceptance is satisfied:

- permanent ADRs cover protocol boundaries, extension composition/trust/manifest semantics, Workspace authority/discovery boundaries, and async execution semantics;
- `docs/architecture.md` no longer describes the already implemented Workspace package as future work and separates current behavior from target architecture;
- historical frozen validation evidence remains unchanged.

The next dependency-ordered ticket is **Protocol bounded-context split**.
