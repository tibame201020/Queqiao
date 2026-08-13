# MCP Adapter Compatibility Validation

- Date: 2026-08-13
- Result: PASS for automated and public shadow SDK acceptance
- Branch: `feat/secure-agent-substrate-implementation`
- Ticket: MCP adapter compatibility implementation
- Core public MCP tool-schema impact: none; Revision 4 tool names and input schemas remain unchanged
- Separate shadow ChatGPT connector binding: pending

## Purpose

Implement the bounded MCP compatibility window selected by `docs/research/mcp-compatibility-window-2026-08-13.md` while keeping MCP transport/version concerns inside the Gateway adapter boundary and preserving the stable Queqiao collaboration path.

## SDK migration

The Gateway and repository MCP smoke clients were migrated from the monolithic `@modelcontextprotocol/sdk@1.30.0` package to the official TypeScript SDK v2 split packages, all exactly pinned to `2.0.0`:

- `@modelcontextprotocol/server`;
- `@modelcontextprotocol/client`;
- `@modelcontextprotocol/node`;
- `@modelcontextprotocol/express`.

The monolithic v1 package is absent from source dependencies and the package lock after migration. MCP SDK imports remain outside Core packages.

## Explicit compatibility window

Queqiao owns and explicitly pins this revision list:

```text
2026-07-28
2025-11-25
2025-06-18
2025-03-26
```

The adapter does not inherit arbitrary future SDK defaults.

Automated negative coverage rejects:

```text
2024-11-05
2024-10-07
2099-01-01 (representative unknown future revision)
```

The unknown future revision produced the SDK/server unsupported-protocol error path instead of silently falling back to another era.

## Adapter composition

MCP-specific construction is isolated in the Gateway adapter.

The v2 SDK's era classifier is used rather than reimplementing protocol-era detection.

### Selected 2025 legacy revisions

Legacy Streamable HTTP requests are served through the v2 WebStandard Streamable HTTP transport in stateless mode with JSON responses enabled.

This deliberately preserves the verified Queqiao v1 behavior that used JSON responses for stateless Streamable HTTP. The generic v2 legacy shortcut was not used because its default response mode would have allowed an unnecessary JSON-to-SSE behavior change.

### 2026 modern revision

Modern `2026-07-28` requests use the v2 MCP handler with legacy fallback disabled. Modern negotiation and request handling therefore remain distinct from the 2025 compatibility path while both eras map to the same transport-neutral Queqiao tool runtime.

The MCP server's supported-protocol list is supplied explicitly from Queqiao configuration code rather than inherited from SDK defaults.

## Cancellation mapping

The v1 callback cancellation source was migrated to the v2 request context's sender-side cancellation signal. Worker/client request cancellation therefore continues to propagate through the existing Gateway tool context without adding MCP types to Worker protocol or Core execution packages.

## OAuth and Origin security updates

Authorization-code token exchange now requires the token request `resource` to match both:

- the resource bound into the one-time authorization code; and
- the configured Queqiao MCP resource URL.

Missing or mismatched token-request resource returns OAuth `invalid_target` after the authorization code has been consumed. Existing invalid-code/client/redirect/PKCE failures remain `invalid_grant`.

Refresh-token behavior was not broadened or tightened in this ticket beyond the existing verified contract.

The v2 Express MCP application now enforces explicit allowed Host and Origin hostname lists. Security tests prove:

- an unapproved MCP Origin is rejected with HTTP 403 before OAuth handling;
- an approved ChatGPT Origin passes the Origin gate and, without a bearer token, reaches the expected OAuth HTTP 401 path.

The same boundary was verified through the public shadow HTTPS endpoint.

CIMD URL fetching was not added. The existing Dynamic Client Registration path remains available for verified clients; introducing metadata-URL retrieval would require a separate outbound-request/SSRF security design.

## Automated compatibility matrix

Automated contract coverage performs a complete OAuth registration/authorization/token flow against an isolated Gateway/Worker fixture and then validates exact protocol negotiation plus the same Revision 4 tool runtime.

Positive cases:

| Revision | Expected era | Result |
|---|---|---|
| `2025-03-26` | legacy | PASS |
| `2025-06-18` | legacy | PASS |
| `2025-11-25` | legacy | PASS |
| `2026-07-28` | modern | PASS |

For every positive case, the test verifies exact negotiated revision, `tools/list`, and a bounded `workspace_info` call.

Negative cases:

| Revision | Expected | Result |
|---|---|---|
| `2024-11-05` | unsupported | PASS |
| `2024-10-07` | unsupported | PASS |
| `2099-01-01` | unsupported future revision | PASS |

The existing end-to-end Gateway test was also migrated to the v2 client and explicitly pinned to `2025-11-25` legacy mode to prove the frozen Revision 4 OAuth/tool loop still works through the legacy compatibility path.

## Repository verification

After the final dependency cleanup, the implementation worktree completed:

```text
npm run typecheck
npm test
npm run test:security
npm run test:cluster
npm run security:gate
npm run build:package
git diff --check
```

Final observed results:

- typecheck: PASS;
- full Vitest suite: 21 test files / 71 tests PASS;
- Security Baseline suite: 14 test files / 52 tests PASS;
- Gateway/Worker cluster suite: 4 test files / 13 tests PASS;
- runtime dependency audit: 0 reported vulnerabilities;
- self-contained package build: PASS;
- no monolithic v1 SDK package remains in the package lock;
- smoke-client scripts parse successfully with v2 imports.

The expected invalid-YAML reload diagnostic and the deliberately exercised unsupported-future-protocol error appear in test output while their tests pass; they are not release-gate failures.

## Shadow deployment safety

Before the first v2 shadow Gateway replacement:

- stable local health returned HTTP 200;
- stable public health returned HTTP 200;
- shadow Windows and WSL Workers returned HTTP 200;
- the current working shadow Gateway bundle was copied to an external rollback location outside the repository;
- process identity for the shadow Gateway was verified before stopping it.

Only the shadow Gateway was stopped. Shadow Workers, the stable Gateway, stable Workers, and the stable public listener were not restarted or replaced.

While the shadow Gateway was stopped:

- stable local health remained HTTP 200;
- stable public health remained HTTP 200;
- shadow Windows and WSL Workers remained HTTP 200.

The v2 candidate Gateway then started successfully and reported both Windows and WSL environments online. After replacement:

- stable local health: HTTP 200;
- stable public health: HTTP 200;
- shadow public health: HTTP 200;
- shadow Windows Worker: HTTP 200;
- shadow WSL Worker: HTTP 200.

The pre-v2 rollback bundle was not needed.

After the v2 shadow Gateway was online, the existing stable ChatGPT Queqiao Revision connector successfully executed `list_workspaces` and returned both native environments online. This is direct evidence that the active stable collaboration path was not lost during the candidate replacement.

## Public shadow OAuth/MCP acceptance

A local official v2 SDK client was driven through the public shadow HTTPS/Funnel endpoint rather than directly against localhost.

The test performed:

1. Dynamic Client Registration;
2. OAuth Authorization Code + PKCE authorization;
3. token exchange with the exact MCP resource;
4. authenticated public MCP connection;
5. exact protocol negotiation;
6. `tools/list`;
7. bounded `list_workspaces` invocation.

It passed for both:

- `2025-11-25` legacy;
- `2026-07-28` modern.

Both eras exposed the same 10 frozen Revision 4 public tools.

The approval secret was read only inside the local acceptance process and was not printed or stored in repository artifacts. The temporary acceptance script was removed immediately after execution.

A separate public boundary probe also proved attacker Origin => 403 and approved ChatGPT Origin without bearer token => OAuth 401.

## Final clean-build observation

After removing the last unused monolithic-v1 dependency declarations, all verification gates were rerun. The final clean package build produced a Gateway bundle with the exact same SHA-256 as the v2 bundle already running successfully in the shadow stack.

Because the artifact was byte-identical, the shadow Gateway was intentionally not restarted a second time merely for ceremony. Avoiding a no-value restart is consistent with the blue/green delivery rule that unnecessary service interruption must not be introduced.

## Acceptance conclusion

The MCP adapter compatibility implementation ticket is satisfied:

- every selected revision has contract coverage;
- unsupported deprecated/future revisions fail explicitly;
- Core/runtime/policy/Workspace/process packages remain MCP-SDK independent;
- remote Streamable HTTP(S) remains the only supported client transport;
- Revision 4 public tool schemas are unchanged;
- OAuth resource binding and Origin validation are stronger and tested;
- the candidate passes through the public shadow endpoint while the stable connector remains usable.

The remaining blue/green Gate A item is a **separate real ChatGPT connector binding to the shadow endpoint**. This cannot be substituted by the SDK acceptance above. The existing stable connector must remain unchanged when that binding is created.
