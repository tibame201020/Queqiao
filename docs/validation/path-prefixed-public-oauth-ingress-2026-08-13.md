# Path-Prefixed Public OAuth Ingress Validation

- Date: 2026-08-13
- Result: PASS
- Scope: schema-neutral Gateway/OAuth ingress compatibility for a path-prefixed public base URL
- Public MCP manifest impact: none

## Purpose

Allow a stable and a shadow Queqiao Gateway to share one standard HTTPS 443 endpoint using path routing while preserving independent OAuth issuers/resources and the frozen MCP tool contract.

The validated public layout is conceptually:

```text
https://<public-host>/              -> stable Gateway
https://<public-host>/shadow-r5/   -> shadow Gateway
```

RFC 9728 / RFC 8414 path-aware metadata requests for the shadow issuer are routed explicitly to the shadow Gateway. Runtime routing configuration and hostnames remain external to the repository.

## Gateway changes

- Public base URLs are normalized as directory bases with a trailing slash.
- A path-prefixed base therefore derives its MCP resource beneath the same prefix rather than falling back to the origin root.
- The OAuth authorization form posts to the path-prefixed authorization endpoint instead of a hard-coded root `/oauth/authorize` path.
- Existing root-mounted deployments preserve their previous effective URLs.

## Regression evidence

Targeted tests verify:

- `https://example.invalid/shadow-r5` normalizes to `https://example.invalid/shadow-r5/`;
- the derived MCP resource is `.../shadow-r5/mcp`;
- protected-resource metadata advertises the prefixed resource and authorization server;
- authorization-server metadata advertises prefixed authorize/token/register endpoints;
- unauthenticated MCP challenge advertises path-scoped resource metadata;
- the approval form action preserves `/shadow-r5/oauth/authorize`.

## Public ingress acceptance

Using the official MCP client SDK against the real standard-443 shadow route:

- RFC path-aware protected-resource discovery succeeded;
- RFC path-aware authorization-server discovery succeeded;
- Dynamic Client Registration succeeded;
- PKCE S256 authorization succeeded;
- the path-prefixed approval form action was preserved;
- authorization-code token exchange succeeded;
- authenticated MCP connection succeeded;
- `tools/list` returned the frozen 17-tool candidate contract.

The stable root endpoint remained healthy throughout the routing and shadow Gateway restart.

## Release gates

After the implementation change:

- typecheck: PASS;
- full test suite: 31 files / 117 tests PASS;
- security suite: 23 files / 91 tests PASS;
- cluster suite: 4 files / 15 tests PASS;
- runtime dependency audit: 0 vulnerabilities;
- package build: PASS;
- `git diff --check`: PASS after formatting cleanup.

The path-base regression test is part of `test:security`.

## Manifest statement

This change does not add, remove, rename, or alter any public MCP tool schema. Core Manifest Revision 5 and the already-frozen 17-tool deployment manifest remain unchanged.
