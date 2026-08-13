# Git Contained Worktree Lifecycle and Security Gate �X 2026-08-13

## Worktree lifecycle

`git_worktree_create` and `git_worktree_remove` are Worker-hosted typed extension tools. They do not create, remove, widen, or otherwise mutate Queqiao Workspace authority records.

Creation requires Core read/write/execute capabilities. The requested target is resolved by the authoritative Workspace layer as a new directory target whose existing parent is canonical, inside the Workspace, and free of symbolic-link/junction components. Native Git creates the worktree only after this check.

After creation, the new worktree is re-identified through Git and its top-level/Git-dir/common-dir are contained again. Its common-dir must match the selected source repository. A validation failure triggers a best-effort native worktree rollback and no Queqiao authority state is created.

Removal first resolves both source and target as contained repositories/worktrees and requires the same Git common-dir before native removal.

## Adversarial acceptance

Real native Git/Worker tests prove rejection of:

- `../` traversal outside the Workspace;
- symbolic-link/junction repository paths;
- a worktree located inside the Workspace whose Git common-dir belongs to a repository outside the Workspace;
- worktree creation outside the Workspace;
- worktree creation below a symbolic-link/junction parent;
- removal of an externally-backed worktree;
- editor profile execution even when `git` appears in command allow policy;
- coding profile execution when `git` is absent from command allow policy.

A syntactically valid but nonexistent Git ref fails native worktree creation and leaves no target directory. No Workspace config/state is created in either success or failure cases.

## Diagnostics / activation

Git-specific regression coverage proves:

- enabled Git contribution => 17 public tools (10 Core + 7 Git);
- disabled Git contribution => 10 Core public tools;
- Workspace-scoped Git activation retains the same Deployment Manifest/fingerprint while invocation eligibility differs by selected Workspace;
- actual official-MCP `tools/list` equals the canonical Deployment Manifest when enabled.

This preserves the architecture rule that deployment contract identity is separate from per-Workspace authority and activation decisions.

## Current gate results

Before these evidence files were written, the implementation passed:

- `npm run typecheck`;
- full suite: 30 files / 114 tests;
- security suite: 22 files / 88 tests;
- cluster suite: 4 files / 15 tests;
- package build.

The final pre-commit security/release gate is rerun after this evidence is added. Native WSL/Linux Git lifecycle acceptance remains a required shadow-runtime gate and is not claimed by this local Windows evidence.
