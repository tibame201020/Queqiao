# Queqiao

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

Queqiao is under active development. The frozen coding baseline exposes
`workspace_info`, `list_workspaces`, `open_workspace`, `read_file`, `write_file`, and
`edit_file` through an OAuth-protected Gateway. Write and edit require an `editor` or
`coding` workspace profile. OAuth uses the single `queqiao:access` handshake scope;
it does not grant filesystem or process capabilities.

The v0 sequence is intentionally fixed:

1. validate one workspace through ChatGPT;
2. freeze the compatible baseline;
3. add and validate multiple workspaces;
4. add and validate Windows and WSL Workers;
5. add the management CLI and broader coding tools;
6. add optional step-up security features last.

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

Security Baseline v1 is frozen. OAuth replay protection, MCP request budgets, sanitized
health reporting, fail-closed Worker routing, native policy enforcement, filesystem and
process containment, and the documented adversarial matrix are enforced by required
Windows/Linux GitHub checks. See the
[security gate](docs/security/security-baseline-v1-gate.md) and
[threat matrix](docs/security/security-baseline-v1-threat-matrix.md).

## CLI baseline

The current management CLI supports:

```text
queqiao workspace list
queqiao workspace init --id <id> --name <name> --root <path>
queqiao workspace add --id <id> --name <name> --root <path>
queqiao workspace remove --id <id>
queqiao environment list
queqiao environment add --id <id> --url <loopback-url> --token-file <path>
queqiao environment remove --id <id>
queqiao profile set --workspace <id> --profile read-only|editor|coding
queqiao tool allow --workspace <id> --tool <tool>
queqiao tool deny --workspace <id> --tool <tool>
queqiao command allow --workspace <id> --command <executable>
queqiao command deny --workspace <id> --command <executable>
queqiao permissions show
queqiao doctor
```

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

Installed from npm, initialize the external YAML config and run the native services:

```shell
npm install --global @tibame201020/queqiao
queqiao config init --public-base-url https://example.invalid --workspace-root /path/to/project --workspace-id project
queqiao-worker
queqiao-gateway
```

The package is self-contained and exposes three independent process roles. Installing
it does not start either service: a Gateway host runs `queqiao-gateway`, while every
coding environment runs its own `queqiao-worker`. Before a Worker is considered online
or receives a tool call, the Gateway performs an authenticated handshake and verifies
its configured environment identity, protocol version, process instance ID, platform,
and required capabilities.

The frozen cluster baseline permits only loopback Worker endpoints. The shared token
and handshake protect local Gateway-to-Worker routing; remote-host Workers require a
future mutually authenticated transport and are not covered by this baseline.

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

After CLI-managed configuration exists, start the two processes in separate terminals:

```powershell
npm run start:worker
npm run start:gateway
```

The Worker listens only on `127.0.0.1:7576`. The public tunnel must point only to the
Gateway on port `7575`. Configure ChatGPT with the public `/mcp` URL.

## Inspiration and independence

Queqiao was inspired by [Waishnav DevSpace](https://github.com/Waishnav/devspace) and
its approach to exposing selected local coding workspaces through MCP. Queqiao is an
independent implementation and is not affiliated with or endorsed by DevSpace.
