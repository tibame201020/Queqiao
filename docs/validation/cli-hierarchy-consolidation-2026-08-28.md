# CLI hierarchy consolidation acceptance — 2026-08-28

## Scope

This change reorganizes the public CLI command hierarchy without changing command handlers, runtime configuration semantics, Gateway/Worker lifecycle behavior, Workspace authority, Extension Hub behavior, OAuth, Worker-authoritative policy enforcement, or the public MCP manifest.

Canonical top-level help is limited to:

- `gateway`
- `worker`
- `extension`
- `doctor`

The new hierarchy is normalized to the existing handler routes before runtime layout resolution and handler dispatch. The former flat public command paths are intentionally rejected so the CLI exposes one canonical grammar.

## Canonical hierarchy introduced

Gateway-owned Worker membership:

- `queqiao gateway workers list`
- `queqiao gateway workers update`
- `queqiao gateway workers remove`

Worker-owned Workspace authority and policy:

- `queqiao worker workspace add|list|remove`
- `queqiao worker workspace profile set`
- `queqiao worker workspace tool allow|deny`
- `queqiao worker workspace command allow|deny`
- `queqiao worker workspace permissions show`

Worker-local discovery surface:

- `queqiao worker discovery list|add|remove --worker <worker>`

The Worker selector is required so discovery state resolves to that named Worker's role-local config rather than the default/global runtime layout.

Diagnostics consolidated under Doctor:

- `queqiao doctor`
- `queqiao doctor extension`
- `queqiao doctor manifest show`
- `queqiao doctor tool explain <tool>`
- `queqiao doctor paths`

Extension lifecycle remains unchanged:

- `install`
- `uninstall`
- `attach`
- `detach`
- `list`
- `show`

Gateway/Worker service lifecycle also remains unchanged, including `serve` and `serve --bg`.

## Removed flat routes

The previous flat routes are intentionally rejected and tested, including:

- `worker list|update|remove`
- `workspace add|list|remove`
- `profile set`
- `tool allow|deny|explain`
- `command allow|deny`
- `permissions show`
- `discovery list|add|remove`
- `manifest show`
- `extension doctor`
- `config paths`

Each rejected route returns a concise replacement pointing to the canonical hierarchy. This is intentionally a breaking CLI cleanup; scripts using the former flat grammar must migrate.

## Verification

Local Windows validation passed:

- `npm run typecheck`
- `npm test` — 48 files, 247 tests passed
- `npm run test:security` — 39 files, 178 tests passed
- `npm run build:package`
- `git diff --check`
- `apps/cli/src/command-surface.test.ts` — 41 hierarchy/removal tests passed
- `scripts/cli-demo/record.ps1` — PowerShell parser validation passed after canonical command updates
- packed-artifact smoke — `queqiao doctor paths` passed from a fresh local install
- living-artifact scan — no removed public CLI spelling remains outside historical validation/changelog evidence

Manual help inspection also confirmed:

- root help exposes only Gateway, Worker, Extension, and Doctor
- `gateway workers --help` exposes membership operations
- `worker workspace --help` exposes Workspace operations/policy
- `doctor --help` exposes the consolidated diagnostic hierarchy

## Public MCP impact

None.

No public MCP tool name, schema, manifest revision, Gateway routing contract, Worker protocol contract, Extension SDK contract, or connector binding changes in this CLI-only hierarchy refactor.

## Clean-room review notes

No blocker was found in the hierarchy normalization approach. The implementation is intentionally a thin command-surface adapter over existing handlers rather than a second implementation of management behavior.

The following are deliberately deferred because changing them would exceed the hierarchy-only scope:

1. `worker workspace ...` still uses the existing `--worker <name>` selector. Removing that redundancy or replacing it with a role-level selector is a later CLI semantics change.
2. `worker discovery ...` retains the existing discovery configuration/layout behavior. Named-Worker discovery semantics should be designed together with the future interactive management/TUI flow, not silently changed here.
3. Parser strictness, richer nested option validation, and migration of complex Workspace/Worker settings into interactive TUI are separate follow-up work.

Historical ADR and validation documents retain the command spellings that were actually verified at their original dates. Current README and current contract documentation use the canonical hierarchy.
