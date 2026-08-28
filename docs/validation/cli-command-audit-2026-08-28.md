# CLI Command Audit — 2026-08-28

## Goal

Review every current Queqiao CLI command after hierarchy consolidation. A public command should remain only when it has a real owner, a real consumer, and no more natural existing flow that already performs the same job.

This audit distinguishes product-level onboarding from role-level primitives. Future `queqiao setup` is product-level orchestration; Gateway and Worker remain separate runtime roles.

## Decisions

| Command | Decision | Reason |
| --- | --- | --- |
| `gateway setup` | KEEP | Explicit Gateway role bootstrap primitive. Needed independently of product-level onboarding. |
| `gateway serve [--bg]` | KEEP | Gateway foreground/background lifecycle. |
| `gateway stop` | KEEP | Stops Queqiao-managed Gateway process state. |
| `gateway status` | KEEP | Role-local health/PID/identity inspection. |
| `gateway join-token` | KEEP | Required half of explicit Worker enrollment; preserves the k3s-like join model. |
| `gateway workers list` | KEEP | Gateway owns membership and routing inventory. |
| `gateway workers update` | KEEP / advanced | Explicit transport recovery/update primitive. Worker config does not persist a Gateway association that could safely auto-update membership after listener changes. |
| `gateway workers remove` | KEEP | Explicit membership revocation/removal. |
| `worker setup` | KEEP | Explicit Worker identity/listener bootstrap primitive. |
| `worker port` | KEEP / granular | Real mutable Worker setting with stop-before-change semantics. Good low-level automation primitive; interactive settings may later absorb it. |
| `worker serve [--bg]` | KEEP | Worker foreground/background lifecycle. |
| `worker stop` | KEEP | Stops Queqiao-managed Worker process state. |
| `worker status` | KEEP | Role-local health/PID/identity inspection. |
| `worker join` | KEEP | Required Worker side of explicit Gateway enrollment. |
| `worker workspace add` | KEEP | Explicit Workspace authority grant. |
| `worker workspace list` | KEEP | Worker-owned authority inventory. |
| `worker workspace remove` | KEEP | Explicit authority removal. |
| `worker workspace profile set` | KEEP / TUI candidate | Real policy mutation and useful automation primitive; interactive management should eventually offer the same operation without requiring users to memorize setters. |
| `worker workspace tool allow|deny` | KEEP / TUI candidate | Real Worker-authoritative tool policy mutation. |
| `worker workspace command allow|deny` | KEEP / TUI candidate | Real Worker-authoritative executable allowlist mutation. |
| `worker workspace permissions show` | KEEP / TUI candidate | Unique sanitized policy inspection; future Workspace management UI may present it more naturally. |
| `worker discovery list|add|remove` | REMOVE | Obsolete discovery-root state has no runtime consumer after repository/project discovery moved to extensions/clients. |
| `extension install` | KEEP | Extension Hub package installation. |
| `extension uninstall` | KEEP | Extension Hub package removal; `--force` handles explicit detachment cleanup. |
| `extension attach` | KEEP | Worker activation/usage state; no separate enable/disable model. |
| `extension detach` | KEEP | Removes Worker usage state without uninstalling the package. |
| `extension list` | KEEP | Hub inventory plus Worker attachment visibility. |
| `extension show` | KEEP | Detailed package/manifest/attachment inspection. |
| `doctor` | KEEP | Whole-system local diagnostics now enumerate named Gateways and Workers and aggregate Extension Hub integrity. |
| `doctor extension` | KEEP / advanced | Unique Extension Hub + named-Worker integrity check. Can later be aggregated into root `doctor`. |
| `doctor manifest show --gateway <name>` | KEEP / advanced | Gateway-owned composition/debug inspection with explicit named-Gateway resolution. |
| `doctor tool explain <tool> --gateway <name>` | KEEP / advanced | Effective-composition explanation resolved against an explicit named Gateway. |
| `doctor paths` | KEEP / advanced | Runtime-layout troubleshooting. |
| `migrate from-repo` | KEEP HIDDEN | Legacy migration primitive; intentionally absent from primary root help. |
| `migrate runtime-v1` | KEEP HIDDEN | Legacy runtime-layout migration primitive; intentionally absent from primary root help. |

## Removed hidden tombstones

The CLI still contained dead branches that recognized old grammar only to print deprecation errors:

- `config init`;
- `workspace init`;
- `workspace discover`;
- `workspace approve`;
- `environment ...`.

Because this branch intentionally performs a breaking CLI cleanup rather than maintaining the former grammar, these hidden tombstone handlers are removed. Historical validation documents keep their original spellings as evidence.

## Selector review

`worker workspace ... --worker <worker>` initially appears inconsistent with role-level `worker ... --name <worker>`. The current spelling is retained for now because `workspace add --name <display-name>` already uses `--name` for the Workspace itself. Changing the parent selector would require a coordinated option redesign such as `--display-name`; it is not justified as a cosmetic change in this audit.

`extension ... --worker <worker>` remains correct because Extension is a separate domain selecting a target Worker.

## UX follow-ups, not removals

Three areas should be improved without deleting the underlying primitives:

1. **Product onboarding:** add `queqiao setup` as orchestration over Gateway setup, local Worker setup, Workspace authority, enrollment, and lifecycle. It must not introduce a Cluster runtime role or merge Gateway and Worker.
2. **Interactive Worker/Workspace management:** provide a TUI for policy/configuration while retaining granular commands as scriptable primitives where useful.
3. **Doctor closure:** completed on this branch. Root `doctor` enumerates named Gateway/Worker roles and aggregates Extension Hub integrity; Gateway-owned manifest/tool diagnostics require an explicit Gateway selector.

## Verification

Final Windows validation after command audit and named-role Doctor closure:

- `npm run typecheck` — PASS
- `npm test` — 48 files, 244 tests passed
- `npm run test:security` — 39 files, 179 tests passed
- `npm run build:package` — PASS
- `git diff --check` — PASS
- focused Doctor/layout/command-surface tests — 55 tests passed
- production/schema scan — no active `runtimeConfig.discovery` or `worker discovery` implementation remains; the only legacy `discovery` config fixture is the regression proving stale state is stripped

## Resulting primary mental model

```text
queqiao
├─ gateway
├─ worker
├─ extension
└─ doctor
```

`migrate` remains hidden maintenance. Product-level `queqiao setup` is the next onboarding layer, not a new runtime role.
