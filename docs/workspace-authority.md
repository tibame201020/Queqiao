# Workspace Authority Management

A Queqiao Workspace is an explicit filesystem/process **authority boundary**. It is not a Git repository identity and it is not created by resource discovery.

## Explicit authority operations

Create or add authority only with an explicit directory:

```text
queqiao worker workspace add --worker <worker> [--id <id>] [--root <directory>] [--name <display-name>] [--profile read-only|editor|coding]
queqiao worker workspace list --worker <worker>
queqiao worker workspace remove --worker <worker> --id <id>
```

`worker workspace add` canonicalizes the selected existing directory and rejects files or missing paths. A `.git` marker is neither required nor interpreted. The former `workspace init` command is removed; Worker setup creates identity/listener state only, and the first explicit `worker workspace add` establishes authority and becomes the default Workspace.
Existing Workspace roots are never widened because another directory, repository, project marker, or discovery result exists nearby.

## Removed repository-coupled commands

The former `workspace discover` and `workspace approve` commands are removed. Workspace authority is created only through explicit `worker workspace add` operations.

Repository and worktree discovery belongs to the Git extension and operates only **inside** an already-authorized Workspace.

## Domain discovery

Queqiao no longer keeps a generic discovery-root configuration. The old root list had no runtime consumer after repository-coupled Workspace discovery was retired, so retaining it only preserved dead state.

Repository, worktree, project, skill, and framework discovery belong to their owning extension/client and operate only inside an explicitly authorized Workspace using bounded Core filesystem primitives. Discovery never creates or broadens Workspace authority.

The named Worker's role-local `config.yaml` stores `worker`, `workspaces`, and attached `extensions` as sibling fields. That storage shape is not an ownership model: Workspaces, Workspace policy, and extension attachments remain Worker-owned. Gateway role-local configuration never grants Workspace authority.

## Hot reload

Workspace configuration is still written through the validated `AtomicConfigStore`. A successful atomic replacement is observable by the Worker Workspace catalog refresh path. Invalid replacements are rejected and the Worker retains the last good authority set.
