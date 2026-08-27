# ADR-0012: Extension Hub owns packages; Workers attach and execute them

Status: Accepted for the Core Manifest Revision 7 candidate

## Context

Queqiao needs externally distributed TypeScript extensions without making the public MCP manifest change whenever an extension is installed or removed. Queqiao also supports multiple native Workers, including Windows and WSL/Linux, so extension execution must preserve the existing native execution and Worker-authoritative security boundary.

ADR-0008 established deterministic extension composition. This ADR supersedes only its configuration-level enabled/disabled lifecycle model for installed extensions.

## Decision

Queqiao separates three responsibilities:

1. **Gateway** — owns public MCP exposure and routing. It does not host extension execution.
2. **Worker** — owns native extension execution and remains authoritative for Workspace/profile/tool/process policy.
3. **Extension Hub** — an environment-local package/control plane. It stores validated extension packages, versions, integrity metadata, and package entry points. It is not a daemon and is never an invocation hop.

An extension has only two persistent lifecycle facts:

- **installed** in the local Extension Hub;
- **attached** to a Worker.

Attachment is execution intent. There is no separate enabled/disabled state. Detaching removes the Worker registration.

A running Worker hot-reloads attachment changes from its role-local `config.yaml`. Reload is generation-based: the next ExtensionHost is parsed, imported, composition-validated, and fully loaded before an atomic swap. A rejected candidate leaves the last-known-good generation active. Each request leases one generation for its entire lifetime; a retired generation is disposed only after its final request lease ends. Extension modules may expose an optional `dispose()` lifecycle hook for connection pools, downstream MCP sessions, timers, and child resources.

Windows and WSL/Linux use separate environment-local Hubs. Multiple Workers in one native environment may attach to the same Hub package copy. Cross-OS package sharing is intentionally not required.

The CLI surface is:

```text
queqiao extension install npm:<package>
queqiao extension install npm:<package> --worker <name>
queqiao extension install npm:<package> --attach-all
queqiao extension attach <id> --worker <name>
queqiao extension detach <id> --worker <name>
queqiao extension list
queqiao extension show <id>
queqiao extension doctor
queqiao extension uninstall <id>
queqiao extension uninstall <id> --force
```

`install --worker` is a convenience for install followed by attach. `--attach-all` attaches every compatible named Worker discoverable in the current native environment. `uninstall` fails while any Worker remains attached; `--force` detaches all such Workers before removing the managed package.

Registry npm installs run with lifecycle scripts disabled. Package metadata, extension manifest identity/version, entry-point containment, and host compatibility are validated before the Hub is committed.

## Stable public proxy

Core Manifest Revision 7 adds one fixed public `extension` proxy tool. Its operations are stable discovery/call verbs routed to the selected Worker. Installing or removing a proxy-mode extension does not change the public Core manifest and therefore does not require another connector schema migration.

Direct public-tool extension contributions remain a separate advanced composition mechanism and may change the Deployment Manifest Fingerprint.

## Security consequences

- The Gateway still performs no native Workspace or extension execution.
- The Hub grants no Workspace or process authority.
- Every extension invocation executes through the Worker authority envelope.
- Extension package installation does not execute npm lifecycle scripts.
- Managed uninstall refuses to delete paths outside the Hub package directory.
- Explicit `QUEQIAO_*` layout overrides disable named-runtime discovery because an unambiguous `--attach-all` target set cannot be inferred safely.
