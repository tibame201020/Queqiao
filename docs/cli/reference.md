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

## Gateway

```text
queqiao gateway setup
queqiao gateway list
queqiao gateway serve [--gateway <gateway>] [--bg]
queqiao gateway stop [--gateway <gateway>]
queqiao gateway status [--gateway <gateway>]
queqiao gateway remove [--gateway <gateway>]
queqiao gateway join-token [--gateway <gateway>] [--expires <seconds>] [--json]
queqiao gateway workers list [--gateway <gateway>]
queqiao gateway workers update [--gateway <gateway>] --worker-id <id> --endpoint <loopback-worker-url>
queqiao gateway workers remove [--gateway <gateway>] --worker-id <id>
```

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

queqiao worker workspace add [--worker <worker>] [--root <path>] [--display-name <name>] [--profile <profile>]
queqiao worker workspace list [--worker <worker>]
queqiao worker workspace remove [--worker <worker>] --id <id>
queqiao worker workspace profile set [--worker <worker>] [--workspace <id>] [--profile read-only|editor|coding]
queqiao worker workspace tool allow|deny [--worker <worker>] --workspace <id> --tool <tool>
queqiao worker workspace command allow|deny [--worker <worker>] --workspace <id> --command <executable>
queqiao worker workspace permissions show [--worker <worker>] [--workspace <id>]
```

Interactive `worker setup`, `worker workspace add`, and interactive Workspace access updates
share the same Access Profile flow. See [Workspace authority](../workspace-authority.md).

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
