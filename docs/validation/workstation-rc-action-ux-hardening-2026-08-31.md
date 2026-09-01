# Workstation RC Action UX Hardening — 2026-08-31

## Scope

This acceptance milestone re-opened the Workstation RC only for action transaction UX after manual review found that action results were too weak and the initial transaction surface was embedded inside Inspector.

No public MCP manifest, Gateway/Worker authorization boundary, runtime secret model, or Worker-authoritative policy contract changed.

## Accepted interaction contract

- Inspector keeps a universal `[i] Info` home for the selected entity.
- Action transactions render as an opaque root-level Ink modal above the persistent Control / Inventory / Inspector panes. The originating panes remain mounted and visible around the modal, while background input and text cannot bleed through the modal body.
- Action flow is semantic rather than uniform:
  - Start / Stop / Copy / Diagnostics and other low-risk immediate actions execute directly into `Working → Result`.
  - Configure / Edit / Join / Install operations enter their real form directly.
  - Remove / Delete / Uninstall operations retain explicit destructive target/effect confirmation with default No.
  - There is no generic review step for every action.
- Unavailable operations surface their prerequisite before execution rather than relying on downstream generic failures.
- Results use typed `success`, `noop`, `warning`, `cancelled`, and `error` outcomes with structured details, side effects, and remediation.
- Clipboard operations explicitly report copy success/failure. Join-code clipboard failure preserves a fallback synthetic `qjq1:` value inside the result instead of discarding it.
- Long result modals use measured scrolling; modal chrome and return-to-Info guidance remain fixed.
- Action outcomes stay inside the transaction modal and are not duplicated into the global runtime/health status line.

## Permanent coverage

The RC action surface is protected by dedicated Workstation tests for:

- all Gateway, Worker, Workspace, Access Profile, Extension, Diagnostics, and domain-level creation actions
- action availability and precondition reasons
- typed action outcome semantics
- immediate action execution without a redundant review step
- destructive cancellation and same-entity Info restoration
- opaque centered modal composition and input ownership
- narrow join-code clipboard-fallback result scrolling
- long form / Workspace Tools measured scrolling inside an absolute modal
- responsive wide / standard / narrow / too-small geometry
- lazy Inspector detail, Diagnostics, no-flicker refresh, and scroll resilience

Final Workstation-specific result: **14 files / 121 tests PASS**.

## Distribution and regression evidence

- TypeScript typecheck: PASS
- Full test suite: **86 files / 732 tests PASS**
- Security gate: **57 files / 524 tests PASS**
- Cluster gate: **8 files / 30 tests PASS**
- Disposable packaged Workstation smoke: **18 / 18 PASS**
- Package build: PASS
- Resource Safety baseline on Node 24: PASS
  - package size: **7.65 MiB**
  - package budget: **24 MiB**
  - failures: **0**
- `git diff --check`: PASS before final evidence write; rerun required after this document is added.

The disposable verifier covers wide, standard, narrow, too-small, structured Diagnostics, and a real root-level modal frame. It uses isolated runtime state and does not mutate the active production-style runtime.

## Repository hygiene

Changed/untracked-file scans reported zero matches for:

- developer-specific Windows/WSL user paths
- real Tailscale/Funnel hostname
- long join-code literals
- JWT-like values
- Bearer-like credentials

Runtime secrets and membership credential references remain outside repository data.

## Stable runtime read-only check

After all mutation-capable acceptance work completed, the existing stable environment was checked read-only:

- stable Gateway: Running / Managed
- primary Windows Worker: Running / Managed
- Gateway membership: Windows and Linux/WSL environments present
- local Gateway health endpoint: HTTP 200, `ok=true`

No stable Gateway or Worker stop/restart/relink operation was performed for this milestone.

## Result

**PASS — Workstation RC action transaction UX is production-validated for the reviewed scope.**

Further Workstation changes should return to manual RC polish only; release preparation must not silently expand the action surface or weaken the validated outcome/precondition/security contracts.
