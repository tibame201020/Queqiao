# Workspace Management convergence validation - v0.9.0

Date: 2026-08-30

## Scope

This release converges Workspace and Access Profile management into a production CLI model without changing the public MCP Rev 4 schema or Worker-authoritative enforcement.

## Public management model

- `queqiao worker workspace` is the interactive Workspace Management entry point.
- Workspace automation surface: `list`, `info`, `add`, `edit`, `remove`.
- Access Profile automation surface: `profiles list`, `info`, `create`, `edit`, `rename`, `delete`.
- Workspace automation uses `--access-profile <Reader|Editor|custom>` instead of the retired legacy capability-ceiling `--profile` model.
- `workspace profile set`, `workspace tool allow|deny`, `workspace command allow|deny`, and `workspace permissions show` are retired from the canonical public CLI surface.
- Saved Access Profiles are detached templates: applying one copies its tools/executables matrix into a Workspace. Later profile edits, renames, or deletion do not mutate existing Workspace policy.
- Built-in Reader and Editor profiles remain immutable.

## Safety and authority

- Worker config remains authoritative for Workspace roots and policy.
- Canonically duplicate Workspace roots remain rejected while nested Workspace roots remain allowed.
- A Worker must retain at least one Workspace.
- Profile lifecycle operations report no implicit Workspace mutation.
- Public MCP Rev 4 remains unchanged.

## Validation

- Full suite: 613/613 PASS.
- Security suite: 519/519 PASS.
- `npm audit --omit=dev --audit-level=moderate`: 0 vulnerabilities.
- Packaged CLI acceptance: 8/8 PASS, including Workspace CRUD, Access Profile CRUD, detached-template semantics, Extension lifecycle, runtime lifecycle, and enrollment.
- Command surface tests: 199/199 PASS.
- Workspace management service tests: 5/5 PASS.
- Workspace CLI tests: 11/11 PASS.
- Access Profile store tests: 6/6 PASS.
- CLI visual docs: 5/5 PASS.
- Eight interactive onboarding GIFs were re-recorded from the final v0.9.0 staged package revision with no-loop/final-frame behavior.
- Operational flow GIFs were re-recorded using `--access-profile Editor` and `workspace info` rather than retired policy routes.
- Final raw PTY cast privacy scan: 8/8 casts contained no machine path, real Gateway endpoint, authorization credential, approval-secret label/value, join code, or token marker.
- Final working-tree diff sensitive scan found no real endpoint, user machine path, or credential pattern.
- npm tarball version: 0.9.0.
- npm tarball contains `README.md`, `README.zh-TW.md`, and package metadata; both READMEs document `queqiao worker workspace`, neither uses `queqiao.cmd`, and the Traditional Chinese README is valid UTF-8.

## Visual onboarding

The final interactive series is:

1. Gateway setup
2. Gateway connector info
3. Worker and first Workspace access setup
4. Workspace Management
5. Named-instance selector
6. Extension attach
7. Runtime start
8. Worker enrollment