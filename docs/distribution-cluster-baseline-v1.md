# Distribution & Cluster Baseline v1

This baseline freezes the production distribution, native-Worker, and CLI-lifecycle guarantees used by the current release candidate.

1. `@tibame201020/queqiao` is a self-contained npm artifact. Its CLI, Gateway, Worker,
   internal packages, and runtime dependencies are bundled into one tarball.
2. Gateway core is OS-independent. CI installs the packed artifact and exercises supported
   package/runtime behavior on Ubuntu and Windows.
3. Native Workers remain the execution authority. Gateway membership is explicit and a
   Worker cannot become routable until authenticated identity/protocol validation succeeds.
4. First-time setup is an explicit multi-step contract; no generic setup command silently
   creates Gateway state, Worker state, Workspace authority, or membership together.

## Process roles

The package exposes only the public `queqiao` command. Gateway and Worker remain internal
runtime entry artifacts launched by `queqiao`; installation does not enable or launch a role.
A host may run Gateway, Worker, both, or neither.

Named Gateway and Worker runtimes use role-local state. Lifecycle is explicit:
`serve [--bg]`, `stop`, and `status`. `--bg` starts a background process but does not
install an OS service or autostart mechanism.

## First-time setup and authority boundaries

The supported human flow is:

```text
queqiao gateway setup
queqiao worker setup
queqiao worker serve --worker <worker> --bg
queqiao gateway serve --gateway <gateway> --bg
queqiao gateway join-token --gateway <gateway>
queqiao worker join --worker <worker>
```

The setup commands are interactive instance choosers; `worker setup` also creates the first
Workspace authority. Use `workspace add` for additional Workspaces. `worker join` separately creates Gateway membership through
the one-time enrollment transaction defined by ADR-0011.

There is no generic `queqiao setup` and Worker startup does not auto-register. A future
Workstation TUI may compose these existing management primitives into one persistent operator
surface, but it does not merge runtime roles or create a second management model.

## Enrollment, membership, and Worker validation

Persistent membership is Gateway-owned state separate from user-managed `config.yaml`.
Membership contains stable Worker/environment identity, a fixed transport descriptor, and
credential references. Runtime reachability and per-process state are observed live rather
than persisted as membership truth.

Human enrollment uses a one-time `qjq1:` join code. The atomic transaction issues a
provisional Worker credential, requires secure Worker-side storage and confirmation within
30 seconds, then performs a real Gateway-to-Worker identity/Worker-Protocol validation
before committing membership. Failure rolls back provisional membership/credential state;
the attempted one-time join token remains consumed.

The verified Worker transport is loopback HTTP. Each Gateway-visible Worker transport
endpoint must be unique. Gateway-observed liveness is low-frequency and advisory: a failed
probe marks reachability but does not permanently veto a later real invocation attempt.

Current Worker Protocol is **3.0**.

## CI gates

`distribution-baseline.yml` protects the distribution and setup contract with:

- `Full test suite (ubuntu-latest)` and `Full test suite (windows-latest)`;
- `Self-contained package (ubuntu-latest)` and `Self-contained package (windows-latest)`;
- `Linux Gateway and Worker handshake`;
- `CLI setup flow (ubuntu-latest)` and `CLI setup flow (windows-latest)`.

The dedicated CLI setup jobs run:

```text
npm ci --ignore-scripts
npm run typecheck
npm run test:cli-setup
```

The typecheck/build step is intentional: monorepo workspace package entry points must exist
before focused Vitest execution can resolve packages such as `@queqiao/config` on a clean
runner. The focused suite covers the mocked first-time Gateway/Worker/Workspace flow and
cross-platform Workspace-ID/path behavior.

Both CLI setup-flow checks are required by `main` branch protection in addition to the
existing full-test, package, cluster, adversarial, dependency-audit, and resource-safety
checks. A setup-flow regression therefore blocks merge even when unrelated suites pass.

## Security boundary

Workers remain restricted to loopback HTTP in this baseline. Worker credentials authenticate
the private Gateway-to-Worker transport on the host; they do not provide a general public
remote-Worker transport. Future cross-host transport may change the binding, but must not
change Worker-authoritative execution policy or silently broaden Workspace authority.
