# Workspace Authority Management

A Queqiao Workspace is an explicit filesystem/process **authority boundary**. It is not a Git repository identity and it is not created by resource discovery.

## Explicit authority operations

Create or add authority only with an explicit directory:

```text
queqiao workspace init --id <id> --root <directory>
queqiao workspace add --id <id> --root <directory>
queqiao workspace remove --id <id>
```

`workspace init` and `workspace add` canonicalize the selected existing directory and reject files or missing paths. A `.git` marker is neither required nor interpreted.

Existing Workspace roots are never widened because another directory, repository, project marker, or discovery result exists nearby.

## Deprecated repository-coupled commands

`workspace discover` and `workspace approve` are deprecated and no longer grant authority. They fail with guidance to use `workspace add` for an explicit authority grant.

Repository and worktree discovery belongs to the Git extension and operates only **inside** an already-authorized Workspace.

## Discovery roots

The retained `discovery list|add|remove` configuration is a read-only resource-search scope for clients/extensions that choose to use it. A discovery root is not an authority wildcard and never creates or broadens a Workspace.

## Hot reload

Workspace configuration is still written through the validated `AtomicConfigStore`. A successful atomic replacement is observable by the Worker Workspace catalog refresh path. Invalid replacements are rejected and the Worker retains the last good authority set.
