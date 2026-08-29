# Queqiao

[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/@tibame201020/queqiao.svg)](https://www.npmjs.com/package/@tibame201020/queqiao)

Queqiao builds one secure bridge between AI clients and multiple coding environments.

The public MCP endpoint belongs to a lightweight Gateway. Windows, WSL, Linux, and
future remote environments each run their own Worker, so filesystem and process work
always executes inside the native environment.

## Quick CLI flow

Install Queqiao from npm:

```shell
npm install --global @tibame201020/queqiao
```

Create the Gateway, then create the Worker. Worker setup includes its first authorized
Workspace, so a configured Worker is immediately meaningful as a remote execution host:

```text
queqiao gateway setup
queqiao worker setup
```

Start both roles:

```text
queqiao gateway serve --name <gateway> --bg
queqiao worker serve --name <worker> --bg
```

Create one short-lived self-contained join code on the Gateway host, then join from the
Worker host. Human-mode `join-token` copies the join code to the clipboard automatically;
`worker join` securely prompts for it:

```text
queqiao gateway join-token --name <gateway>
queqiao worker join --name <worker>
```

Verify both runtimes and Gateway membership before connecting an MCP client:

```text
queqiao gateway status --name <gateway>
queqiao worker status --name <worker>
queqiao gateway workers list --name <gateway>
```

Additional Workspaces can be added or removed while the Worker is running. Workspace
configuration is hot-reloaded; a Worker must always retain at least one Workspace.

## Production architecture

- **Gateway** owns the public MCP endpoint, OAuth, stable tool schemas, routing, and
  worker health. It cannot read files or spawn workspace processes.
- **Worker** owns native execution and exposes only its environment-local Worker
  transport to the Gateway. The verified transport is loopback HTTP; Workers do not
  auto-register, maintain an idle registration connection, or expose a public MCP endpoint.
- **CLI** manages gateway, worker, workspace, tool, and command policy.
- **Protocol** contains versioned wire contracts and stable public tool names.
- **Security** owns identities, step-up challenges, approval grants, secret boundaries,
  and authentication adapters. OAuth is one adapter, not the security model itself.
- **Policy** is a pure authorization engine used by both Gateway and Worker.
- **Config** validates versioned configuration before it reaches a runtime module.
- **Tool runtime** registers bundled and optional typed tools through one
  transport-neutral extension contract with lifecycle sealing and interception hooks.
- **Workspace** provides bounded native filesystem primitives with containment and
  atomic mutation guarantees.

See [Architecture](docs/architecture.md) and the [architecture decisions](docs/adr/README.md).

## Project status

Queqiao is under active development. The **0.7.0** release baseline uses
**Core Manifest Revision 6** and **Worker Protocol 3.0**. Core exposes ten typed tools:
`workspace_info`, `list_workspaces`, `open_workspace`, `read_file`, `write_file`,
`edit_file`, `list_directory`, `search_text`, `run`, and `shell`. This release baseline also
enables the first-party Git extension with seven named typed tools, for a deterministic
17-tool public Deployment Manifest.

`workspace_info` may explicitly target a configured Workspace or use the deployment
default. `list_workspaces` includes a safe deployment-attestation projection containing
the Core Manifest Revision, Deployment Manifest Fingerprint, public tool count, Worker
Protocol Version, and bounded MCP compatibility window. OAuth still uses only the
`queqiao:access` handshake scope; Workspace profile/tool/command policy remains the
authority boundary.

`run` and `shell` support `mode: sync | async`. Async mode returns after native process
acceptance with a native PID and bounded lifetime while discarding stdout/stderr; it
does not introduce a Queqiao Job API, durable restart recovery, or tmux dependency.
Remote Streamable HTTP(S) MCP is the supported client transport. Queqiao currently pins
`2025-03-26`, `2025-06-18`, `2025-11-25`, and `2026-07-28` rather than inheriting an
unbounded SDK compatibility range.

### Validated MCP clients and runtime platforms

The 0.7.0 release candidate is client-neutral at the MCP boundary. Real-client validation
covers **ChatGPT**, **Claude Code 2.1.235**, and the MCP Inspector. Claude Code was
validated through remote HTTP discovery, Dynamic Client Registration, PKCE OAuth,
and a final `Connected` health check against the public Shadow deployment. Native OAuth
loopback redirects are accepted only when the corresponding loopback origin is explicitly
configured; exact redirect-URI binding remains enforced after registration.

Gateway and Worker runtimes are release-supported on **Windows** and **Linux**. WSL runs
the Linux Worker/runtime path rather than a Windows-specific Worker adapter. The packed
npm artifact is exercised by CI with a real Linux Gateway + Linux Worker authenticated
handshake. macOS is not a supported 0.7.0 lifecycle target; unsupported platforms fail
explicitly rather than silently using a Windows or Linux lifecycle implementation.

See the [0.7.0 interoperability acceptance](docs/validation/release-v0.7.0-interoperability-acceptance-2026-08-19.md).

The v0 public path was validated through ChatGPT on 2026-08-12. See the
[validation evidence](docs/validation/v0-chatgpt-2026-08-12.md).

Multiple configured workspaces were validated through the same public endpoint and
Windows Worker on 2026-08-12. See the
[multiple-workspaces evidence](docs/validation/multiple-workspaces-chatgpt-2026-08-12.md).

Native Windows and WSL Workers were validated through one connector and one Funnel on
2026-08-12. See the
[multi-environment evidence](docs/validation/multi-environment-chatgpt-2026-08-12.md).

Atomic CLI workspace updates and Worker hot reload were validated through the existing
connector without reconnecting on 2026-08-12. See the
[CLI hot-reload evidence](docs/validation/cli-workspace-hot-reload-chatgpt-2026-08-12.md).

Gateway environment registry hot reload and WSL-native CLI management were validated
through the existing connector without reconnecting on 2026-08-12. See the
[environment/WSL CLI evidence](docs/validation/cli-environment-wsl-chatgpt-2026-08-12.md).

Bidirectional tool permission hot reload was validated through the existing connector
without reconnecting on 2026-08-12. See the
[permission evidence](docs/validation/permission-hot-reload-chatgpt-2026-08-12.md).

The six-tool coding baseline, single OAuth handshake scope, atomic write, exact edit,
and readback loop were validated through ChatGPT on 2026-08-12. See the
[coding baseline evidence](docs/validation/coding-baseline-chatgpt-2026-08-12.md).

Manifest revision 2 is frozen. It adds the shell-free `run` tool without changing the
first six tool contracts. Native Windows and WSL execution, coding/editor profile
enforcement, command policy, and timeout termination were validated through ChatGPT.
See the [revision 2 evidence](docs/validation/run-manifest-v2-chatgpt-2026-08-12.md).

Manifest revision 3 is frozen. It appends
`list_directory` and `search_text` without changing the first seven contracts. Both
execute as bounded Worker-native primitives: no shell, no external command dependency,
no symlink traversal, and workspace policy remains authoritative. See the
[revision 3 evidence](docs/validation/filesystem-discovery-manifest-v3-chatgpt-2026-08-12.md).

Manifest revision 4 is frozen. It adds an explicit `shell` tool while keeping
the safer argv-only `run` contract unchanged. `shell` is fail-closed: it requires a
`coding` profile and an explicit workspace tool allow rule. Windows defaults to
PowerShell and may explicitly select cmd or Git Bash; Linux/WSL defaults to Bash. See
the [revision 4 evidence](docs/validation/native-shell-manifest-v4-chatgpt-2026-08-12.md).

Core Manifest Revision 5 introduced `mode: sync | async` on `run` and `shell` while
preserving bounded process policy and intentionally avoiding a durable Job abstraction. See
the [Revision 5 async evidence](docs/validation/core-manifest-revision-5-async-execution-2026-08-13.md).

Core Manifest Revision 6 makes `workspace_info` explicitly targetable by Workspace ID and
adds safe deployment attestation to `list_workspaces` without adding an eighteenth public
tool. See the [Revision 6 evidence](docs/validation/core-manifest-revision-6-workspace-attestation-2026-08-13.md).

Core Manifest Revision 7 introduced one fixed
public `extension` proxy tool plus an environment-local Extension Hub. Hub installation and
Worker attachment are separate: attachment itself means the Worker uses the extension, so
there is no additional enable/disable state. Proxy-mode extension changes do not mutate the
public Core schema after the Revision 7 connector migration. See
[ADR-0012](docs/adr/0012-extension-hub-and-worker-attachment.md) and the
[Revision 7 candidate evidence](docs/validation/core-manifest-revision-7-extension-platform-candidate-2026-08-27.md).

The current development candidate advances to **Core Manifest Revision 8**. Configured Workers own one or more peer Workspaces; there is no persisted default Workspace. Calls that omit `workspaceId` are resolved only when exactly one online Workspace is available; otherwise Queqiao returns `workspace_required`.

Security Baseline v1 is frozen. OAuth replay protection, MCP request budgets, sanitized
health reporting, fail-closed Worker routing, native policy enforcement, filesystem and
process containment, and the documented adversarial matrix are enforced by required
Windows/Linux GitHub checks. See the
[security gate](docs/security/security-baseline-v1-gate.md) and
[threat matrix](docs/security/security-baseline-v1-threat-matrix.md).

Resource Safety Baseline v1 separately keeps the long-running Core lightweight. Windows
and Linux GitHub Actions run the packed npm artifact and bound resident-memory overhead,
idle CPU/write churn, request-log amplification, residual growth, descriptors/threads,
and process cleanup. Core PID accounting is intentionally separate from explicitly
authorized child workloads. See the
[resource safety contract](docs/resource-safety-baseline-v1.md) and
[initial stable audit evidence](docs/validation/resource-safety-baseline-v1-2026-08-14.md).

## CLI baseline

The current management CLI supports:

```text
queqiao gateway setup
queqiao gateway serve --name <gateway> [--bg]
queqiao gateway stop --name <gateway>
queqiao gateway status --name <gateway>
queqiao gateway remove
queqiao gateway join-token --name <gateway> [--expires <seconds>] [--json]
queqiao gateway workers list --name <gateway>
queqiao gateway workers update --name <gateway> --worker-id <id> --endpoint <loopback-worker-url>
queqiao gateway workers remove --name <gateway> --worker-id <id>

queqiao worker setup
queqiao worker port --name <worker> [--port <port>]
queqiao worker serve --name <worker> [--bg]
queqiao worker stop --name <worker>
queqiao worker status --name <worker>
queqiao worker remove
queqiao worker join --name <worker>
queqiao worker workspace add --worker <worker>
queqiao worker workspace list --worker <worker>
queqiao worker workspace remove --worker <worker> --id <id>
queqiao worker workspace profile set --worker <worker> --workspace <id> --profile read-only|editor|coding
queqiao worker workspace tool allow|deny --worker <worker> --workspace <id> --tool <tool>
queqiao worker workspace command allow|deny --worker <worker> --workspace <id> --command <executable>
queqiao worker workspace permissions show --worker <worker> [--workspace <id>]

queqiao extension install npm:<package> [--worker <name>|--attach-all]
queqiao extension attach <id> --worker <name>
queqiao extension detach <id> --worker <name>
queqiao extension uninstall <id> [--force]
queqiao extension list
queqiao extension show <id>

queqiao doctor
queqiao doctor extension
queqiao doctor manifest show --gateway <name>
queqiao doctor tool explain <tool> --gateway <name>
queqiao doctor paths

queqiao uninstall
```

The previous flat command paths are removed from the public CLI surface. Use the hierarchical forms above. Obsolete repository-search discovery-root configuration has also been removed; repository/project discovery belongs to extensions or clients operating inside an explicitly authorized Workspace.

`queqiao doctor` scans the local named Gateways and Workers plus Extension Hub integrity. Manifest/tool composition diagnostics are Gateway-owned and therefore require `--gateway <name>`.

### External extension contract

External packages use the public SDK export from the published Queqiao package:

```ts
import { defineExtension } from "@tibame201020/queqiao/extension";

export default defineExtension({
  manifest: {
    id: "dev.example.extension",
    version: "1.0.0",
    displayName: "Example Extension",
  },
  activate(api) {
    // Register, extend, or replace typed tools through the public Extension API.
  },
  async dispose() {
    // Release sessions, timers, child resources, or other extension-owned state.
  },
});
```

The npm package must also declare Queqiao package metadata in `package.json`. `apiVersion` is currently `1`; `module` is a package-contained module path; the manifest declares Worker hosting, ordering, and contribution contracts:

```json
{
  "name": "example-queqiao-extension",
  "version": "1.0.0",
  "queqiao": {
    "apiVersion": 1,
    "module": "./dist/index.js",
    "manifest": {
      "id": "dev.example.extension",
      "version": "1.0.0",
      "displayName": "Example Extension",
      "host": { "kind": "worker" },
      "ordering": { "requires": [], "before": [], "after": [] },
      "contributions": []
    }
  }
}
```

Revision 7 Extension Hub installation accepts Worker-hosted registry npm packages only. Install runs with npm lifecycle scripts disabled and validates package metadata, manifest/version identity, entry-point containment, and Worker compatibility before committing the Hub entry. `install` changes package state only unless `--worker` or `--attach-all` is supplied. `attach` is the Worker activation state; there is no separate enable/disable lifecycle.

A running Worker hot-reloads attachment config generation-by-generation. A candidate ExtensionHost must load and validate before atomic replacement; rejected candidates preserve the last-known-good generation. In-flight requests retain the generation they started with, and retired extensions receive `dispose()` only after the final lease completes.

A configured Worker always owns at least one authorized Workspace. The first Workspace is
created during `worker setup`; additional Workspaces are managed with `worker workspace
add/remove` while the Worker is running. Generic discovery-root state has been removed;
repository/worktree/project discovery belongs to the owning extension or client and
operates only inside an already-authorized Workspace using bounded Core filesystem
primitives.

Configuration changes use an exclusive lock, validated temporary file, and atomic rename.
A running Worker hot-reloads Workspace and Extension attachment changes. A rejected update
leaves the last-known-good runtime generation active.

The same compiled CLI runs inside WSL with Linux-native XDG paths and explicit
`serve`/`stop` lifecycle. Queqiao does not require or install a systemd user service for
the Worker.

### First-time setup contract

The current CLI exposes independent Gateway and Worker role primitives:

```text
queqiao gateway setup
queqiao worker setup
queqiao gateway serve --name <gateway> --bg
queqiao worker serve --name <worker> --bg
queqiao gateway join-token --name <gateway>
queqiao worker join --name <worker>
```

`gateway setup` and `worker setup` are interactive create/edit flows. They first select an
existing named instance or Create new. Gateway setup asks for the Public Gateway URL,
Gateway port, and Management port. A new Worker setup asks for the Worker port and its
initial authorized Workspace. Workspace access is configured as an explicit tool allowlist;
when `run` is selected, setup additionally asks for a comma-separated executable allowlist.
That executable input keeps local history for Up/Down recall and shows the most recent entry
as the default. A Custom tools/commands matrix may optionally be saved after configuration
as a reusable Access Profile; existing Access Profiles can be selected directly on later
Worker setup flows. Editing a valid Worker preserves its existing Workspaces.
Legacy incomplete Workers can be repaired through the same setup flow without rotating
their identity or credential. New or changed local ports must be in range, must not collide
with another configured Queqiao instance, and must be available on loopback.

Human-mode `gateway join-token` creates a short-lived self-contained join code and copies
it to the clipboard automatically. `worker join` prompts securely for that code unless
`--join-code` is supplied for scripted use. Enrollment is separate from process startup;
`--bg` means a background process managed by Queqiao's explicit PID-aware lifecycle, not
an OS service, autostart entry, Run key, or systemd unit.
The mocked first-time setup flow and cross-platform Workspace-ID behavior are protected by
dedicated required GitHub checks on both Ubuntu and Windows:
`CLI setup flow (ubuntu-latest)` and `CLI setup flow (windows-latest)`. They run only after
the monorepo packages are typechecked/built, matching the dependency order required by the
workspace package graph.

## Runtime configuration

Queqiao never requires secrets or machine-specific paths inside the source checkout.
The bundled CLI reports the named-role configuration roots and Extension Hub location with:

```powershell
npm run queqiao -- doctor paths
```

Installed from npm, run each role's interactive setup to choose an existing named instance
or create a new one. Creating a Worker includes its initial authorized Workspace. Lifecycle
and management commands continue to address named instances explicitly:

```shell
npm install --global @tibame201020/queqiao
queqiao gateway setup
queqiao worker setup
queqiao gateway serve --name shadow --bg
queqiao worker serve --name windows --bg
queqiao gateway join-token --name shadow
queqiao worker join --name windows
```

Human-mode `gateway join-token` copies a versioned self-contained join code containing the
Gateway public base URL, one-time enrollment token, and expiry. Interactive `worker join`
accepts that single code. The join code is bearer-secret material used only for Worker CLI
to Gateway enrollment; it does not publish or authorize the Gateway-to-Worker runtime
transport.
Local instances can be removed with `queqiao gateway remove` or `queqiao worker remove`. Removal uses the same interactive instance-selection model as setup, requires confirmation, and refuses to delete a running instance.

Use `queqiao uninstall` for package cleanup. The command is always interactive. Its first phase shows a Space-toggle multi-select list of Queqiao-owned local cleanup targets that npm does not remove: discovered Gateway instances, Worker instances, and the Extension Hub. Each entry includes the actual local path(s) that will be removed. The normal named-role runtime model has no global Queqiao config or global Queqiao state root. After the selected local paths are reviewed and confirmed, Queqiao stops selected managed runtimes as needed and removes only those paths. A separate final prompt then asks whether to uninstall `@tibame201020/queqiao` from global npm; the npm package is not part of the cleanup multi-select. There is no `--yes` bypass. Direct `npm uninstall --global @tibame201020/queqiao` removes the package but cannot guarantee runtime/config cleanup because modern npm does not run package uninstall lifecycle hooks. Explicit `QUEQIAO_*` override directories are not recursively deleted by the cleanup command because they may point at user-owned locations outside Queqiao's standard roots.

The package is self-contained and exposes independent Gateway and Worker process roles. Installing it does not create an OS service, autostart entry, Run key, or systemd unit. Runtime lifecycle is explicit:

```shell
queqiao gateway serve --name shadow --bg
queqiao gateway status --name shadow
queqiao gateway stop --name shadow

queqiao worker serve --name windows --bg
queqiao worker status --name windows
queqiao worker stop --name windows
```

Worker listeners remain loopback-only. Within one Gateway membership registry, each Gateway-visible Worker transport endpoint must be unique. If a Worker listener port must change, stop that Worker first, run `queqiao worker port --name <worker> --port <port>`, restart it, then update the Gateway membership transport with `queqiao gateway workers update --name <gateway> --worker-id <id> --endpoint http://127.0.0.1:<port>/`.

On Windows, named Gateway and Worker layouts are stored below `%LOCALAPPDATA%\Queqiao\gateways\<name>` and `%LOCALAPPDATA%\Queqiao\workers\<name>`. Linux and WSL use the corresponding XDG role-scoped layout. Secrets remain separate files referenced by `config.yaml`; OAuth client registrations and other internal state remain implementation-owned data.

The frozen HTTP transport baseline permits only loopback Worker endpoints. Windows?SL localhost forwarding may make a WSL loopback Worker visible to the Windows Gateway through the Windows WSL relay, but Queqiao does not expose the Worker through the Gateway public base URL.

To migrate an older checkout safely, preview the non-overwriting plan and then execute it:

```powershell
npm run queqiao -- migrate from-repo --repo C:\path\to\Queqiao
npm run queqiao -- migrate from-repo --repo C:\path\to\Queqiao --execute
```

## Contributing and security

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development and validation workflow. Security issues should follow [SECURITY.md](SECURITY.md); do not disclose credentials or exploit details in a public issue. Queqiao is released under the [MIT License](LICENSE).

## Inspiration and independence

Queqiao was inspired by [Waishnav DevSpace](https://github.com/Waishnav/devspace) and
its approach to exposing selected local coding workspaces through MCP. Queqiao is an
independent implementation and is not affiliated with or endorsed by DevSpace.
