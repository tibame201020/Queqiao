# Worker Ownership Closure — 2026-08-28

> **Follow-up (2026-08-29):** The ownership closure remains valid, but the proposed next step
> changed. Queqiao will not add a generic product-level `queqiao setup` as the integrated UX
> layer; the planned integrated operator surface is a Workstation TUI built on the same
> independent Gateway / Worker / Workspace / Extension management primitives. Historical
> references to `queqiao setup` below are retained as decision history.

## Goal

Verify that Queqiao's bottom model matches the intended product model before adding product-level onboarding such as `queqiao setup`.

The invariant is:

- Gateway owns public MCP ingress, OAuth, routing, public composition, and Worker membership.
- Worker owns Workspace authority, Workspace policy, native execution, and extension attachment/execution.
- Extension Hub is an environment-local package/control plane; attachment to a Worker is execution intent.
- Generic filesystem/project discovery is not a Queqiao configuration domain. Extensions/clients perform domain discovery inside an explicitly authorized Workspace using bounded Core primitives.

## Audit result

### Workspace authority — PASS

Each named Worker resolves to its own role-local runtime layout. Workspace CLI operations resolve to that named Worker config, and the Worker loads the Workspace catalog from its own config file.

The Worker performs the final authority checks for Workspace identity, filesystem containment, profile restrictions, tool policy, command allowlists, capability contracts, shell policy, and process execution containment.

Gateway may perform a live policy preflight using Worker-reported descriptors, but the Worker re-validates every invocation. Gateway therefore cannot grant or broaden Workspace authority.

### Workspace storage shape — ACCEPTED

The named Worker's `config.yaml` stores role state as sibling fields:

```yaml
worker: ...
workspaces: ...
extensions: ...
```

This is a storage schema, not a product-ownership hierarchy. No schema migration is justified solely to make the YAML visually nested.

### CLI ownership routing — FIXED

The audit found two genuine ownership bypass risks in the old CLI plumbing:

1. several Workspace/policy handlers relied on documented Worker selection without centrally enforcing that a named Worker was selected;
2. an undocumented generic `--file` override could replace the role-selected config path.

The fix requires a named Worker for Worker-owned configuration before any config I/O, rejects generic `--file` overrides, keeps help rendering ahead of ownership assertions, and includes ownership-layout tests in the security gate.

### Generic discovery-root state — REMOVED

The old `discovery.roots` configuration originally supported repository-oriented Workspace candidate scanning. After ADR-0009 moved repository/project interpretation outside Core, no runtime, Worker, Gateway, Git extension, or Extension Host consumer remained. Only CLI read/write code and fixtures still referenced the state.

The obsolete surface and state are removed:

- no `queqiao worker discovery ...` command;
- no `runtimeConfig.discovery` field;
- no discovery-root block in `config.example.yaml`;
- no resource/lifecycle fixture dependency;
- legacy config containing an unknown `discovery` field is accepted by the schema and the field is dropped from the parsed runtime config.

Bounded Core filesystem primitives such as list/search remain. Repository, worktree, project, skill, and framework discovery stays with the owning extension/client and never grants Workspace authority.

### Extension attachment/execution — PASS

Extension Hub installation is environment-local. `attach` and `detach` mutate the selected named Worker's config. The Worker hot-reloads attachments from its own config and executes extension tools inside the Worker authority envelope.

Gateway-side extension metadata is used for public MCP composition/manifest exposure only. Gateway does not host Worker extension execution and does not own attachment state.

### Gateway routing — PASS

Gateway discovers Workspace routes by querying registered Workers. It does not persist Workspace authority as Gateway truth. Workspace operations are routed to the matching Worker, where final policy and filesystem/process checks occur.

## Verification

Final validation after ownership closure and generic discovery-state removal:

- `npm run typecheck` — PASS
- `npm test` — 48 files, 240 tests passed
- `npm run test:security` — 39 files, 175 tests passed
- `npm run build:package` — PASS
- `git diff --check` — PASS

## Conclusion

The bottom model is aligned with the intended product model:

```text
Queqiao
├─ Gateway
│  └─ ingress / OAuth / routing / Worker membership
└─ Worker
   ├─ Workspaces
   │  └─ policy
   ├─ native execution
   └─ attached Extensions
```

No `cluster` runtime role, generic discovery-root resource, or config-schema nesting migration is required.

This closes the ownership prerequisite for designing product-level `queqiao setup` as orchestration over the existing Gateway / Worker / Workspace / enrollment primitives.
