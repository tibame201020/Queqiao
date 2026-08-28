# Worker ownership closure — 2026-08-28

## Goal

Verify that Queqiao's bottom model matches the intended product model before adding product-level onboarding such as `queqiao setup`.

The intended invariant is:

- Gateway owns public MCP ingress, OAuth, routing, public composition, and Worker membership.
- Worker owns Workspace authority, Workspace policy, local discovery scope, native execution, and extension attachment/execution.
- Extension Hub is an environment-local package/control plane; attachment to a Worker is execution intent.

## Audit result

### Workspace authority — PASS

Each named Worker resolves to its own role-local runtime layout. Workspace CLI operations resolve to that named Worker config, and the Worker loads the Workspace catalog from its own config file.

The Worker performs the final authority checks for:

- Workspace existence and identity;
- filesystem containment;
- profile restrictions;
- tool allow/deny/explicit policy;
- command allowlist;
- capability contracts;
- shell step-up/explicit policy;
- process execution containment.

Gateway may perform a live policy preflight using Worker-reported descriptors, but the Worker re-validates every invocation. Gateway therefore cannot grant or broaden Workspace authority.

### Workspace storage shape — ACCEPTED

The named Worker's `config.yaml` currently stores these as sibling fields:

```yaml
worker: ...
workspaces: ...
discovery: ...
extensions: ...
```

This is a storage schema, not a product-ownership hierarchy. No schema migration is justified solely to make the YAML visually nested.

### CLI ownership routing — FIXED

Audit found three related CLI ownership gaps around Worker-owned configuration:

1. canonical `queqiao worker discovery ...` normalized to the legacy discovery handler, but the CLI layout resolver did not include `discovery`, so it could fall through to the default/global runtime layout;
2. several Workspace/policy handlers relied on the documented `--worker` spelling without centrally enforcing that a named Worker had actually been selected;
3. an undocumented generic `--file` override could replace the role-selected config path and therefore bypass the ownership-derived layout.

The fix:

- requires a named Worker for all Worker-owned Workspace, policy, permissions, and discovery operations before any config I/O;
- routes those operations to that named Worker's role-local config;
- rejects generic `--file` config overrides so role ownership determines the config layout;
- keeps help rendering ahead of ownership assertions, so subcommand help remains available without runtime selectors;
- adds ownership-layout tests for every Worker-owned route and includes them in the security gate.

Discovery remains read-only search scope and never grants Workspace authority.

### Extension attachment/execution — PASS

Extension Hub installation is environment-local. `attach` and `detach` mutate the selected named Worker's config. The Worker hot-reloads attachments from its own config and executes extension tools inside the Worker authority envelope.

Gateway-side extension metadata is used only for public MCP composition/manifest exposure. Gateway does not host Worker extension execution and does not own attachment state.

### Gateway routing — PASS

Gateway discovers Workspace routes by querying registered Workers. It does not persist Workspace authority as Gateway truth. Workspace operations are routed to the matching Worker, where final policy and filesystem/process checks occur.

## Verification

Local Windows validation passed after the ownership fix:

- `npm run typecheck`
- `npm test` — 48 files, 247 tests passed
- `npm run test:security` — 39 files, 178 tests passed; `command-layout.test.ts` is included in the security gate
- `npm run build:package`
- packaged CLI acceptance: specific help renders, missing `--worker` is rejected, and `--file` is rejected
- `git diff --check`
- current-document scan found no Worker discovery command missing its explicit Worker selector

## Conclusion

The bottom model is aligned with the intended product model after closing the Worker-owned CLI routing gaps:

```text
Queqiao
├─ Gateway
│  └─ ingress / OAuth / routing / Worker membership
└─ Worker
   ├─ Workspaces
   │  └─ policy
   ├─ discovery
   ├─ native execution
   └─ attached Extensions
```

No `cluster` runtime role and no config-schema nesting migration are required.

This closes the ownership prerequisite for designing product-level `queqiao setup` as orchestration over the existing Gateway / Worker / Workspace / enrollment primitives.
