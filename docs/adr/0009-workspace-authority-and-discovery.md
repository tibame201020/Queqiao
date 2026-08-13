# ADR-0009: Workspace is an authority boundary; discovery semantics belong outside Core

- Status: Accepted
- Date: 2026-08-13
- Refines: ADR-0006

## Context

The current CLI has repository-oriented discovery behavior that searches bounded roots for `.git` markers and presents repositories as Workspace candidates. That was useful for early coding-agent ergonomics, but it conflates two distinct concepts.

A Queqiao Workspace determines filesystem/process authority. A Git repository or worktree describes project/version-control structure inside an already authorized filesystem boundary. Treating repository discovery as Workspace identity makes future Git/project extensions harder to compose and risks turning discovery into an implicit authority grant.

ADR-0006 remains correct that bounded, shell-free list/search primitives belong in Core. The semantic interpretation of filesystem markers now needs a clearer owner.

## Decision

### Workspace authority

A Workspace is an explicit administrative authority boundary. It may contain ordinary files, zero repositories, one repository, or multiple repositories.

Workspace creation/approval is independent from `.git` or any other project marker. Discovery roots are read-only search scopes, not authorization grants.

The current local use of broad coding Workspaces is an explicit owner choice and is not a secure product default to generalize automatically.

### Repository and worktree identity

Repository and Worktree are Git-extension domain resources, not Core Workspace identities.

A Git extension may discover repositories/worktrees only inside an already authorized Workspace using Core capability APIs. Creating a worktree through Queqiao must not create new filesystem authority: every target must remain inside the selected Workspace boundary.

External worktree roots are out of scope for this milestone.

### Core discovery boundary

Core owns safe bounded primitives and containment, including list/read/search/path resolution and other authority-bearing filesystem/process capabilities.

Core does not assign project meaning to markers such as:

- `.git`;
- `AGENTS.md`;
- `CLAUDE.md`;
- `SKILL.md`;
- `package.json`;
- `pom.xml`;
- framework/build metadata.

Git, project-context, skills, or framework discovery semantics belong to extensions or clients that compose the bounded Core primitives.

Discovery must remain read-only, depth/resource bounded, avoid following symlinks across authority boundaries, and skip sensitive/generated locations according to the primitive's contract.

### Migration

The existing Git-coupled `workspace discover`/approval behavior must be audited and redesigned or deprecated. Migration must preserve existing explicit authority and must never silently broaden a configured Workspace root.

Compatibility/deprecation behavior is defined by the dedicated Workspace authority migration tickets and tests.

## Consequences

- Non-Git directories are first-class valid Workspaces when explicitly authorized.
- One broad Workspace can support multiple repositories without proliferating Core Workspace identities.
- Git/worktree ergonomics can evolve as an extension without adding Git semantics to Core security policy.
- Bounded list/search behavior from ADR-0006 remains Core functionality; only project interpretation moves out of Core.
- A discovered repository candidate never becomes authority merely because it was found.
