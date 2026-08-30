# Gateway info v0.8.3 validation

Date: 2026-08-30

## Scope

This evidence covers the v0.8.3 connector-handoff CLI addition:

- `queqiao gateway info`
- `queqiao gateway info --detail`
- `queqiao gateway info --copy-url`
- `queqiao gateway info --copy-secret`
- the existing `--gateway <gateway>` selector contract
- README, CLI reference, operations documentation, and real PTY onboarding media

No public MCP tool schema changes are part of this release.

## Security contract

The Gateway approval secret remains in the private runtime secret file referenced by the named Gateway configuration.

- Default `gateway info` reports approval-secret availability without returning the secret.
- `--detail` is an explicit local reveal intended for manual connector setup. Its output must not be pasted into logs or issue reports.
- `--copy-secret` copies the secret without returning or echoing it in the command result.
- `--copy-url` copies only the derived MCP URL.
- Passing both copy options is rejected.
- MCP URLs are derived from the configured public Gateway URL after removing user-info, query, and fragment material.

The real PTY documentation recording uses an isolated synthetic Gateway and synthetic approval secret. No Stable or Shadow production approval secret is read into documentation artifacts.

## Selector and packaged CLI contract

`gateway info` is a canonical CLI leaf and uses the same named-Gateway selector behavior as other Gateway commands:

- interactive terminal, zero configured Gateways: fail with setup guidance;
- interactive terminal, one configured Gateway: select it automatically;
- interactive terminal, multiple configured Gateways: prompt with the shared selector;
- non-interactive and JSON callers: require `--gateway <gateway>`.

Packaged acceptance verifies the default JSON result contains the Gateway name, derived MCP URL, and approval-secret availability while omitting the secret. `--detail --json` is separately verified as the explicit reveal path.

## Human presentation

The default human renderer keeps the two connector values easy to find while protecting the secret:

- MCP URL appears on its own line.
- Approval secret is marked hidden by default.
- `--detail` places the approval secret on its own line for local selection.
- clipboard actions report success without echoing the copied URL or secret.

## Interactive documentation evidence

The onboarding set contains seven same-series PTY recordings:

1. Gateway setup
2. Gateway connector info
3. Worker and first Workspace access
4. named-instance selector
5. Extension attachment
6. runtime start
7. Worker enrollment

The recordings are produced from the same-revision staged npm package through a real WSL PTY and rendered with the pinned `agg` renderer. All README interactive GIFs use the same dimensions and omit the GIF infinite-loop extension so playback stops on the held final frame.

The Gateway-info recording ends with synthetic MCP URL and approval secret values on separate selectable lines.

## Automated evidence

The v0.8.3 candidate passed:

- TypeScript typecheck: PASS
- full test suite: 588/588 PASS
- security gate: 502/502 PASS
- packaged CLI acceptance: PASS
- Gateway-info focused tests: 4/4 PASS
- human presentation regression: PASS
- canonical command-surface and production-dispatch coverage: PASS
- isolated package build: PASS
- packaged `gateway info --help`: PASS
- README/visual regression: PASS
- seven interactive GIF magic/no-loop checks: PASS
- `git diff --check`: PASS

`apps/cli/src/gateway-info.test.ts` is explicitly included in `test:security` because this command handles the local approval secret.

## Release decision

The v0.8.3 candidate is acceptable for PR, cross-platform CI, and release publication after the remaining repository-level link/privacy/diff review and required GitHub checks pass.
