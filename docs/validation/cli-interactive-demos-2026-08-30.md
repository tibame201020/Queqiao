# CLI interactive demo and version validation - 2026-08-30

Branch: `docs/cli-interactive-demos`

## Scope

This follow-up closes two post-`v0.8.0` production gaps:

1. README onboarding must show the real interactive Queqiao CLI across the major product boundaries instead of collapsing to one representative animation.
2. The installed CLI must expose an explicit version surface suitable for both humans and automation.

The existing local `product-setup` prototypes remain outside this work.

## Interactive recording architecture

The interactive recorder packages the same source revision through the repository package build path, installs/runs that staged package in isolated Queqiao state, and drives the real `queqiao` executable through a real PTY.

The recorder waits for production prompt text before sending normal terminal input such as arrow keys, Space, Enter, and typed text. It captures the resulting ANSI terminal stream as an asciicast and renders it through pinned `agg` 1.9.0 with checksum verification.

No hidden public CLI flags were introduced for documentation recording. The recorder does not reimplement the Queqiao prompt renderer.

## Interactive scenarios

`npm run docs:cli:interactive` reproduces four independent scenarios from isolated state:

1. `gateway setup`: create a named Gateway through the production setup wizard.
2. `worker setup`: create a Worker, its first Workspace, and a Custom Access configuration including the Tools multiselect and allowed executables.
3. named-instance selector: create multiple Gateways and exercise the production selector with keyboard navigation.
4. Extension attachment: install two isolated local mock Extensions and attach the selected Extension through the production interactive selector.

Generated interactive assets:

- `docs/assets/cli/interactive/01-gateway-setup.gif`
- `docs/assets/cli/interactive/02-worker-access-setup.gif`
- `docs/assets/cli/interactive/03-instance-selector.gif`
- `docs/assets/cli/interactive/04-extension-attach.gif`

The root README presents five visual onboarding beats:

1. Configure the Gateway: interactive GIF.
2. Configure the Worker and first Workspace: interactive GIF.
3. Select named instances as the deployment grows: interactive GIF.
4. Install and attach Extensions explicitly: interactive GIF.
5. Start, enroll, and verify the deployment: real packaged operational flow GIF.

`apps/cli/src/cli-visual-docs.test.ts` protects these README references and assets so the onboarding cannot silently regress to a single animation.

The visual documentation is split into three explicit classes:

- `docs/cli/interactive/`: real PTY interactive wizard/selector recordings.
- `docs/cli/flows/`: real packaged operational command flows.
- `docs/cli/components/`: deterministic component and presentation-grammar examples.

## Version surface

The follow-up adds a canonical `version` CLI leaf plus the conventional global flags:

```text
queqiao version
queqiao --version
queqiao -v
```

Human output is the bare installed package version. JSON mode is stable and machine-readable:

```json
{"schemaVersion":"1.0","version":"0.8.1"}
```

The version is not hard-coded in CLI source. `scripts/build-package.mjs` reads the root package version and injects it into the packaged bundles at build time. Source/dev execution has an explicit non-bundled fallback, while packaged acceptance verifies the built artifact against the repository package version.

The canonical CLI contract, dispatch coverage, root help, packaged acceptance registry, and public help all include the new version surface.

## Privacy and safety audit

Raw interactive casts are scanned for developer-specific Windows user paths, real Tailscale/Funnel hostnames, OAuth authorization material, bearer values, join codes, credentials, tokens, and secrets.

The recorder uses isolated HOME/config/runtime state and synthetic Gateway, Worker, Workspace, and Extension identifiers.

## npm publication observation

`v0.8.0` was successfully published through GitHub Actions Trusted Publishing with provenance. Public registry verification returned:

```json
{
  "version": "0.8.0",
  "dist-tags": { "latest": "0.8.0" },
  "versions": ["0.7.0", "0.8.0"]
}
```

A fresh isolated global install of `@tibame201020/queqiao@0.8.0` also succeeded and produced a working CLI.

The npmjs package web UI was observed by the user still showing `0.7.0` after the registry had already advanced to `0.8.0`. The registry and fresh-install checks are authoritative for publication state; the web-page discrepancy is treated as npmjs presentation/cache propagation until independently refreshed.

This follow-up is prepared as `0.8.1`. Publishing `0.8.1` will also refresh the npm package README snapshot with the complete multi-GIF onboarding.

## Validation gates

Local release-candidate results:

- `npm run docs:cli:all`: PASS; component, operational, and four real-PTY interactive recording sets regenerated from the `0.8.1` revision.
- focused command surface, dispatch, and visual-doc tests: PASS, 228/228.
- `npm run test:cli-acceptance`: PASS, 13/13.
- full `npm test`: PASS, 576/576.
- `npm run test:security`: PASS, 494/494.
- `npm run typecheck`: PASS.
- isolated package build: PASS.
- packaged `queqiao --version`: `0.8.1`.
- packaged `queqiao version --json`: `{"schemaVersion":"1.0","version":"0.8.1"}`.
- package, lockfile, and lockfile-root versions: all `0.8.1`.
- documentation-link and GIF-asset integrity scans: PASS.
- raw interactive cast privacy scan: PASS; no developer path, real endpoint, join code, bearer value, or credential material found.
- `git diff --check`: PASS.

Still required after push:

- Windows and Ubuntu required GitHub Actions checks.
- after release: npm registry `latest`, fresh isolated install, and `queqiao --version` verification.

## Excluded local prototypes

The following existing untracked product orchestration prototypes are intentionally excluded and must remain unstaged:

- `apps/cli/src/product-setup.ts`
- `apps/cli/src/product-setup.test.ts`
