# Isolated Worktree and Shadow Bundle Preflight

- Date: 2026-08-13
- Result: PASS
- Branch: `feat/secure-agent-substrate-implementation`
- Purpose: prove candidate build/test artifacts can be produced and swapped into the shadow stack without rebuilding or replacing the stable runtime bundle.

## Isolation setup

A separate Git worktree was created inside the already authorized broad development Workspace. The original repository path remains the runtime source for the stable Queqiao bundle; implementation and package builds occur only in the separate worktree.

Both worktrees were clean before candidate build activity.

## Baseline candidate checks

The isolated implementation worktree completed:

```text
npm ci
npm run typecheck
npm test
npm run test:security
npm run build:package
git diff --check
```

Observed results:

- dependency install completed with zero reported vulnerabilities;
- typecheck passed;
- full Vitest suite: 18 test files / 57 tests passed;
- security suite: 14 test files / 50 tests passed;
- package build passed;
- diff check passed.

The stable Gateway remained healthy throughout these operations.

## Stable artifact drift observation

The freshly rebuilt CLI and Gateway bundles matched the existing stable bundle hashes. The freshly rebuilt Worker bundle did not match the existing stable Worker artifact.

A direct bundle diff identified the material source difference:

```text
stable artifact:
const processes = new ProcessRunner();

current-source rebuild:
const processes = config.processes ?? new ProcessRunner();
```

This is the dependency-injection seam used by the current source tree for deterministic process-executor testing. The observation is important operationally: a source-tree rebuild must not be treated as a no-op replacement of the currently running stable artifact, even before Secure Agent Substrate feature implementation begins.

No stable artifact was rebuilt or replaced to resolve this drift.

## Shadow-only bundle replacement

The existing shadow stack was stopped without touching the stable services:

- shadow Gateway only;
- shadow Windows Worker only;
- `queqiao-shadow-worker.service` only.

After shadow shutdown:

- shadow ports were free;
- stable WSL Worker service remained active;
- stable local Gateway health returned HTTP 200;
- stable public HTTPS 443 health returned HTTP 200.

The shadow stack was then restarted using only the package output from the isolated implementation worktree:

```text
shadow public HTTPS :8443
        |
        v
candidate Gateway :7675
        |
        +--> candidate Windows Worker :7678
        |
        +--> candidate WSL Worker :7679
```

Process inspection verified that the Windows shadow Gateway/Worker and WSL transient shadow Worker executed bundle files from the implementation worktree, not from the stable repository path.

## Post-replacement acceptance

After candidate bundle replacement:

- candidate Windows Worker `/health`: HTTP 200;
- candidate WSL Worker `/health`: HTTP 200;
- candidate Gateway reported both Windows and WSL online;
- shadow public HTTPS 8443 `/health`: HTTP 200;
- stable public HTTPS 443 `/health`: HTTP 200;
- the existing stable ChatGPT Queqiao Revision connector successfully executed `list_workspaces` and returned both environments online.

No stable service restart and no stable Funnel listener replacement occurred.

## Remaining real-client gate

A separate ChatGPT connector must still be created for the shadow endpoint at:

```text
https://<funnel-host>:8443/mcp
```

That connector must complete OAuth and real MCP schema discovery/invocation. The existing stable connector must remain unchanged.
