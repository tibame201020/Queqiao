# CLI flows

This page documents the production command sequences. It intentionally does not embed the retired 2026-08-20 flow GIFs: those recordings predate the current selector, Workspace authority, Extension Hub, Access Profile, and TUI contracts.

A flow GIF may be added here only when it is captured from a real packaged CLI transcript using isolated synthetic runtime state. Component animations belong in [CLI components](../components/README.md) instead.

## 1. Configure Gateway and Worker roles

```text
queqiao gateway setup
queqiao worker setup
```

`gateway setup` and `worker setup` remain independent role primitives. Worker setup creates the first Workspace authority as part of making the Worker valid; there is no persisted default Workspace.

## 2. Add or replace Workspace authority

```text
queqiao worker workspace add [--worker <worker>]
queqiao worker workspace profile set [--worker <worker>] [--workspace <id>]
```

Interactive setup starts with an Access Profile choice: built-in `Reader`, built-in `Editor`, saved profiles, or `Custom`. Custom access is the explicit Tools × Commands matrix.

Additional Workspace inspection/removal:

```text
queqiao worker workspace list [--worker <worker>]
queqiao worker workspace permissions show [--worker <worker>] [--workspace <id>]
queqiao worker workspace remove [--worker <worker>] --id <id>
```

## 3. Start runtimes and enroll the Worker

```text
queqiao worker serve [--worker <worker>] --bg
queqiao gateway serve [--gateway <gateway>] --bg
queqiao gateway join-token [--gateway <gateway>]
queqiao worker join [--worker <worker>]
```

Starting processes and creating Gateway membership are separate operations. Join material is one-time enrollment data and must never be published in screenshots/GIFs.

## 4. Manage Extensions

```text
queqiao extension install <npm:package|local-path> [--worker <worker>|--attach-all]
queqiao extension attach [<id>] [--worker <worker>]
queqiao extension detach [<id>] [--worker <worker>]
queqiao extension show [<id>]
queqiao extension uninstall [<id>] [--force]
queqiao doctor extension
```

The Extension Hub owns installed package/source inventory. Worker attachment is separate execution intent and does not automatically broaden Workspace authority.

## 5. Verify the deployment

```text
queqiao gateway status [--gateway <gateway>]
queqiao worker status [--worker <worker>]
queqiao gateway workers list [--gateway <gateway>]
queqiao worker workspace list [--worker <worker>]
queqiao worker workspace permissions show [--worker <worker>] [--workspace <id>]
queqiao doctor manifest show [--gateway <gateway>]
```

For interactive TTY commands, omitted Gateway/Worker selectors resolve according to the implemented selector grammar: zero instances fail, one instance auto-selects, and multiple instances open the selector. Non-TTY and JSON modes require explicit selectors and do not prompt.

## Recording gate for future flow GIFs

A flow GIF is publishable only when all of these hold:

1. The command sequence ran against a real packed/installable Queqiao artifact.
2. The command/help grammar matches the checked-in production CLI.
3. Runtime/config state is isolated and synthetic.
4. Join codes, OAuth material, credentials, PIDs, real user paths, public endpoints, and other machine-specific identifiers are absent or deterministically redacted.
5. The animation does not synthesize a success result that the command did not produce.
6. The asset is legible at normal GitHub documentation width.
