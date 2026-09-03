# Queqiao Operations

This guide covers runtime lifecycle, enrollment, local state, cleanup, and migration. It is
operator documentation; the root README intentionally keeps only the first-deployment path.

## Runtime lifecycle

Installing `@tibame201020/queqiao` does not create an OS service, autostart entry, Windows Run
key, or systemd unit. Gateway and Worker lifecycle is explicit:

```shell
queqiao worker serve --worker <worker> --bg
queqiao worker status --worker <worker>
queqiao worker stop --worker <worker>

queqiao gateway serve --gateway <gateway> --bg
queqiao gateway status --gateway <gateway>
queqiao gateway stop --gateway <gateway>
```

`--bg` means a Queqiao-managed background process, not an installed service.

## Connector handoff

After Gateway setup, retrieve the values needed to create an MCP client connector:

```shell
queqiao gateway info --gateway <gateway>
queqiao gateway info --gateway <gateway> --detail
queqiao gateway info --gateway <gateway> --copy-url
queqiao gateway info --gateway <gateway> --copy-secret
```

The MCP URL is derived from the configured public Gateway URL. The approval secret stays in the
Gateway's private runtime secret file. The default command reports availability without revealing
the secret; `--detail` is an explicit local reveal and the copy flags avoid printing copied values.

In ChatGPT, a public MCP schema migration is applied with the connector/app **Refresh** action, then verified from a new conversation because an already-open conversation can retain its prior tool-schema snapshot. **Reconnect** re-establishes the connection/OAuth lifecycle but does not replace schema discovery. Reinstalling the same app can also reuse cached tool metadata; prefer Refresh before considering connector recreation.
## Enrollment and membership

Startup and enrollment are separate. For same-host HTTP, use the normal Gateway/Worker setup. For a cross-machine Worker, configure the Gateway once with a DNS name or IPv4 address that the Worker host can reach:

```shell
queqiao gateway setup --worker-session-host <gateway-lan-host-or-ip>
```

`--worker-session-port <port>` is optional; otherwise the Worker-session port derives from the Gateway port. Remote setup creates TLS material only in the Gateway runtime secrets area. Then start both roles, create a short-lived self-contained join code on the Gateway host, and join from the Worker host:

```shell
queqiao worker serve --worker <worker> --bg
queqiao gateway serve --gateway <gateway> --bg
queqiao gateway join-token --gateway <gateway>
queqiao worker join --worker <worker>
```

Human-mode `gateway join-token` copies the join code to the clipboard. Interactive `worker join` accepts it through a password-style prompt so the secret is not echoed. For remote transport the same join code also carries the Gateway Worker-session target and pinned certificate; the Worker initiates the TLS gRPC session before confirmation. Membership remains Gateway-owned state and is committed only after identity/protocol validation over the proposed transport succeeds.

See [Distribution & Cluster Baseline v1](distribution-cluster-baseline-v1.md) and [Security Baseline v3](security/security-baseline-v3-gate.md).

Inspect or manage membership with:

```shell
queqiao gateway workers list --gateway <gateway>
queqiao gateway workers update --gateway <gateway> --worker-id <id> --endpoint http://127.0.0.1:<port>/
queqiao gateway workers remove --gateway <gateway> --worker-id <id>
```

## Runtime paths

```shell
queqiao doctor paths
```

On Windows, named Gateway and Worker layouts live below:

```text
%LOCALAPPDATA%\Queqiao\gateways\<name>
%LOCALAPPDATA%\Queqiao\workers\<name>
```

Linux/WSL use role-scoped XDG paths. Secrets are stored separately from `config.yaml` and
machine-specific paths are not required inside the source checkout.

## Worker listener changes

Worker HTTP/local-control listeners remain loopback-only. Remote Workers use an outbound TLS gRPC session and therefore do not require an inbound LAN Worker port. For loopback-HTTP memberships, to change a Worker port, stop that Worker first, change the configured port, restart it, then update Gateway
membership if the Gateway-visible endpoint changed:

```shell
queqiao worker stop --worker <worker>
queqiao worker port --worker <worker> --port <port>
queqiao worker serve --worker <worker> --bg
queqiao gateway workers update --gateway <gateway> --worker-id <id> --endpoint http://127.0.0.1:<port>/
```

Within one Gateway membership registry, each Gateway-visible Worker endpoint must be unique.

## Workspace and Extension hot reload

A configured Worker always owns at least one Workspace. `queqiao workspace` provides the
interactive management surface; automation uses `workspace add/list/info/edit/remove`. Workspace
access changes remain Worker-owned and are atomically validated. Access Profiles are reusable
templates: applying one copies policy into a Workspace, while later profile edit/rename/delete does
not mutate existing Workspaces. Workspace and Extension attachment configuration is validated before
generation replacement; a rejected update leaves the last-known-good runtime generation active.

See [Workspace authority](workspace-authority.md) and [Extensions](extensions.md).

## Remove local instances

```shell
queqiao gateway remove --gateway <gateway>
queqiao worker remove --worker <worker>
```

Removal is interactive/destructive, refuses to remove a running instance, and uses the same
named-instance model as the rest of the CLI.

## Uninstall

```shell
queqiao uninstall
```

`queqiao uninstall` is intentionally interactive. It first presents Queqiao-owned local
cleanup targets such as named Gateway/Worker state and the Extension Hub. A separate final
prompt asks whether the global npm package should also be removed. There is no `--yes` bypass.

Direct `npm uninstall --global @tibame201020/queqiao` removes the package but cannot guarantee
runtime/config cleanup. Explicit `QUEQIAO_*` override directories are not recursively deleted
because they may point to user-owned locations.

## Migrate older layouts

Preview migration before execution:

```shell
queqiao migrate from-repo --repo <path>
queqiao migrate from-repo --repo <path> --execute

queqiao migrate runtime-v1
queqiao migrate runtime-v1 --execute
```

Migration is non-overwriting and should be reviewed before execution.

## Transport boundary

Same-host Worker HTTP remains loopback-only. Cross-host transport is Worker-initiated TLS gRPC/HTTP2 to a dedicated Gateway Worker-session listener. The public MCP/OAuth listener remains behind its existing Gateway exposure boundary; the Worker-session listener is separate and carries Worker Protocol traffic only.

Remote enrollment uses the same `qjq1:` flow. The join code bootstraps the Gateway session target and pinned certificate; after membership commit the Worker persists that trust locally and reconnects with bounded backoff if the Gateway is temporarily unavailable. See ADR-0013 and Security Baseline v3.
