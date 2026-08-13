# First-Party Git Extension Read/Discovery �X 2026-08-13

## Scope

This evidence records the implementation and local acceptance of the first-party trusted local Git extension. Git repository/worktree identity is extension-owned resource semantics; Core Workspace identity remains an explicit filesystem/process authority boundary.

The extension is never enabled by repository content. It must be present in external runtime configuration as an explicitly enabled, trusted local module. The built-in package identifier is `@queqiao/extension-git`; the extension identity is `dev.queqiao.git` version `1.0.0`.

## Public contract

The extension contributes seven explicit public tools, not a generic `git(args)` dispatcher:

- `git_repositories`
- `git_status`
- `git_diff`
- `git_log`
- `git_branches`
- `git_worktree_create`
- `git_worktree_remove`

Each tool has a bounded typed input schema. Git ref/path/count inputs are length/count constrained, and ref values cannot begin with an option prefix.

With Core Manifest Revision 5 plus the enabled Git extension, the candidate Deployment Manifest contains 17 public tools. The pre-shadow deterministic fingerprint is:

`sha256:0376b8d3f82e705141defbd31f72f70195d8884275ce9f89d0ae94ebcce5b9df`

An official MCP client test proves the actual Gateway `tools/list` projection is canonical-contract equivalent to the generated Deployment Manifest, including name/title/description/input schema/annotations.

## Authority model

- Worker-hosted extension execution runs through the normal Worker `/v1/tools/:toolName` path.
- Per-Workspace extension composition remains behind the immutable Worker authority guard.
- Git execution uses the Core process capability with executable `git`; Workspace command policy must explicitly allow `git`.
- Read-oriented Git tools require execution capability and therefore remain unavailable in editor/read-only profiles.
- Extension activation supports global or explicit Workspace selection; Workspace scope changes invocation eligibility, not the frozen public manifest.
- An optional exact Worker environment host binding remains supported; a Worker host with no environment ID intentionally means all native Workers.

## Repository containment

Git repository identity is accepted only after native `git rev-parse` returns top-level, Git-dir, and common-dir paths and all three pass authoritative Worker containment. External common directories are rejected rather than disclosed.

`SafeWorkspace` gained stricter execution-path primitives that reject symbolic-link/junction components and verify realpath containment. Process execution working directories now use this strict path resolution generally, not a Git-only bypass.

Repository discovery is bounded by Workspace filesystem enumeration depth/limit. Invalid or externally-backed `.git` markers are omitted from discovery rather than exposing external metadata.

## Local native acceptance

A real native Git integration test creates a repository, commits content, and proves:

- bounded repository discovery;
- status;
- local branch listing;
- commit log;
- bounded diff;
- contained worktree creation/removal.

Gateway acceptance uses the official MCP SDK client and proves all seven named public schemas are discoverable and a named `git_status` call is forwarded to the Worker host.

Windows native Git acceptance is complete in this repository gate. Native WSL/Linux acceptance is intentionally performed later on the isolated shadow WSL Worker before the final public-manifest freeze is declared.
