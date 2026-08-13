# Final package and security verification — 2026-08-13

## Scope

This gate closes the Wayfinder Final Package / Security Verification ticket for the Secure Agent Substrate candidate. It verifies a clean source bootstrap, npm packaging, package contents, repo-outside runtime installation on Windows and Linux/WSL, documentation currency, and release hygiene.

## Clean source bootstrap

The first `npm pack` attempt exposed a real source-bootstrap defect: `prepack` runs the full clean/check pipeline, and several composite TypeScript projects depended on previously generated sibling declarations because their `references` graph was incomplete.

The project-reference graph was corrected instead of weakening `prepack` or skipping `clean`:

- CLI references its actual internal contract/manifest/operations/protocol dependencies;
- Gateway references Core Manifest, Git extension, MCP compatibility, operations, and its existing runtime dependencies;
- Worker references the first-party Git extension;
- Core Manifest references contracts and process runtime;
- operations references config/contracts/Core Manifest/tool runtime;
- tool runtime references config/contracts;
- the Git extension is a composite project.

A mechanical import-to-project-reference audit reported zero missing internal project references.

Generated `apps/*/dist` and `packages/*/dist` directories were then removed while preserving the live root candidate bundle. From zero package/app declarations and build-info artifacts, the first `npm run typecheck` succeeded. The full test suite and package build then succeeded from that fresh state.

## Final repository gates

Final current-source gates:

- typecheck: PASS;
- full suite: 31 files / 118 tests PASS;
- security suite: 23 files / 92 tests PASS;
- cluster suite: 4 files / 15 tests PASS;
- `npm run security:gate`: PASS;
- production dependency audit: 0 vulnerabilities;
- package build: PASS;
- `git diff --check`: PASS.

## Package artifact

Final tested tarball:

- filename: `tibame201020-queqiao-0.1.0.tgz`;
- SHA-256: `274030cb0035f41de09021f32972566530a88b6cfaa0536ecb101e1034323db0`;
- package entries: 8;
- unexpected entries: 0.

The package contains only the declared runtime/documentation surface under `package/`:

- bundled CLI runtime;
- bundled Gateway runtime;
- bundled Worker runtime;
- package metadata;
- README;
- example configuration.

The packaged Worker bundle contains the first-party Git extension identity and all seven named Git public-tool contracts. The tarball scan found no candidate hostnames, user-local absolute paths, Shadow runtime directory names, approval/JWT secret file names, or equivalent machine-specific deployment material.

## Windows repo-outside install/runtime

The final tarball was installed into an external temporary npm prefix rather than executed from the repository source layout.

Evidence:

- installed `queqiao` CLI shim executed successfully;
- installed Gateway bundle became healthy against the installed Worker bundle;
- the test environment registered online through the packaged Gateway;
- authenticated Worker hello reported Worker Protocol `2.0`;
- Worker platform reported `windows`;
- `async-process-v1` capability was present;
- unauthenticated Worker hello returned HTTP 401.

The tested artifact hash was the final SHA-256 above.

## Linux / WSL repo-outside install/runtime

The same tarball was passed to the Linux package integration script under WSL. A temporary LF-normalized copy of the script was used only to avoid Windows checkout line-ending effects; the package artifact itself was unchanged.

Evidence:

- repo-outside npm package installation: PASS;
- packaged Linux Worker startup: PASS;
- packaged Gateway startup: PASS;
- authenticated Worker handshake: PASS;
- Worker Protocol `2.0`: PASS;
- Linux platform assertion: PASS;
- `workspace-routing` capability: PASS;
- `async-process-v1` capability: PASS;
- Gateway health: PASS.

WSL independently computed the same tarball SHA-256:
`274030cb0035f41de09021f32972566530a88b6cfaa0536ecb101e1034323db0`.

## Documentation and metadata review

Current README and architecture documentation were updated to describe the implemented candidate rather than the historical Revision 4 state:

- Core Manifest Revision 6;
- Worker Protocol 2.0;
- ten Core tools plus seven first-party Git extension tools in the candidate deployment;
- Workspace as an authority boundary rather than repository/project identity;
- deterministic extension composition and immutable Core authority envelope;
- `run` / `shell` `sync | async` semantics without a Job API or durable recovery abstraction;
- deployment fingerprint/attestation;
- bounded MCP revision compatibility;
- deprecated Git-coupled Workspace discovery/approval behavior removed from the current CLI guidance.

Historical Revision validation documents remain unchanged.

The package metadata already declares the repository/homepage/bug tracker, runtime bins, files allowlist, supported Node/npm engine range, and publish configuration. No repository license file is present, so this gate does not invent or misrepresent a license declaration.

## Result

PASS.

The candidate can be clean-built and packaged from source, the final package is self-contained for the tested runtime roles on Windows and Linux/WSL, and no release-blocking security/package/documentation defect remains from this ticket.
