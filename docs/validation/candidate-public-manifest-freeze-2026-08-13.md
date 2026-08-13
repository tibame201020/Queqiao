# Candidate Public Manifest Freeze �X 2026-08-13

## Freeze decision

The candidate public contract is frozen for Shadow Connector binding validation.

- Core Manifest Revision: `5`
- Worker Protocol: `2.0`
- Public tool count: `17`
- Deployment Manifest Fingerprint: `sha256:0376b8d3f82e705141defbd31f72f70195d8884275ce9f89d0ae94ebcce5b9df`

No additional public MCP schema changes are permitted between this freeze and the Shadow Connector acceptance run. Any public schema change after this point requires a new manifest fingerprint and a new explicit freeze decision.

## Frozen public tools

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

The Git surface is explicit and typed. There is no generic untyped Git dispatcher.

## Public shadow acceptance

The isolated shadow deployment is served through the dedicated public Funnel on port `8443`; its machine-specific hostname is intentionally not recorded in repository evidence. The stable Funnel/connector remains separate and unchanged.

Using the official MCP client through the public shadow route with Dynamic Client Registration plus OAuth Authorization Code, PKCE and the MCP `resource` parameter:

- attacker Origin was rejected with HTTP `403`;
- an approved browser Origin without authentication reached the OAuth boundary and was rejected with `401`;
- `2025-03-26` negotiated successfully and exposed the exact 17-tool frozen contract;
- `2025-06-18` negotiated successfully and exposed the exact 17-tool frozen contract;
- `2025-11-25` negotiated successfully and exposed the exact 17-tool frozen contract;
- `2026-07-28` negotiated successfully and exposed the exact 17-tool frozen contract.

The actual MCP `tools/list` representation is canonical-contract equivalent to the generated Deployment Manifest (name, title, description, input schema and annotations).

## Native Windows and WSL acceptance

Dedicated shadow coding Workspaces on native Windows and WSL were used. Both environments independently passed:

- Workspace routing through the shadow Gateway;
- `git_status`;
- bounded repository discovery;
- contained worktree creation;
- status/read of the created worktree;
- contained worktree removal.

The native async execution contract also passed on both environments. `run(mode="async")` returned native process identity/acceptance metadata and explicitly discarded stdout/stderr. No Queqiao Job API, durable process registry or restart-recovery contract was introduced.

## Determinism and restart gate

The Deployment Manifest fingerprint is deterministic:

- generating the manifest from the final candidate config produced the frozen fingerprint above;
- reversing the Git contribution declaration order produced the same fingerprint after canonicalization;
- the actual public `tools/list` matched the canonical manifest;
- after a clean shadow Gateway restart, the fingerprint and exact 17-tool contract remained unchanged;
- after restart, all four supported MCP revisions negotiated successfully again;
- the two newer compatibility revisions (`2025-11-25` and `2026-07-28`) again executed Git calls through both native Windows and WSL Workers.

The final Windows shadow Gateway/Worker launch uses detached processes without redirected inherited stdout/stderr handles. This avoids retaining the invoking stable Worker process slot. The stable runtime did not require a restart during this correction.

## Stable recovery path

The stable Queqiao deployment was not upgraded, restarted or rebound during candidate deployment. Stable Gateway/Workers and the existing ChatGPT connector remain the recovery path.

The final handoff gate requires one more read-only stable connector `list_workspaces` probe after this evidence is committed. No stable connector mutation is part of the Shadow Connector procedure.

## Release gates

The final candidate source passed:

- `npm run typecheck`: PASS
- full suite: `30` test files / `115` tests PASS
- `npm run test:security`: `22` test files / `89` tests PASS
- `npm run test:cluster`: `4` test files / `15` tests PASS
- `npm audit --omit=dev --audit-level=moderate`: `0` vulnerabilities
- `npm run build:package`: PASS
- `git diff --check`: PASS

Expected adversarial stderr remains limited to intentionally invalid Worker-registry reload input and an intentionally unsupported future MCP revision; both tests pass and retain fail-closed behavior.

## Secret and runtime-state boundary

Shadow runtime configuration, secrets, process state, logs and dedicated validation Workspaces are external runtime material and are not committed to this repository. Repository evidence intentionally omits machine-local runtime paths, the Funnel hostname, OAuth secrets, Worker tokens and other machine-specific state.

## Manual boundary now reached

A second ChatGPT Shadow Connector has **not** been created yet and no final ChatGPT tool-registry binding acceptance is claimed by this document.

The next required manual step is to create a **new** Shadow Connector pointing at the already-validated shadow MCP endpoint. The existing stable connector must remain unchanged. After the new binding exists, the remaining acceptance is ChatGPT-specific: verify the bound 17-tool registry and execute bounded Core/Git calls through that connector without changing the frozen schema.
