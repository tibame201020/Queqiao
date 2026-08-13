# Shadow Stack / Blue-Green Validation Preflight

- Date: 2026-08-13
- Result: PASS for parallel runtime/public-route isolation
- Real shadow ChatGPT connector binding: pending
- Source bundle used for this lane preflight: the current stable bundle for both stacks

## Purpose

Prove that Queqiao can preserve the working stable collaboration path while a second complete Windows/WSL shadow stack is brought online for future candidate verification.

This is infrastructure acceptance evidence only. It does not claim that any Secure Agent Substrate feature has been implemented.

## Stable baseline

Before shadow startup:

- stable Gateway: healthy;
- stable Windows Worker: healthy;
- stable WSL Worker: healthy;
- stable Gateway reported both Windows and WSL online;
- the existing public Funnel listener routed HTTPS 443 to the stable Gateway;
- public stable `/health` returned HTTP 200.

No stable service was stopped or restarted during this preflight.

## Shadow topology used

```text
shadow public HTTPS :8443
        |
        v
shadow Gateway :7675
        |
        +--> shadow Windows Worker :7678
        |
        +--> shadow WSL Worker :7679
```

The shadow runtime used independent external runtime configuration, Gateway state, JWT/OAuth secrets, Worker tokens, and logs. No shadow runtime material was stored in the repository.

The WSL shadow Worker ran as a separate transient user-systemd unit (`queqiao-shadow-worker.service`); the stable `queqiao-worker.service` remained active concurrently.

## Local parallel-runtime evidence

Observed concurrently:

- stable Gateway on 7575;
- stable Windows Worker on 7576;
- stable WSL Worker reachable through 7577;
- shadow Gateway on 7675;
- shadow Windows Worker on 7678;
- shadow WSL Worker reachable through 7679.

Shadow Gateway `/health` reported:

- Windows online with the expected configured Workspace count;
- WSL online with the expected configured Workspace count.

Stable Gateway `/health` continued to report both environments online.

## Public-route change and rollback discipline

Before changing Funnel configuration, the current Funnel JSON was captured outside the repository and the stable public `/health` was verified as HTTP 200.

The shadow listener was added specifically on HTTPS 8443. No global Funnel reset was used.

Immediately after the change:

- Funnel configuration still contained HTTPS 443;
- Funnel configuration also contained HTTPS 8443;
- stable local `/health` returned HTTP 200;
- stable public HTTPS 443 `/health` returned HTTP 200;
- shadow public HTTPS 8443 `/health` returned HTTP 200.

The Tailscale CLI reported that the shadow listener can be removed independently with the matching per-port `off` command. The predeclared emergency restore for an unexpected loss of the stable listener was to restore HTTPS 443 directly to the stable Gateway rather than resetting Funnel globally. The emergency restore was not needed.

## Real stable-connector evidence

After the public-route change, the existing ChatGPT Queqiao Revision connector successfully executed `list_workspaces` and returned both Windows and WSL environments online.

This proves that adding the shadow Funnel listener did not break the active stable ChatGPT collaboration path in this preflight.

## Candidate implementation isolation requirement

The preflight intentionally used the current stable bundle for both stacks to prove the lane itself.

Feature implementation must not build in the filesystem location used by the stable runtime. Candidate source/build output must move to a physically separate Git worktree before production code changes or package builds begin. Candidate verification then replaces only the shadow bundle, not the stable bundle.

## Remaining Gate A item

A separate ChatGPT connector must still be bound to:

```text
https://<funnel-host>:8443/mcp
```

That connector must complete OAuth and real MCP discovery/invocation without modifying the existing stable connector. Until that is performed, this document proves parallel runtime and public-route isolation, but not the second ChatGPT connector binding itself.
