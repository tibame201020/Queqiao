# CLI Service Lifecycle Shadow Acceptance — 2026-08-15

**Result: PASS**

This validation records the Stage A CLI service-lifecycle foundation after the Gateway/Worker membership refactor was promoted to Stable.

## Scope

Stage A adds explicit local service lifecycle commands without changing the public MCP contract, Worker Protocol, enrollment semantics, or Gateway membership model:

```text
queqiao service install --role gateway|worker [--instance <id>]
queqiao service start --role gateway|worker [--instance <id>]
queqiao service stop --role gateway|worker [--instance <id>]
queqiao service status --role gateway|worker [--instance <id>]
queqiao service uninstall --role gateway|worker [--instance <id>]
```

`--instance` is only a local service-manager identity. It does not become a Worker identity, environment identity, protocol field, or separate configuration model.

## Platform lifecycle model

### Windows

The initial current-user Scheduled Task approach was rejected during real Shadow dogfood because the non-interactive user session did not have permission to create the task. The implementation did not elevate privileges or fall back to an administrator service.

The accepted Windows design uses:

- the current-user Run key for login startup;
- an instance-specific one-shot launcher for login startup;
- explicit user-scope start/stop/status commands;
- a securely stored PID record for explicitly started roles;
- process-command-line identity verification before stop;
- fail-closed refusal when a recorded PID belongs to another process;
- a duplicate-start guard that treats an already reachable role as running even if no managed PID record is present.

Explicit Windows start launches the role directly through the native user process mechanism and records the returned role PID. It does not make Queqiao a durable process manager.

### Linux / WSL

Linux and WSL use `systemd --user` with an instance-specific unit. The generated unit keeps the service user-scoped and includes:

- `NoNewPrivileges=true`;
- `PrivateTmp=true`;
- `Restart=on-failure`.

## Runtime layout isolation

Service lifecycle uses the existing runtime layout contract. Non-default lanes use the existing layout overrides:

- `QUEQIAO_CONFIG_DIR`
- `QUEQIAO_DATA_DIR`
- `QUEQIAO_STATE_HOME`
- `QUEQIAO_RUNTIME_DIR`

`--file` changes only the selected configuration file and does not relocate data, state, logs, or runtime directories.

This distinction was explicitly verified during Shadow dogfood. Stable and Shadow service identities and runtime state remained separated.

## Shadow dogfood acceptance

The candidate CLI was installed into the existing Shadow lane without changing Gateway/Worker protocol identity or membership.

Observed final state:

- Shadow Gateway service definition: installed, active, health `200`;
- Shadow Windows Worker service definition: installed, active, health `200`;
- Shadow Windows Worker listener PID exactly matched the CLI-managed PID record;
- Shadow WSL Worker `systemd --user` service: installed, active, health `200`;
- Shadow Gateway liveness projection reported both existing environments reachable;
- Stable Gateway remained healthy throughout the Shadow lifecycle work;
- accidental default-lane Shadow service-state residue created during dogfood was removed;
- Windows current-user startup entries pointed to the isolated Shadow service launchers.

A real WSL lifecycle round trip also verified `stop` removed the Worker listener and `start` restored health `200`.

## Security invariants

The service lifecycle does not:

- add an administrator/root service requirement;
- embed approval secrets, Worker credentials, OAuth tokens, or other secrets in launchers;
- weaken Worker-authoritative workspace/tool/process policy;
- broaden Worker transport beyond the current loopback-only HTTP baseline;
- auto-enroll Workers or edit Gateway membership as a side effect of service startup;
- add a Queqiao Job or durable child-process recovery abstraction.

Service lifecycle tests are included in the adversarial security gate.

## Validation gates

Final branch validation includes:

- TypeScript typecheck: PASS;
- full test suite: PASS;
- service-lifecycle targeted tests: PASS;
- security/adversarial suite: PASS;
- cluster suite: PASS;
- self-contained package build: PASS;
- runtime dependency audit: zero vulnerabilities;
- Resource Safety Baseline: PASS, including zero idle writes and zero idle log growth;
- `git diff --check`: PASS.

## Contract impact

- Public MCP manifest: unchanged — Core Manifest Revision 6 / 17 public tools.
- Worker Protocol: unchanged — 3.0.
- Gateway membership/enrollment semantics: unchanged.
- OAuth connector semantics: unchanged.

The existing Shadow connector's stale dynamic OAuth client registration is intentionally **not** repaired by this Stage A change. Rebuilding a complete Shadow installation and obtaining a fresh OAuth dynamic client registration belongs to the following CLI setup/orchestration stage.
