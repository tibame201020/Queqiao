# Production README and CLI onboarding validation - 2026-08-30

## Scope

This evidence validates the v0.8.2 documentation/UX patch. The patch does not change Gateway,
Worker, Workspace, Extension, protocol, or security runtime semantics.

## README production structure

The package README was reduced from 463 lines to 144 lines and now owns only:

- npm installation and `queqiao --version` verification;
- the Gateway / Worker / Workspace / Extension mental model;
- the copyable first-deployment workflow;
- a compact documentation map;
- contribution/security and project attribution links.

Detailed material was moved to dedicated user/operator documents rather than deleted:

- `docs/cli/reference.md` - full command surface and selector/JSON behavior;
- `docs/operations.md` - lifecycle, enrollment, paths, cleanup, ports, and migration;
- `docs/workspace-authority.md` - Workspace authority;
- `docs/extensions.md` - Extension Hub and authoring;
- `docs/architecture.md` - runtime/module architecture;
- `docs/distribution-cluster-baseline-v1.md` - distribution/enrollment guarantees.

## Interactive onboarding visuals

The README now uses one visual family throughout. All six assets are real packaged CLI PTY
recordings rendered at 1146x785:

1. `01-gateway-setup.gif`
2. `02-worker-access-setup.gif`
3. `03-instance-selector.gif`
4. `04-extension-attach.gif`
5. `05-runtime-start.gif`
6. `06-worker-enrollment.gif`

Step 5 is intentionally split into runtime startup and Worker enrollment so neither scene has
to compress a long terminal transcript. Deployment verification remains a copyable command
block below the enrollment visual.

All six GIFs are rendered with `agg --no-loop` plus a final-frame hold. Binary inspection
confirmed that none contains the GIF `NETSCAPE2.0` infinite-loop extension.

The enrollment recording uses the production password-style Join code prompt. The generated
join code is not echoed into the terminal stream. Raw cast scans found no real user path,
Tailscale hostname, OAuth/bearer material, or join-code payload.

## Regression contract

`apps/cli/src/cli-visual-docs.test.ts` now requires:

- a README no longer than 180 lines;
- the dedicated CLI reference and Operations links;
- all six interactive assets in the README;
- copyable commands for every onboarding step;
- no fallback to the old operational-renderer onboarding GIF;
- valid GIF assets with no infinite-loop extension;
- the real PTY recorder to retain `--no-loop`.

## Local release gate

Final local results on the v0.8.2 candidate:

- documentation link/integrity scan: PASS;
- focused CLI visual test: 4/4 PASS;
- packaged CLI acceptance: 13/13 PASS;
- full test suite: 577/577 PASS;
- security suite: 494/494 PASS;
- TypeScript typecheck: PASS;
- staged package build and `queqiao --version`: 0.8.2 PASS;
- raw PTY privacy scan: PASS;
- `git diff --check`: PASS.

## Excluded local prototypes

The existing untracked `apps/cli/src/product-setup.ts` and
`apps/cli/src/product-setup.test.ts` remain intentionally excluded.
