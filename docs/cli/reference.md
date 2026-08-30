# Queqiao CLI Reference

This page is the command reference for the production `queqiao` CLI. The root README keeps
the first-deployment workflow short; this page carries the full command surface and scripting
rules.

## Global commands and options

```text
queqiao version
queqiao --version
queqiao -v
```

`--json` selects machine-readable output where a command supports it. `version --json` and
`--version --json` return `{ "schemaVersion": "1.0", "version": "..." }`.

## Shell completion

```text
queqiao completion bash
queqiao completion zsh
queqiao completion powershell
```

Each command prints a native shell adapter generated from `CLI_LEAF_CONTRACTS`, so the
completion hierarchy and flags are validated against the same canonical parser contract as the
CLI. Typical profile setup:

```powershell
queqiao completion powershell | Out-String | Invoke-Expression
```

```bash
eval "$(queqiao completion bash)"
```

```zsh
eval "$(queqiao completion zsh)"
```

Completion provides the canonical command and flag hierarchy. Value completion for runtime entities
such as `--gateway`, `--worker`, Workspace ids, and Extension ids is intentionally not queried from
the runtime by the completion adapter.
## Gateway

```text
queqiao gateway setup
queqiao gateway list
queqiao gateway serve [--gateway <gateway>] [--bg]
queqiao gateway stop [--gateway <gateway>]
queqiao gateway status [--gateway <gateway>]
queqiao gateway info [--gateway <gateway>] [--detail] [--copy-url|--copy-secret]
queqiao gateway remove [--gateway <gateway>]
queqiao gateway join-token [--gateway <gateway>] [--expires <seconds>] [--json]
queqiao gateway workers list [--gateway <gateway>]
queqiao gateway workers update [--gateway <gateway>] --worker-id <id> --endpoint <loopback-worker-url>
queqiao gateway workers remove [--gateway <gateway>] --worker-id <id>
```

`gateway info` is the connector handoff command. The default view shows the MCP URL and approval-secret availability without revealing the secret. `--detail` explicitly reveals the local approval secret and Gateway metadata; do not paste that output into logs or issues. `--copy-url` and `--copy-secret` copy exactly one value without echoing it.

## Worker and Workspace authority

```text
queqiao worker setup
queqiao worker list
queqiao worker port [--worker <worker>] [--port <port>]
queqiao worker serve [--worker <worker>] [--bg]
queqiao worker stop [--worker <worker>]
queqiao worker status [--worker <worker>]
queqiao worker remove [--worker <worker>]
queqiao worker join [--worker <worker>] [--join-code <code>]

queqiao worker workspace
queqiao worker workspace add [--worker <worker>] [--root <path>] [--display-name <name>] [--access-profile <name>]
queqiao worker workspace list [--worker <worker>]
queqiao worker workspace info [--worker <worker>] [--workspace <id>]
queqiao worker workspace edit [--worker <worker>] [--workspace <id>] [--root <path>] [--display-name <name>] [--access-profile <name>]
queqiao worker workspace remove [--worker <worker>] [--workspace <id>]

queqiao worker workspace profiles list
queqiao worker workspace profiles info [--profile <name>]
queqiao worker workspace profiles create [--name <name>] [--tools <csv>] [--commands <csv>]
queqiao worker workspace profiles edit [--profile <name>] [--tools <csv>] [--commands <csv>]
queqiao worker workspace profiles rename [--profile <name>] [--to <name>]
queqiao worker workspace profiles delete [--profile <name>] [--force]
```

Running `queqiao worker workspace` in a TTY opens Workspace Management. Choose **Workspaces** to
select a Worker and manage its authorized roots, or choose **Access profiles** to manage reusable
Tools ? executable-allowlist templates. `Reader` and `Editor` are built-in immutable profiles.

Access Profiles are templates, not live links. Applying one copies its policy into a Workspace.
Subsequent profile edit, rename, or delete operations report zero affected Workspaces and do not
mutate existing Workspace authority. `workspace edit --access-profile <name>` explicitly reapplies
a profile when that is desired.

Workspace ids remain implementation-managed. Interactive management identifies Workspaces by
display name and root; automation may pass the id returned by `workspace list` or `workspace info`.
Exact canonical duplicate roots are rejected while nested roots remain valid for narrower policies.
A configured Worker must retain at least one Workspace. See [Workspace authority](../workspace-authority.md).

## Extensions

```text
queqiao extension install <npm:package|local-path> [--worker <name>|--attach-all]
queqiao extension attach [<id>] [--worker <name>]
queqiao extension detach [<id>] [--worker <name>]
queqiao extension uninstall [<id>] [--force]
queqiao extension list
queqiao extension show [<id>]
```

TTY mode may select an installed Extension interactively when the optional `<id>` is omitted.
Automation should provide explicit identifiers. See [Extensions](../extensions.md).

## Diagnostics

```text
queqiao doctor
queqiao doctor extension
queqiao doctor manifest show [--gateway <name>]
queqiao doctor tool explain <tool> [--gateway <name>]
queqiao doctor paths
```

`doctor` scans named Gateways, Workers, and Extension Hub integrity. Manifest/tool composition
is Gateway-owned, so those diagnostics target a Gateway.

## Cleanup and migration

```text
queqiao uninstall
queqiao migrate from-repo --repo <path> [--execute]
queqiao migrate runtime-v1 [--execute]
```

Migration commands default to dry-run behavior where supported. Review the plan before using
`--execute`.

## Selector contract

Commands whose usage shows `[--gateway <gateway>]` or `[--worker <worker>]` follow one rule:

- zero configured instances: fail with setup guidance;
- one configured instance in a TTY: auto-select it;
- multiple configured instances in a TTY: open the shared selector;
- non-TTY or JSON automation: require an explicit selector when ambiguity exists.

Queqiao never silently targets a persisted `default` instance. Use `gateway list` or
`worker list` to discover valid names.

## Removed public forms

The old flat Workspace/Profile/Tool/Command routes and the old `--name` role selector are not
part of the production surface. The CLI reports the canonical replacement when it can do so
unambiguously. Repository/project discovery also does not live at the Core CLI root; it
belongs to clients or Extensions operating inside an already-authorized Workspace.

## Help

Every command group supports contextual help:

```shell
queqiao --help
queqiao gateway --help
queqiao worker workspace --help
queqiao extension --help
queqiao doctor --help
```
