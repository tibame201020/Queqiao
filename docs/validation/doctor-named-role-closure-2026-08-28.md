# Doctor Named-Role Closure — 2026-08-28

## Goal

Align `queqiao doctor` with Queqiao's named Gateway/Worker runtime model. The former implementation read the legacy/default runtime layout, which could report the wrong deployment state when real installations used named roles such as separate Gateway and Worker configs.

## Model

`queqiao doctor` is a whole-product diagnostic surface. It does not own runtime authority and does not merge Gateway and Worker roles.

It now:

- enumerates locally configured named Gateways;
- enumerates locally configured named Workers;
- reads each role's own role-local config;
- checks each role through the existing lifecycle health/identity primitives;
- includes Gateway routing/liveness projection;
- includes Extension Hub and Worker attachment integrity;
- reports a combined whole-system result.

Gateway-owned composition diagnostics require an explicit Gateway selector:

```text
queqiao doctor manifest show --gateway <name>
queqiao doctor tool explain <tool> --gateway <name>
```

`queqiao doctor paths` reports named-role configuration roots and the Extension Hub location rather than implying one legacy default config is the deployment.

## Packaged acceptance

A packaged CLI build was exercised against the machine's existing named-role runtime without modifying runtime configuration.

Verified behavior:

- `doctor paths` reported named-role mode;
- root `doctor` discovered the configured named Gateway and named Worker independently;
- Gateway health/routing was resolved through the named Gateway config;
- Worker health was resolved through the named Worker config;
- Extension Hub integrity was included in the root result;
- `doctor manifest show` without `--gateway` was rejected;
- `doctor manifest show --gateway <configured-gateway>` succeeded;
- `doctor tool explain shell --gateway <configured-gateway>` succeeded.

No machine-specific paths, endpoint hostnames, credentials, tokens, or secret values are recorded in this evidence.

## Verification

Final validation after named-role Doctor closure:

- `npm run typecheck` — PASS
- `npm test` — 48 files, 244 tests passed
- `npm run test:security` — 39 files, 179 tests passed
- `npm run build:package` — PASS
- `git diff --check` — PASS
- focused Doctor/layout/command-surface tests — 55 tests passed

## Security and manifest impact

- no public MCP tool/schema change;
- no Core Manifest revision change;
- no OAuth/CSP change;
- no Workspace authority change;
- no process/network policy change;
- no runtime config migration;
- diagnostics remain local CLI behavior.
