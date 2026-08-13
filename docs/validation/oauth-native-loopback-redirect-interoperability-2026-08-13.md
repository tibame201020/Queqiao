# OAuth native loopback redirect interoperability — 2026-08-13

## Trigger

During the Generic MCP Client Interoperability Matrix, the official MCP Inspector CLI exposed an OAuth interoperability defect before the MCP transport was reached: its native-client loopback callback used a loopback IP with a port, while Queqiao's Dynamic Client Registration validator required an exact origin match against the administrator redirect-origin allowlist.

The candidate allowlist intentionally grants a loopback IP origin without granting arbitrary non-loopback HTTP origins. Rejecting the same loopback IP solely because the native client selected a port prevents standards-conformant native clients from registering a callback.

## Security-preserving behavior

Queqiao now distinguishes native loopback IP redirect origins from ordinary origins during Dynamic Client Registration:

- an administrator must still explicitly allow the portless loopback IP origin;
- only `127.0.0.1` and `[::1]` receive the dynamic-port allowance;
- the allowance applies only to HTTP loopback IP literals;
- `localhost`, other loopback-like addresses, non-loopback HTTP origins, and normal HTTPS origins retain exact-origin matching;
- username/password fragments and URI fragments remain rejected;
- after registration, the full redirect URI remains exact-bound to the OAuth client, so changing the registered callback port during authorization is rejected;
- PKCE, MCP resource binding, approval-secret verification, code single-use, refresh-token rotation, and MCP Origin validation are unchanged.

The IPv6 comparison also uses the URL parser's actual hostname representation (`[::1]`).

## Regression evidence

Security regression tests prove:

- registration accepts an explicitly permitted IPv4 loopback IP with a native-client port;
- registration accepts an explicitly permitted IPv6 loopback IP with a native-client port;
- an ungranted `localhost` port is rejected;
- a different IPv4 address is rejected;
- authorization succeeds for the exact registered callback;
- the same client cannot switch to another loopback port at authorization time.

## Release gates

After the interoperability fix:

- full suite: 31 files / 118 tests PASS;
- security suite: 23 files / 92 tests PASS;
- cluster suite: 4 files / 15 tests PASS;
- `npm run security:gate`: PASS;
- production dependency audit: 0 vulnerabilities;
- package build: PASS;
- `git diff --check`: PASS.

The public MCP tool manifest is unchanged by this OAuth interoperability fix.
