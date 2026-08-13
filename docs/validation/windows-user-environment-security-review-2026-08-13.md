# Windows user environment security review — 2026-08-13

## Scope

Pre-change adversarial review for GitHub issue #4. The proposed change is limited to the native Windows child-process environment used by `run` and `shell`. No MCP schema, Worker protocol, workspace schema, command policy, filesystem containment, or Gateway behavior changes are in scope.

## Baseline reviewed

The review was performed against the frozen Security Baseline v1 threat model, threat matrix, ADR 0005 native process runtime, and the current `packages/process-runtime` implementation/tests.

Pre-change `npm run security:gate` passed on `main` at `218403cc4228f2fccc00d3ddfb3f8eafca271b6d`:

- 23 security test files passed;
- 92 security tests passed;
- production dependency audit reported 0 vulnerabilities.

## Security boundary analysis

The existing runtime already uses a fixed environment allowlist rather than inheriting `process.env`. POSIX children receive `HOME`, allowing explicitly allowlisted native CLIs to discover normal per-user configuration. Windows children currently omit the equivalent user-location variables, so authenticated/user-configured Windows CLIs cannot discover their standard configuration.

The minimal correction is to add only these Windows user-location keys to the fixed allowlist:

- `USERPROFILE`
- `APPDATA`
- `LOCALAPPDATA`

These values are location metadata, not credential values. Credentials remain in CLI-owned files or OS credential stores and are not copied into the child environment or Queqiao responses.

Queqiao's threat model treats the Gateway/Worker as trusted components and local administrative configuration as local authority. Local compromise of the same operating-system account is explicitly outside the remote MCP adversary boundary. Therefore inheriting these specific values from the trusted Worker process does not create a new remote input channel.

## Authority effect

An explicitly allowlisted CLI may begin using the operating-system user's existing authenticated configuration once these location variables are available. This is an intentional consequence of command authorization, not an implicit privilege bypass. Administrators must treat `commands.allow: [gh]` (and equivalent authenticated CLIs) as permission to use that CLI with the OS user's normal identity/configuration.

This matches the existing POSIX model where `HOME` is already inherited by allowlisted commands.

## Required adversarial regression

The implementation is acceptable only if tests prove both sides of the boundary in the same child-process probe:

1. platform user-location variables are present (`USERPROFILE`/`APPDATA`/`LOCALAPPDATA` on Windows; existing `HOME` behavior remains on POSIX);
2. an arbitrary parent variable such as `QUEQIAO_TEST_SECRET` is absent from the child environment.

Existing tests/gates must continue to prove:

- no shell injection through `run`;
- exact local command allowlist enforcement;
- canonical workspace cwd containment;
- timeout/output/cancellation/concurrency limits;
- Worker-authoritative policy checks.

## Auditor verdict

**PASS WITH EXPLICIT RESIDUAL-RISK DOCUMENTATION.**

No Critical/High blocker was identified for the fixed-key allowlist change. The implementation must not switch to full `process.env` inheritance, add credential-specific environment variables, add CLI-specific token/config injection, or weaken command/workspace policy.

## Post-change local validation

The implementation was then applied on isolated branch `fix/windows-user-environment` and validated before any Shadow deployment:

- focused `packages/process-runtime` tests: 9/9 PASS;
- `npm run typecheck`: PASS;
- security suite: 23 files / 93 tests PASS;
- production dependency audit: 0 vulnerabilities;
- full suite: 31 files / 119 tests PASS;
- cluster suite: 4 files / 15 tests PASS;
- `npm run build:package`: PASS;
- `git diff --check`: PASS.

The new adversarial test proves in one child-process probe that the standard platform user-location variables are preserved while an arbitrary `QUEQIAO_TEST_SECRET` parent variable is absent from the child environment.

## Shadow real-client acceptance

The candidate Windows Worker was deployed only to the isolated Shadow lane. Shadow Gateway and WSL Worker remained running independently; stable was not restarted or modified.

The real `Queqiao Shadow` connector verified:

- the Windows Shadow Worker process executed the candidate bundle from the isolated feature worktree;
- `USERPROFILE`, `APPDATA`, and `LOCALAPPDATA` were present in a child `node.exe` process;
- `QUEQIAO_TEST_SECRET` was absent from that same child probe;
- `gh auth status --hostname github.com` returned exit code 0 and discovered the existing keyring-backed login without `GH_CONFIG_DIR` or credential injection;
- an unallowlisted `whoami.exe` invocation remained rejected with `command_denied`;
- both Windows and WSL Shadow environments remained online;
- Core Manifest Revision remained 6, public tool count remained 17, Worker Protocol remained 2.0, and the deployment manifest fingerprint remained unchanged.

This confirms that the change restores standard Windows CLI config discovery without broadening arbitrary environment inheritance, command policy, MCP schema, or workspace containment.

## CI acceptance-race hardening

The first PR Windows full-suite run exposed an existing timing race in the synchronous cancellation test: it aborted after a fixed 50 ms delay, which can occur before native process acceptance on a loaded Windows runner. The production cancellation semantics were not changed. The test was made deterministic by having the child write an acceptance marker and aborting only after the marker is observable. The focused process-runtime suite and subsequent full local suite passed after this test-only hardening.
