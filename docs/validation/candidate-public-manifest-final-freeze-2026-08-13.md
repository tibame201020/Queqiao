# Candidate public manifest final freeze — 2026-08-13

## Release state

All Secure Agent Substrate Wayfinder tickets that can be implemented and validated from the repository/runtime side are complete. The only remaining release gate is the real ChatGPT **New-manifest ChatGPT acceptance**, which requires a user-created frozen connector binding and therefore cannot be completed from the server/repository side alone.

No further public tool-schema change is permitted between this freeze and that ChatGPT acceptance. If the ChatGPT acceptance finds another contract defect, the candidate must intentionally advance to a new Core Manifest Revision and new Deployment Manifest Fingerprint rather than silently refreshing this frozen contract.

## Frozen public contract

- Core Manifest Revision: **6**
- Worker Protocol Version: **2.0**
- public tool count: **17**
- Deployment Manifest Fingerprint: **`sha256:68eac0d73d8efea95cfde694b33d44220049fb6180b60657b3d8b6ee0a9d59ad`**
- supported MCP protocol revisions:
  - `2025-03-26`
  - `2025-06-18`
  - `2025-11-25`
  - `2026-07-28`

Core tools:

1. `workspace_info`
2. `list_workspaces`
3. `open_workspace`
4. `read_file`
5. `write_file`
6. `edit_file`
7. `list_directory`
8. `search_text`
9. `run`
10. `shell`

First-party Git extension tools:

11. `git_repositories`
12. `git_status`
13. `git_diff`
14. `git_log`
15. `git_branches`
16. `git_worktree_create`
17. `git_worktree_remove`

`workspace_info` accepts an optional bounded `workspaceId` so Windows and WSL Workspaces can be inspected explicitly without hidden session-selection state.

`list_workspaces` exposes the safe deployment-attestation projection generated from the same operations/composition truth that builds the Deployment Manifest. The projection includes Core Manifest Revision, Deployment Manifest Fingerprint, public tool count, Worker Protocol Version, and supported MCP revisions.

`run` and `shell` retain `mode: sync | async`; async acceptance returns native process identity/metadata, discards stdout/stderr, remains bounded by Worker process policy, and does not create a durable Queqiao Job abstraction.

## Wayfinder closure ledger

Repository/runtime-side completion covers:

- Shadow-stack / blue-green validation lane;
- architecture handoff into ADRs;
- protocol bounded-context split;
- MCP compatibility-window research;
- MCP adapter compatibility implementation;
- extension config and manifest schema v1;
- extension composition resolver;
- extension host loader and scoped activation;
- extension authority adversarial gate;
- composition diagnostics model;
- Deployment Manifest fingerprint;
- CLI manifest/extension/tool diagnostics;
- Dashboard-ready operations contract;
- Extension Core capability API;
- native process runtime async refactor;
- `run` / `shell` sync|async Core Manifest revision;
- async disconnect and resource security gate;
- Workspace discovery semantic audit;
- Workspace authority-model migration;
- Git extension read/discovery baseline;
- Git contained-worktree lifecycle;
- Git extension security and acceptance gate;
- generic MCP client interoperability matrix;
- release/package/Security Baseline verification.

The remaining `New-manifest ChatGPT acceptance` is intentionally external and pending the user-created Shadow connector.

## Final generic MCP client gate

After rebuilding and restarting all three Shadow candidate runtime roles from the final bundle, the official MCP Inspector CLI (`@modelcontextprotocol/inspector@2.2.0`) was run again through the public Shadow Streamable HTTP endpoint.

It independently confirmed:

- exact 17-tool contract;
- exactly seven named Git tools;
- targetable `workspace_info(workspaceId?)`;
- Core Manifest Revision 6;
- Deployment Manifest Fingerprint exactly matching the frozen value above;
- public tool-count attestation 17;
- Worker Protocol 2.0;
- exact bounded four-revision MCP window;
- explicit Windows Workspace routing;
- explicit WSL Workspace routing;
- native Git status calls in both environments.

The same Inspector gate passed again after removal of the obsolete revision-specific Shadow ingress routes.

## Shadow/stable isolation at freeze

The final candidate runs behind the permanent public Shadow path `/shadow`; the MCP endpoint is `/shadow/mcp` and OAuth discovery/authorization is path-scoped to the same Shadow deployment.

Obsolete `/shadow-r5` public routing and its two revision-specific OAuth metadata routes were removed after the permanent Shadow endpoint passed the final Inspector gate. The obsolete path now has no dedicated candidate handler.

The stable public root and stable Windows/WSL runtime roles remained healthy and were not restarted or replaced while the final Shadow candidate was rebuilt and restarted. The final recovery probes confirmed stable and Shadow public health concurrently.

## Package artifact

Final tested package artifact:

- `tibame201020-queqiao-0.1.0.tgz`
- SHA-256: **`274030cb0035f41de09021f32972566530a88b6cfaa0536ecb101e1034323db0`**

The same artifact passed repo-outside installation/runtime gates on Windows and Linux/WSL. Package-content review found no unexpected assets or deployment-specific credential/path material.

## Repository/security gates

Final current-source gates before freeze:

- clean source bootstrap: PASS;
- TypeScript project-reference completeness audit: PASS;
- typecheck: PASS;
- full suite: 31 files / 118 tests PASS;
- security suite: 23 files / 92 tests PASS;
- cluster suite: 4 files / 15 tests PASS;
- production dependency audit: 0 vulnerabilities;
- package build: PASS;
- package dry-run: PASS;
- Windows package runtime: PASS;
- Linux/WSL package runtime: PASS;
- `git diff --check`: PASS;
- generic MCP Inspector after final runtime restart: PASS;
- generic MCP Inspector after obsolete ingress cleanup: PASS.

## Next gate

Create or recreate exactly one ChatGPT development connector named **Queqiao Shadow** against the permanent `/shadow/mcp` endpoint and perform the strict New-manifest ChatGPT acceptance.

The existing stable **Queqiao Revision** connector remains the recovery/control connector. Old revision-labelled Shadow connectors are not part of the target operating model and may be removed once their acceptance evidence has been preserved.
