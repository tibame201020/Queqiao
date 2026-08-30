# CLI Demo GIF Plan

> **Historical visual plan (2026-08-29):** The four flow GIFs described below were recorded on 2026-08-20 and predate the production selector, Access Profile, Workspace authority, Extension Hub, and TUI design-system contracts. They were retired rather than reused. The current implementation now has three visual layers under `docs/cli/`: real PTY-driven interactive recordings, real packaged operational flows, and deterministic component animations. The remainder of this file is retained as recording/design history rather than current guidance.

Status: superseded by `docs/cli/README.md`, `docs/cli/interactive/README.md`, `docs/cli/flows/README.md`, and `docs/cli/components/README.md`.

## Goal

Replace the current single long first-run GIF with four short task-oriented demos. Each GIF should answer one user question, use real commands against a packed npm artifact, and avoid turning the README into a full CLI tutorial.

The four demos are:

1. Create the Gateway / Worker roles. The npm install command remains static README text rather than animation content.
2. Grant Workspace authority explicitly.
3. Start runtimes and enroll the Worker.
4. Verify the deployment is ready for MCP use.

## Shared recording contract

- Source: a packed/installable `@tibame201020/queqiao` npm artifact, never a fake terminal animation.
- Platform for the canonical README set: Windows PowerShell, because the current v0.7.0 demo baseline was already captured against an isolated Windows runtime.
- Runtime state: use a dedicated isolated demo runtime, not the developer's normal Queqiao configuration. The Windows harness uses `C:\Users\Public\QueqiaoDemo` so CLI output contains only a synthetic public path and the directory can be deleted after every run.
- Capture model: execute the real npm artifact first, save the resulting command/output transcript after deterministic redaction, optionally project verbose JSON onto task-relevant fields from the real response, then render that transcript into the terminal animation. The renderer must never invent success output. This replaces VHS on Windows because the installed VHS binary hangs even on a minimal `echo` tape in this environment.
- Terminal dimensions, font, theme, prompt, and zoom stay identical across all four GIFs. The accepted visual baseline is 1120x760 so final frames can preserve the complete task context instead of cropping earlier commands.
- Target duration: 8-15 seconds each; hard ceiling 20 seconds.
- Use one command task per visual beat. Avoid long unbounded logs.
- Keep enough output to prove the command really ran; trim only unrelated noise.
- Never reveal join tokens, OAuth material, local secrets, real user directories, machine-specific hostnames, or public endpoints.
- Redact generated Worker IDs, process IDs, enrollment tokens, and any other ephemeral identifiers that do not help a reader understand the flow.
- Demo names and paths must be synthetic and stable across recordings.
- Use deterministic demo labels where possible:
  - Gateway name: `demo-gateway`
  - Worker name: `demo-worker`
  - Workspace ID: `demo-workspace`
  - Demo root: a synthetic disposable directory such as `C:\queqiao-demo\workspace`
  - Public base URL in the visual: a safe placeholder such as `https://example.invalid/queqiao/`
- If the CLI output includes a generated secret or token, obscure the value before the frame is committed to the GIF.
- Commands shown in README GIFs must match the released CLI syntax at recording time.

## GIF 1 - Bootstrap Gateway and Worker roles

### User question

"What does first setup actually create?"

### Start state

- Clean disposable terminal.
- No demo Gateway or Worker state exists.
- The real npm artifact has already been installed into the isolated demo prefix by the recording harness; README shows that install command separately as static text.

### Command sequence

```powershell
queqiao gateway setup
queqiao worker setup
```

### Shot sequence

1. Run `gateway setup`; hold long enough for the role-local success result to be read.
2. Run `worker setup`; hold longer on the final result.
3. End with both role names visible so their separation is obvious.

### Required visual proof

The final frame should make it obvious that Gateway and Worker are distinct role-local setups. It should not imply that Workspace authority or enrollment has happened yet.

### Exclude

- npm install output; README presents installation as one static command immediately before this GIF.
- Workspace creation.
- Runtime `serve` commands.
- Join token / enrollment.

### Suggested README caption

`Create the Gateway and Worker roles separately. Role setup does not grant Workspace authority or enroll the Worker.`

---

## GIF 2 - Grant Workspace authority

### User question

"How does Queqiao get access to a local project without automatically exposing my machine?"

### Start state

- `demo-worker` already exists from GIF 1.
- Synthetic directory `C:\queqiao-demo\workspace` exists.
- No Workspace authority has yet been granted to that directory.

### Command sequence

Preferred interactive path:

```powershell
queqiao worker workspace add --worker demo-worker
```

Then enter/select the synthetic directory and stable Workspace ID according to the current CLI prompts.

Verification:

```powershell
queqiao worker workspace list --worker demo-worker
```

### Shot sequence

1. Run `worker workspace add --worker demo-worker`.
2. Show the interactive path / ID selection using only the synthetic demo directory.
3. Pause on the success confirmation.
4. Run `worker workspace list --worker demo-worker`.
5. End with exactly one demo Workspace visible.

### Required visual proof

The reader should see that Workspace authority is a separate, explicit grant and is scoped to one chosen directory.

### Exclude

- Tool / command permissions; those belong in the verification or advanced docs layer.
- Any real developer repository path.

### Suggested README caption

`Grant one explicit Workspace to the Worker. Queqiao does not turn setup or discovery into filesystem authority.`

---

## GIF 3 - Start and enroll

### User question

"How do the Gateway and Worker become an actual connected deployment?"

### Start state

- `demo-gateway` and `demo-worker` are configured.
- `demo-workspace` exists.
- Neither process is running.
- Worker is not yet enrolled in the Gateway membership registry.

### Command sequence

```powershell
queqiao worker serve --worker demo-worker --bg
queqiao gateway serve --gateway demo-gateway --bg
queqiao gateway join-token --gateway demo-gateway
queqiao worker join --worker demo-worker
queqiao gateway workers list --gateway demo-gateway
```

### Shot sequence

1. Start Worker in background and pause briefly on accepted/running state.
2. Start Gateway in background and pause briefly on accepted/running state.
3. Generate the one-time join code (clipboard copy is attempted automatically). The secret value must never be visible in the final GIF.
4. Run `worker join`; if the CLI prompts for the join code, show the prompt but redact the supplied value.
5. Run `gateway workers list --gateway demo-gateway`.
6. End with the enrolled/reachable demo Worker visible.

### Required visual proof

The sequence must communicate three boundaries:

- `serve` starts processes but does not enroll anything.
- `join-token` creates one-time enrollment material.
- `worker join` commits membership, after which the Gateway can list the Worker.

### Redaction rules specific to this GIF

- Join code: fully hidden.
- Enrollment token: fully hidden.
- Generated Worker ID: replace with a stable marker such as `<worker-id>` if it is displayed.
- PID: replace with `<pid>` if displayed.

### Exclude

- OAuth client registration details.
- Real public Funnel/Tailscale hostnames.
- Worker transport internals beyond the concise reachable/list result.

### Suggested README caption

`Start both roles, issue a one-time enrollment code, and join the Worker to the Gateway. Process startup and membership are separate operations.`

---

## GIF 4 - Verify the deployment

### User question

"How do I know the installation is actually ready to serve an MCP client?"

### Start state

- Gateway running.
- Worker running and enrolled.
- `demo-workspace` configured.

### Command sequence

Primary CLI proof:

```powershell
queqiao gateway status --gateway demo-gateway
queqiao worker status --worker demo-worker
queqiao gateway workers list --gateway demo-gateway
queqiao worker workspace list --worker demo-worker
queqiao worker workspace info --worker demo-worker --workspace <id>
queqiao doctor manifest show --gateway demo-gateway
```

Optional final payoff, only if it can be recorded cleanly without turning the GIF into a second tutorial:

- one real MCP-side read/list operation against the demo Workspace, using a supported client or Inspector;
- the MCP action must be very short and use only synthetic demo content.

### Shot sequence

1. `gateway status` -> running.
2. `worker status` -> running.
3. `gateway workers list` -> enrolled/reachable.
4. `worker workspace list` -> demo Workspace present.
5. `worker workspace info` -> scoped policy visible.
6. `doctor manifest show --gateway demo-gateway` -> stable deployment manifest visible.
7. Optional final 1-2 second MCP action/result as the payoff.

### Required visual proof

By the final frame, a new user should be able to infer:

```text
Gateway: running
Worker: reachable
Workspace: granted
Policy: explicit
Manifest: available
```

This is a conceptual summary for the visual; do not fabricate CLI output if the current commands use different wording.

### Exclude

- Full tool-by-tool demonstrations.
- Editing/running arbitrary user code.
- Long MCP Inspector navigation.
- Any claim that macOS is a supported v0.7.0 lifecycle target.

### Suggested README caption

`Verify runtime health, membership, Workspace authority, policy, and the public manifest before connecting an MCP client.`

---

## README layout plan

Do not duplicate the full CLI reference near the GIFs. The Quick CLI Demo section should act as onboarding; the existing `CLI baseline`, `First-time setup contract`, and runtime-configuration sections remain the command reference.

Proposed structure:

```markdown
## Quick CLI demo

Install:

```shell
npm install -g @tibame201020/queqiao
```

### 1. Create Gateway / Worker roles
![...](docs/assets/cli/01-bootstrap-roles.gif)
<one short caption>

### 2. Grant a Workspace
![...](docs/assets/cli/02-workspace-authority.gif)
<one short caption>

### 3. Start and enroll the Worker
![...](docs/assets/cli/03-start-enroll.gif)
<one short caption>

### 4. Verify the deployment
![...](docs/assets/cli/04-verify-deployment.gif)
<one short caption>
```

Asset paths:

```text
docs/assets/cli/
  01-bootstrap-roles.gif
  02-workspace-authority.gif
  03-start-enroll.gif
  04-verify-deployment.gif
```

The current `docs/assets/queqiao-cli-demo.gif` should be treated as the v0.7.0 prototype. Do not delete it until the replacement set has been recorded, reviewed, and linked from README.

## Recording acceptance gate

A GIF is accepted only when all of the following hold:

1. The command sequence is executed against a real packed/installable npm artifact.
2. The CLI syntax matches the release being documented.
3. The demo uses only isolated synthetic runtime state.
4. No secret, real machine path, real endpoint, generated token, Worker ID, or PID leaks into the asset.
5. The task can be understood without reading the full CLI reference.
6. The GIF remains legible at normal GitHub README width.
7. Duration is <= 20 seconds, preferably 8-15 seconds.
8. It contains no false terminal output or composited fake success state.
9. The last frame clearly proves the intended task outcome.
10. All four GIFs use the same terminal visual treatment.

## Execution order for the next stage

1. Build a deterministic isolated demo runtime and packed artifact input.
2. Implement/prepare the recording harness or repeatable command driver.
3. Record GIF 1 and review visual pacing/redaction.
4. Lock the terminal visual spec from GIF 1.
5. Record GIFs 2-4 using the same visual spec.
6. Review all four for secret/path leakage and correctness.
7. Update README to reference the four accepted assets.
8. Keep the old GIF until the README replacement is merged and rendered correctly on GitHub.
