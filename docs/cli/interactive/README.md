# Interactive CLI Flows

These recordings use the real packaged Queqiao CLI inside an isolated pseudo-terminal (PTY).
The recorder opens a real shell, types public commands, waits for production prompt text, sends
normal keyboard input, captures the ANSI terminal stream, and renders it with pinned `agg`.

The GIFs play once and stop on their final frame. They are not synthetic component animations
and they do not rely on documentation-only CLI flags.

## 1. Gateway setup

![Interactive Gateway setup](../../assets/cli/interactive/01-gateway-setup.gif)

```shell
queqiao gateway setup
```

## 2. Worker, first Workspace, and Access

![Interactive Worker and Access setup](../../assets/cli/interactive/02-worker-access-setup.gif)

```shell
queqiao worker setup
```

The recording enters `Custom` Access, navigates the Tools multiselect, enables `run`, and
supplies an executable allowlist.

## 3. Named-instance selector

![Interactive named Gateway selector](../../assets/cli/interactive/03-instance-selector.gif)

```shell
queqiao gateway status
```

## 4. Extension attachment

![Interactive Extension attachment](../../assets/cli/interactive/04-extension-attach.gif)

```shell
queqiao extension install <npm:package|local-path>
queqiao extension attach
```

## 5A. Start runtimes

![Interactive runtime startup](../../assets/cli/interactive/05-runtime-start.gif)

```shell
queqiao worker serve --worker <worker> --bg
queqiao gateway serve --gateway <gateway> --bg
```

## 5B. Enroll the Worker

![Interactive Worker enrollment](../../assets/cli/interactive/06-worker-enrollment.gif)

```shell
queqiao gateway join-token --gateway <gateway>
queqiao worker join --worker <worker>
```

The join code is generated in isolated state and entered through the production password-style
prompt, so it is not echoed into the terminal recording.

## Recording contract

A recording is publishable only when:

1. The CLI comes from a staged npm package built from the same source revision.
2. The CLI runs in isolated HOME/config/runtime/npm-prefix state.
3. The recorder waits for real production prompt text before sending input.
4. Setup uses only the public command surface.
5. Terminal geometry is fixed so wrapping and viewport behavior are deterministic.
6. The raw ANSI stream is captured before rendering.
7. `agg` is pinned and checksum-verified.
8. Rendering uses `--no-loop` and a final-frame hold.
9. No real endpoint, credential, token, join code, or user runtime configuration is published.

Regenerate the complete interactive set on Windows with WSL available:

```powershell
npm run docs:cli:interactive
```

Implementation:

- `scripts/cli-demo/record-interactive.ps1`
- `scripts/cli-demo/record_interactive.py`
