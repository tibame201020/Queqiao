# Queqiao

[![Resource Safety Baseline](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml/badge.svg)](https://github.com/tibame201020/Queqiao/actions/workflows/resource-safety.yml)

Queqiao builds one secure bridge between AI clients and multiple coding environments.

The public MCP endpoint belongs to a lightweight Gateway. Windows, WSL, Linux, and
future remote environments each run their own Worker, so filesystem and process work
always executes inside the native environment.

## Production architecture

- **Gateway** owns the public MCP endpoint, OAuth, stable tool schemas, routing, and
  worker health. It cannot read files or spawn workspace processes.
- **Worker** connects outbound to the Gateway and executes only against locally
  configured workspaces. It is not exposed to the public internet.
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

Queqiao is under active development. The current Secure Agent Substrate candidate uses
**Core Manifest Revision 6** and **Worker Protocol 3.0**. Core exposes ten typed tools:
`workspace_info`, `list_workspaces`, `open_workspace`, `read_file`, `write_file`,
`edit_file`, `list_directory`, `search_text`, `run`, and `shell`. The candidate also
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
queqiao workspace list
queqiao workspace init --id <id> --name <name> --root <path>
queqiao workspace add --id <id> --name <name> --root <path>
queqiao workspace remove --id <id>
queqiao discovery list
queqiao discovery add --root <path>
queqiao discovery remove --root <path>
queqiao gateway setup --public-base-url <url>
queqiao gateway join-token [--expires <seconds>]
queqiao worker setup --workspace-id <id> --workspace-root <path>
queqiao worker join --gateway <management-url> --token <join-token> --endpoint <loopback-worker-url>
queqiao worker list
queqiao worker update --worker-id <id> --endpoint <loopback-worker-url>
queqiao worker remove --worker-id <id>
queqiao service install --role gateway|worker [--instance <id>]
queqiao service start --role gateway|worker [--instance <id>]
queqiao service stop --role gateway|worker [--instance <id>]
queqiao service status --role gateway|worker [--instance <id>]
queqiao service uninstall --role gateway|worker [--instance <id>]
queqiao profile set --workspace <id> --profile read-only|editor|coding
queqiao tool allow --workspace <id> --tool <tool>
queqiao tool deny --workspace <id> --tool <tool>
queqiao command allow --workspace <id> --command <executable>
queqiao command deny --workspace <id> --command <executable>
queqiao permissions show
queqiao manifest show
queqiao extension list
queqiao extension doctor
queqiao tool explain <tool>
queqiao doctor
```

Discovery roots are optional read-only search scopes, never Workspace grants. Core Workspace
authority is created only through explicit administrator-controlled `workspace init` /
`workspace add` operations against an existing directory. Repository/worktree discovery
and lifecycle semantics belong to the Git extension and never broaden the selected
Workspace authority boundary.

Configuration changes use an exclusive lock, validated temporary file, and atomic
rename. A Worker validates every new root before replacing its in-memory catalog; a
rejected update leaves the last-known-good catalog active.

The verified WSL Worker is managed by a systemd user service and keeps its native
configuration at `$XDG_CONFIG_HOME/queqiao/config.yaml` (or
`$HOME/.config/queqiao/config.yaml`). Running the same
compiled CLI inside WSL resolves and validates Linux paths without Windows mediation.

## Runtime configuration

Queqiao never requires secrets or machine-specific paths inside the source checkout.
The bundled CLI resolves the platform layout and reports it with:

```powershell
npm run queqiao -- config paths
```

Installed from npm, set up the Gateway and Worker roles explicitly, then enroll the Worker with a one-time join token:

```shell
npm install --global @tibame201020/queqiao
queqiao gateway setup --public-base-url https://example.invalid
queqiao worker setup --workspace-root /path/to/project --workspace-id project
queqiao-gateway
queqiao-worker
queqiao gateway join-token
queqiao worker join --gateway http://127.0.0.1:7574 --token <join-token> --endpoint http://127.0.0.1:7576
```

The package is self-contained and exposes three independent process roles. Installing
it does not start either service: a Gateway host runs `queqiao-gateway`, while every
coding environment runs its own `queqiao-worker`. Gateway routing comes only from its persistent membership registry. A Worker joins explicitly with a one-time token; the Gateway then verifies authenticated Worker identity, environment identity, protocol version, process instance ID, platform, and required capabilities before committing membership. Worker startup never auto-registers or edits Gateway state.

The frozen HTTP transport baseline permits only loopback Worker endpoints. The persistent Worker credential and authenticated handshake protect Gateway-to-Worker routing; remote-host Workers require a future mutually authenticated transport and are not covered by this baseline.

On Windows, configuration is stored under `%LOCALAPPDATA%\Queqiao`; on Linux and
WSL it follows the XDG config, data, state, and runtime directories. Secrets are
separate files referenced by `config.yaml`. User-editable configuration is YAML;
OAuth client registrations and other internal state remain implementation-owned data.
To migrate an older checkout safely,
preview the non-overwriting plan and then execute it:

```powershell
npm run queqiao -- migrate from-repo --repo C:\path\to\Queqiao
npm run queqiao -- migrate from-repo --repo C:\path\to\Queqiao --execute
```

After CLI-managed configuration exists, install and control each local role with the native user-scope service manager:

```shell
queqiao service install --role worker --instance stable
queqiao service install --role gateway --instance stable
queqiao service start --role worker --instance stable
queqiao service start --role gateway --instance stable
queqiao service status --role worker --instance stable
queqiao service status --role gateway --instance stable
```

Windows uses the current-user Run key for login startup and user-scope start/stop control; it does not install an administrator service. Linux and WSL use `systemd --user`. The `--instance` value isolates service-manager identities such as `stable` and `shadow`; it does not create a separate configuration model. Non-default runtime lanes should use the existing `QUEQIAO_CONFIG_DIR`, `QUEQIAO_DATA_DIR`, `QUEQIAO_STATE_HOME`, and `QUEQIAO_RUNTIME_DIR` layout overrides. `--file` overrides only the config file and does not relocate state, data, or runtime directories. Direct `queqiao-gateway` / `queqiao-worker` entry points remain available for foreground debugging.

The Worker listens only on `127.0.0.1:7576`. The public tunnel must point only to the
Gateway on port `7575`. Configure ChatGPT with the public `/mcp` URL.

## Inspiration and independence

Queqiao was inspired by [Waishnav DevSpace](https://github.com/Waishnav/devspace) and
its approach to exposing selected local coding workspaces through MCP. Queqiao is an
independent implementation and is not affiliated with or endorsed by DevSpace.
