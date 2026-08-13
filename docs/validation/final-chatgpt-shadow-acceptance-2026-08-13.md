# Queqiao Shadow Final ChatGPT Acceptance

Date: 2026-08-13

Overall: **PASS**

Release recommendation: **ACCEPT**

This document records the final ChatGPT connector acceptance result supplied after executing the frozen `Queqiao Shadow` production-acceptance prompt. The acceptance was performed against the frozen candidate connector without using the stable `Queqiao Revision`, other MCP/coding connectors, terminal, computer-use, or Refresh Tools.

## Frozen contract

| Item | Expected | Observed | Result |
| --- | --- | --- | --- |
| Core Manifest Revision | `6` | `6` | PASS |
| Deployment Manifest Fingerprint | `sha256:68eac0d73d8efea95cfde694b33d44220049fb6180b60657b3d8b6ee0a9d59ad` | exact match | PASS |
| Public tool count | `17` | `17` | PASS |
| Worker Protocol | `2.0` | `2.0` | PASS |
| MCP revisions | four frozen revisions | exact same set | PASS |
| Schema drift | none | none detected | PASS |

Observed MCP revision set:

- `2025-03-26`
- `2025-06-18`
- `2025-11-25`
- `2026-07-28`

Observed public tools, exactly 17:

- `workspace_info`
- `list_workspaces`
- `open_workspace`
- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `search_text`
- `run`
- `shell`
- `git_repositories`
- `git_status`
- `git_diff`
- `git_log`
- `git_branches`
- `git_worktree_create`
- `git_worktree_remove`

Schema-specific checks:

- `workspace_info.workspaceId` optional: present
- `run.mode`: `sync | async`
- `shell.mode`: `sync | async`
- Git interface: exactly seven typed tools
- generic `git(args)` dispatcher: absent

## Windows acceptance

Workspace: `shadow-win-git`

- explicit `workspace_info`: PASS; `environmentId=windows`, requested Workspace preserved.
- Workspace discovery/open: PASS; native Windows Shadow fixture selected.
- filesystem: PASS; `README.md` returned `shadow windows candidate`; literal search matched Windows fixture.
- write/edit: PASS; `chatgpt-shadow-validation.txt` progressed from `stage=write` to `stage=edited` with read-back verification.
- sync `run`: PASS; allowlisted `node.exe`; `process.platform=win32`; `exitCode=0`; bounded execution metadata returned.
- async `run`: PASS; native PID returned (`94576` in this acceptance run), `startedAt`, `timeoutMs=10000`, `stdout="discarded"`, `stderr="discarded"`.
- shell authority: PASS; both sync and async rejected with `shell requires explicit workspace allow policy`.
- Git read tools: PASS; repository at `.`, branch `master`; `git_status`, `git_diff`, `git_log`, `git_branches` succeeded; baseline commit subject `shadow baseline`.
- worktree lifecycle: PASS; contained test worktree `worktrees/chatgpt-final-win-20260813-1546` created, discovered, removed, and absence verified.
- authority negatives: PASS; filesystem traversal, Git repository traversal, outside worktree target, and non-allowlisted `python` all rejected.

## WSL acceptance

Workspace: `shadow-wsl-git`

- explicit `workspace_info`: PASS; `environmentId=wsl`, requested Workspace preserved.
- Workspace discovery/open: PASS; native WSL Shadow fixture selected.
- filesystem: PASS; `README.md` returned `shadow wsl candidate`; literal search matched WSL fixture.
- write/edit: PASS; `chatgpt-shadow-validation.txt` progressed from `stage=write` to `stage=edited` with read-back verification.
- sync `run`: PASS; allowlisted `node`; `process.platform=linux`; `exitCode=0`; bounded execution metadata returned.
- async `run`: PASS; native PID returned (`15130` in this acceptance run), `startedAt`, `timeoutMs=10000`, `stdout="discarded"`, `stderr="discarded"`.
- shell authority: PASS; both sync and async rejected by explicit-shell policy.
- Git read tools: PASS; repository at `.`, branch `master`; all four typed read operations succeeded; baseline commit subject `shadow baseline`.
- worktree lifecycle: PASS; contained test worktree `worktrees/chatgpt-final-wsl-20260813-1546` created, discovered, removed, and absence verified.
- authority negatives: PASS; filesystem traversal, Git repository traversal, external worktree target, and non-allowlisted `python` all rejected.

## Security acceptance

| Security property | Result | Evidence |
| --- | --- | --- |
| Workspace isolation | PASS | Explicit Windows/WSL routing returned distinct native environments and roots |
| Path containment | PASS | `../outside.txt` rejected on both OSes |
| Command policy | PASS | Node permitted; Python rejected on both OSes |
| Shell policy | PASS | sync and async rejected without explicit allow |
| Git authority containment | PASS | `repositoryPath=".."` rejected |
| Worktree containment | PASS | `targetPath="../..."` rejected |
| Extension cannot broaden Core authority | PASS | Git path authority remained bounded by Workspace containment |
| Cross-environment consistency | PASS | Same security semantics on Windows and WSL |

No sensitive personal files were read.

## OAuth persistence

Result: **PASS**

After the full invocation sequence, the following calls were repeated successfully:

- `list_workspaces`
- `workspace_info(shadow-win-git)`
- `workspace_info(shadow-wsl-git)`
- Windows `git_status`
- WSL `git_status`

Both explicit `workspace_info` results continued to expose `oauthScopes=["queqiao:access"]`.

Observed during acceptance:

- no connector recreation
- no authentication interruption
- no visible reauthentication requirement
- no OAuth/session failure
- final `list_workspaces()` returned the same frozen deployment attestation

## 17-tool invocation matrix

| Tool | Invoked | Environment | Result | Evidence |
| --- | --- | --- | --- | --- |
| `workspace_info` | Yes | Windows + WSL + default | PASS | explicit IDs routed correctly; omission resolved deployment default |
| `list_workspaces` | Yes | deployment | PASS | exact frozen attestation; both environments online |
| `open_workspace` | Yes | Windows + WSL | PASS | distinct native roots |
| `read_file` | Yes | Windows + WSL | PASS | Shadow README fixtures and validation files read |
| `write_file` | Yes | Windows + WSL | PASS | validation files written |
| `edit_file` | Yes | Windows + WSL | PASS | `stage=write` replaced by `stage=edited` |
| `list_directory` | Yes | Windows + WSL | PASS | fixture, validation, and worktree entries observed |
| `search_text` | Yes | Windows + WSL | PASS | OS-specific fixture strings found |
| `run` | Yes | Windows + WSL | PASS | sync native platform, async native PID, Python negative |
| `shell` | Yes | Windows + WSL | PASS | sync/async correctly policy denied |
| `git_repositories` | Yes | Windows + WSL | PASS | contained repositories/worktrees discovered |
| `git_status` | Yes | Windows + WSL | PASS | porcelain-v2 results bound to specified repository |
| `git_diff` | Yes | Windows + WSL | PASS | bounded tracked diff |
| `git_log` | Yes | Windows + WSL | PASS | native baseline commits returned |
| `git_branches` | Yes | Windows + WSL | PASS | bounded local branches returned |
| `git_worktree_create` | Yes | Windows + WSL | PASS | contained worktrees created; outside-target negative rejected |
| `git_worktree_remove` | Yes | Windows + WSL | PASS | both test worktrees removed and absence verified |

All **17 / 17** frozen public tools received real invocations.

## Failure summary

- functional: none
- schema drift: none
- deployment attestation: none
- OAuth: none
- security: none
- OS inconsistency: none
- missing tool validation: none
- `mcp_network_error`: none

The generated `chatgpt-shadow-validation.txt` files remain inside the two explicitly authorized Shadow test repositories as untracked validation artifacts. This does not affect the acceptance result.

## Release decision

**ACCEPT**

The previously blocking explicit WSL `workspace_info` routing issue is resolved. The frozen candidate binding was independently attested by live tool results; all 17 public tools were exercised; Windows/WSL security semantics were consistent; containment negatives succeeded; and OAuth/session state persisted through the full acceptance sequence.

This closes the external `New-manifest ChatGPT acceptance` release gate for the frozen Secure Agent Substrate candidate.
