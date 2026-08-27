# Dashboard Runtime Lifecycle UI/UX Plan

Status: design brief for the next v0.8 implementation slice  
Branch: `feat/dashboard-control-plane`  
Scope: Gateway / Worker runtime lifecycle only. No supervisor backend or lifecycle mutation API is implemented by this document.

## 1. Job and audience

The operator is a developer administering Queqiao locally while coding. They need to answer two questions quickly:

1. **What is actually running, and is it the runtime I configured?**
2. **What can I safely do about it from the Dashboard?**

The Dashboard is not a graphical shell. CLI and Dashboard must remain two frontends over the same lifecycle semantics. Worker authority, OAuth, workspace policy, and public MCP schema remain untouched.

The intended feel is a dense operations console: calm under normal conditions, explicit when intervention is required, and conservative around destructive lifecycle actions.

## 2. Product-specific lifecycle model

Do not reduce runtime state to a single `Running / Stopped` badge. The current CLI contract already distinguishes configuration, reachability, identity and managed PID ownership. The UI must preserve those distinctions.

### 2.1 Three independent axes

**Configuration readiness**
- `ready` — role configuration is valid enough to serve.
- `needs_setup` — role configuration is absent/incomplete.
- `needs_workspace` — Worker exists but has no default Workspace.

**Observed runtime health**
- `healthy` — health endpoint responds and identity matches.
- `degraded` — runtime responds but health is not OK.
- `identity_conflict` — configured endpoint is occupied by another runtime / Worker identity mismatch.
- `offline` — configured runtime cannot be reached.
- `checking` — a lifecycle probe is in flight.

**Management ownership**
- `managed` — reconciled PID belongs to the expected Queqiao entry point.
- `unmanaged` — correct runtime is reachable but was not started by Queqiao lifecycle management.
- `none` — no reconciled managed process exists.

These axes are intentionally independent. Example: `ready + healthy + unmanaged` is a valid state and must not be shown as an error.

### 2.2 Transitional action states

Frontend-only pending states should mirror a future supervisor operation and never optimistically overwrite observed health:

- `starting`
- `stopping`
- `restarting`
- `repairing`

During transition, retain the last observed runtime state underneath the progress treatment until the supervisor returns and a fresh probe completes.

## 3. Information architecture

Keep the existing Queqiao Operations Console topology navigation. Do not add a separate lifecycle product area that duplicates Workers.

### Overview

Add a **Runtime posture** section above topology inventory:

- Gateway runtime row first — because it is the control-plane dependency.
- Worker runtime rows below it.
- Each row shows role/name, configuration readiness, observed health, ownership, endpoint/port and one context action.
- Default view is diagnosis-first; process metadata such as PID is secondary disclosure, not the focal point.

### Gateway detail

Focal element: **control-plane availability and safe lifecycle action**.

Sections:
1. Runtime posture — observed health + management ownership.
2. Configuration readiness — setup status, listener, management listener, public base identity summary.
3. Lifecycle action area.
4. Recovery diagnostics — only when degraded/conflicted/offline.

### Worker detail

Focal element: **Worker reachability and authority readiness**.

Sections:
1. Runtime posture.
2. Configuration readiness — listener + identity + default Workspace readiness.
3. Lifecycle action area.
4. Existing Workspace list/policy remains below lifecycle; lifecycle must not replace Worker authority UI.

Do not create a card for every state. Prefer one compact posture strip + structured sections.

## 4. Action hierarchy

### Healthy + managed

Primary contextual action: `Restart` only when intervention is reasonable. `Stop` is secondary/destructive.

Do not show `Start` when already healthy.

### Healthy + unmanaged

Show `Externally running` as ownership information.

- Do **not** offer `Stop`; Queqiao has no reconciled managed PID authority to kill it.
- Do **not** offer a fake `Take over` action unless a future backend contract can prove safe ownership transfer.
- A disabled/absent Stop control is intentional security semantics, not a missing feature.

### Offline + ready

Primary action: `Start`.
Secondary action: diagnostics/details.

### Needs setup

Primary action: `Set up Gateway` or `Set up Worker`.
Do not show Start until prerequisites are satisfied.

### Worker needs Workspace

Primary action: `Add Workspace`.
Explain that Worker serving is blocked until a default Workspace exists, matching current CLI behavior.

### Identity conflict / occupied port

No Start button.
Primary action: `Inspect conflict` / `Repair configuration`.
The UI must state that Queqiao will not replace or kill an unknown process occupying the configured endpoint.

## 5. Gateway self-lifecycle semantics

The Dashboard is served by the Gateway management listener, so Gateway lifecycle actions need special UX.

### Restart Gateway

A restart must be represented as a handoff to an external local supervisor. The browser should expect the Dashboard connection to disappear temporarily.

Interaction sequence:
1. Operator chooses Restart.
2. Confirmation explains: `The local control plane will disconnect briefly.`
3. UI enters `restarting` and starts bounded reconnect polling only after the supervisor acknowledges the request.
4. Existing Dashboard session credentials remain browser-local; the UI attempts to reconnect while still valid.
5. On recovery, refresh the full control-plane snapshot before reporting success.
6. If recovery exceeds the bounded window, present explicit recovery instructions; never show an endless spinner.

### Stop Gateway

This is a high-consequence action because it intentionally destroys the page's backend.

- Place under a dedicated **Danger zone**, never beside Refresh/Restart.
- Require confirmation naming the Gateway.
- Confirmation copy must say that the Dashboard becomes unavailable and must later be started through CLI or an external supervisor surface.
- After supervisor acknowledgement, render a terminal disconnected state rather than a success toast that depends on a dead backend.

## 6. Confirmation policy

Do not confirm routine/reversible actions merely because they are lifecycle actions.

| Action | Confirmation | Reason |
| --- | --- | --- |
| Start stopped managed runtime | No | Reversible and expected |
| Restart healthy Worker | No, unless active work impact becomes knowable later | Common recovery action |
| Restart Gateway | Yes | Temporarily disconnects control plane |
| Stop Worker | Yes | Interrupts execution / routing |
| Stop Gateway | Strong confirmation | Destroys current Dashboard backend |
| Setup / Repair | Review changes before apply | May modify local runtime config |
| Kill/replace unknown process | Never offered | Outside current lifecycle authority |

Use native/accessibly managed dialogs in implementation; do not use `window.confirm` for this lifecycle surface.

## 7. Failure and recovery states

Failures are operational states, not generic red toasts.

### Port / identity conflict

Show:
- configured endpoint/port;
- `Another process is responding here` or identity mismatch;
- Start disabled;
- safe next step: inspect or change port/config.

Never offer forced termination of an unverified PID.

### Start failure

Keep last observed state visible. Present the actual bounded management error category and a retry action. Do not flip to `running` until a subsequent health + identity probe succeeds.

### Stop failure

If the supervisor reports failure, re-probe immediately. If runtime remains healthy, show `Stop did not complete` rather than an ambiguous toast.

### Stale managed PID

The backend reconciles stale PID metadata. UI should simply show `Not managed` / `Offline`; stale PID cleanup is diagnostic detail, not operator work.

### Dashboard reconnect failure after Gateway restart

Show a full-page `Control plane unavailable` recovery state with:
- last known Gateway name;
- reconnect button;
- CLI fallback command pattern;
- no automatic infinite retry.

## 8. Visual and interaction direction

Domain vocabulary: control plane, runtime, process ownership, health probe, identity, topology, handoff, recovery.

Signature: **three-axis runtime posture** — one compact operational row that visually separates readiness, health and ownership instead of collapsing them into a generic status badge.

Reject:
- generic metric-card dashboard → use topology + posture rows;
- green/red `Running/Stopped` simplification → preserve lifecycle semantics;
- toolbar full of CLI verbs → expose only context-valid actions;
- oversized warning modals for every action → reserve friction for true interruption/destruction.

Existing dark technical console direction remains authoritative. Use the current low-contrast border/surface system, compact density, small-radius badges, tabular numbers and restrained motion.

Motion rules:
- Start/stop/restart action feedback: immediate 100–160 ms control response.
- Posture changes: color/opacity transition only; avoid celebratory motion.
- Reconnect/restart state: subtle progress indicator; no indeterminate animation beyond a bounded recovery window.
- Drawers/dialogs: existing 180–240 ms console motion system.
- Respect `prefers-reduced-motion`.

## 9. Responsive behavior

Desktop remains the primary operations surface.

At narrow widths:
- collapse the three-axis posture row into stacked labeled values;
- keep the current resource name + observed health visible first;
- move secondary PID/endpoint metadata behind disclosure;
- lifecycle actions remain reachable without horizontal scrolling;
- destructive Gateway actions remain separated from primary controls.

Do not hide lifecycle state merely to fit mobile width.

## 10. Backend contract consequences for the next implementation slice

The supervisor API should return structured state rather than CLI prose. At minimum the read model must support:

- role + runtime name;
- configuration readiness + reason;
- active/reachable/healthy/identity match;
- managed ownership + reconciled PID when safe to expose locally;
- listener endpoint/port;
- last probe timestamp;
- valid contextual actions / capability flags;
- bounded error category.

Mutation operations should be explicit (`start`, `stop`, `restart`, later `setup/repair`) and return an acknowledgement plus a fresh/refreshable runtime projection.

The Dashboard must not infer kill authority from `active=true`. Only backend-reconciled `managed=true` permits a managed stop.

Gateway restart/stop must be executed by an external local supervisor boundary, not by the Gateway HTTP handler terminating its own process inline.

## 11. Scope boundaries / anti-goals

This planning slice does **not**:

- implement a supervisor;
- add lifecycle HTTP routes;
- change CLI lifecycle semantics;
- add OS service install/autostart;
- alter Worker authority;
- alter OAuth/CSP;
- alter the public MCP manifest or Worker Protocol;
- make non-loopback Dashboard administration supported.

The existing accepted CLI contract remains: explicit `serve [--bg]`, `stop`, `status`; no installed-service concept. PID records remain advisory metadata validated against the expected Queqiao entry point before any stop action.

## 12. Implementation sequence

1. Extract/centralize lifecycle read semantics into shared operations without changing CLI behavior.
2. Introduce the external local supervisor boundary and structured lifecycle read API.
3. Add Dashboard runtime posture UI in read-only mode.
4. Add Worker start/stop/restart mutations and recovery flows.
5. Add Gateway restart/stop with explicit browser disconnect/reconnect semantics.
6. Add setup/repair flow only after the runtime mutation contract is stable.

This ordering prevents the React layer from inventing process authority or lifecycle state that the backend cannot safely prove.
