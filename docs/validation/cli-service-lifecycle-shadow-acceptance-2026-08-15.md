# Historical CLI service-lifecycle Shadow acceptance — superseded

**Status: SUPERSEDED**

This file records an earlier Stage A experiment that used OS-managed service/autostart concepts (`service install`, `--instance`, Windows Run-key launchers, and `systemd --user`). That design was rejected during subsequent CLI dogfood and is not the current Queqiao lifecycle contract.

The current contract is explicit role lifecycle with named role-local layouts:

```text
queqiao gateway serve --name <gateway> [--bg]
queqiao gateway stop --name <gateway>
queqiao gateway status --name <gateway>
queqiao worker serve --name <worker> [--bg]
queqiao worker stop --name <worker>
queqiao worker status --name <worker>
```

Queqiao does not install or manage OS autostart, Windows Run keys, administrator services, or systemd units. See `cli-lifecycle-enrollment-shadow-acceptance-2026-08-19.md` for the current acceptance record.
