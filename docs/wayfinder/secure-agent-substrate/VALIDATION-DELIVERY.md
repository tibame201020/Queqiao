# Validation and Delivery Strategy — Secure Agent Substrate

Status: required delivery invariant before implementation slices are promoted.

## Objective

Queqiao is used to develop Queqiao itself. A candidate build must therefore never replace or rebuild the currently working stable runtime merely so the candidate can be tested. Losing the stable collaboration path would also remove the primary recovery path.

The delivery model is blue/green:

```text
Development through stable connector
        |
        v
Stable Gateway + stable native Workers -------------- remains untouched
        |
        +--> isolated implementation worktree
                  |
                  v
            candidate package
                  |
                  v
Shadow Gateway + shadow Windows Worker + shadow WSL/Linux Worker
        |
        v
separate public endpoint + separate MCP connector binding
```

## Hard invariants

1. The stable bundle is not rebuilt, replaced, or promoted as a side effect of candidate validation.
2. Candidate source/build output lives in a physically separate Git worktree from the repository path used by the stable runtime.
3. Stable and shadow runtimes use different Gateway ports, Worker ports, runtime configuration files, Gateway state directories, logs, OAuth/JWT secrets, and Worker tokens.
4. Shadow runtime state and secrets remain outside the repository and are never committed.
5. The shadow Gateway uses shadow Workers for end-to-end acceptance. A new Gateway pointed only at stable Workers is useful as a narrow Gateway test, but is not candidate release acceptance.
6. Windows and WSL/Linux must both remain represented in final candidate acceptance when the release slice affects Worker protocol, filesystem/process behavior, extension Worker hosting, or cross-environment routing.
7. Candidate validation must use a distinct public MCP endpoint and a distinct connector binding when its public manifest/schema differs from the stable connector.
8. Promotion is explicit. `IMPLEMENTED`, `CANDIDATE VERIFIED`, and `PROMOTION APPROVED` are separate states.
9. A candidate failure must leave the stable connector usable for diagnosis and repair.
10. Historical stable validation evidence is never rewritten to claim candidate behavior.

## Stable-path protection rule

Before any operation that could affect the stable Gateway, stable Workers, or the stable public tunnel mapping:

1. capture current stable local health;
2. capture current public health when the public route is involved;
3. identify the exact restore command/state before making the change;
4. prefer a per-resource change over a global reset/restart;
5. immediately verify stable health after the operation;
6. verify one real MCP call through the stable ChatGPT connector after public-routing changes;
7. if stable becomes unavailable, restore stable first before continuing candidate work.

Operations that do not need to touch stable state must not do so.

## Shadow runtime isolation

The shadow runtime may initially reuse the same stable bundle only for a lane preflight proving that parallel services can coexist. Once implementation starts, candidate services must execute the bundle produced by the isolated implementation worktree.

A shadow configuration must have its own:

- Gateway listen port;
- Windows Worker listen port;
- WSL/Linux Worker listen port;
- Gateway state directory;
- OAuth approval secret;
- JWT signing secret;
- per-Worker authentication tokens;
- logs and transient service/process identity;
- public endpoint;
- client connector binding.

The stable and shadow runtimes may observe the same broad Workspace roots during read-only topology preflight. Mutation/process acceptance should use dedicated validation Workspaces so two stacks do not intentionally race on the same files or processes.

## Public endpoint strategy

The public tunnel configuration must be additive. A shadow endpoint must use a separate listener/route rather than replacing the stable route. Global tunnel reset is forbidden during normal candidate validation.

If the tunnel implementation supports independent listeners, candidate teardown removes only the candidate listener and leaves the stable listener intact.

## Acceptance ladder

### Gate A — lane preflight

Use the current stable code in both stacks to prove infrastructure isolation before candidate code exists.

Acceptance:

- stable Gateway and both stable native Workers remain healthy;
- shadow Gateway and both shadow native Workers run concurrently;
- both Gateways see Windows and WSL/Linux online;
- the stable public route remains healthy after adding the shadow public route;
- the shadow public route reaches only the shadow Gateway;
- a real MCP call through the stable ChatGPT connector still succeeds after the public-route change;
- shadow teardown can be performed without resetting/restarting the stable stack.

### Gate B — candidate local/integration

Run candidate unit, integration, security, and package verification from the isolated implementation worktree.

Required repository checks remain:

```text
npm run typecheck
npm test
npm run test:security
npm run build:package
git diff --check
```

Run additional slice-specific gates such as `npm run security:gate`, cluster tests, protocol compatibility tests, or adversarial extension/process tests as required by TICKETS.md.

### Gate C — candidate shadow runtime

Replace only the shadow runtime bundle with the candidate bundle. Do not modify the stable runtime.

Acceptance:

- shadow Gateway and shadow Workers start from candidate artifacts;
- Windows and WSL/Linux routing passes;
- slice-specific behavior passes through the shadow Gateway;
- stable connector remains operational throughout the candidate test.

### Gate D — real-client acceptance

For an intentional public manifest/schema revision, create a new client connector binding against the shadow public endpoint. Do not mutate the existing stable connector binding to test the new schema.

Acceptance includes actual schema discovery, authorization, tool invocation, native Windows/WSL behavior, and relevant permission isolation through the new connector.

### Gate E — promotion

Promotion requires explicit approval after candidate verification. Promotion is a separate operational change with its own rollback plan. Candidate success alone must not automatically replace stable runtime artifacts.

## Failure classification

- **Candidate-only failure:** stable remains healthy. Diagnose through stable Queqiao and repair the candidate worktree.
- **Shadow infrastructure failure:** shadow cannot start or route, stable remains healthy. Repair/teardown shadow only.
- **Stable transient interruption:** immediately restore stable, record duration/cause, prove stable connector recovery, then decide whether the validation action is safe to repeat.
- **Unbounded stable-risk operation:** do not execute until replaced with a bounded/additive operation or a tested rollback procedure.
