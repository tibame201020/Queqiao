# MCP Compatibility Window Research — 2026-08-13

- Status: Resolved research input for the next MCP adapter implementation ticket
- Scope: remote HTTP(S) MCP only
- Current Queqiao SDK baseline: `@modelcontextprotocol/sdk@1.30.0`
- Recommended target SDK line: official TypeScript SDK v2 split packages, currently `2.0.0`

## Decision

The initial explicit Queqiao MCP compatibility window should be:

```text
2026-07-28
2025-11-25
2025-06-18
2025-03-26
```

Preference order is newest to oldest.

Queqiao should not advertise or intentionally serve `2024-11-05` or `2024-10-07` in this window, even though the currently installed v1 SDK lists those strings internally. Those revisions predate Streamable HTTP and require the deprecated HTTP+SSE transport for compatible remote operation. Adding the old SSE/POST endpoint pair would create an additional transport/security lifecycle that is not required by the Secure Agent Substrate architecture.

Unknown future revisions must not become supported merely because a later SDK release adds them. Queqiao owns the supported revision list and must pin it explicitly in adapter configuration/tests.

## Why the window starts at 2025-03-26

The MCP `2025-03-26` revision replaced the old HTTP+SSE transport from `2024-11-05` with Streamable HTTP. Its official backwards-compatibility guidance says servers wishing to support old clients should continue to host the old SSE and POST endpoints alongside the new MCP endpoint.

Queqiao's product boundary is a secured remote HTTP(S) MCP endpoint, and the current deployed contract is a single Streamable HTTP MCP endpoint. Supporting the 2024 transport revisions would therefore be a separate deprecated transport feature, not merely another protocol-version string.

`2025-03-26` is consequently the oldest revision that matches the selected remote transport model.

## Current v1.30.0 capability

Inspection of the exact installed `@modelcontextprotocol/sdk@1.30.0` artifact shows:

```text
LATEST_PROTOCOL_VERSION = 2025-11-25
DEFAULT_NEGOTIATED_PROTOCOL_VERSION = 2025-03-26
SUPPORTED_PROTOCOL_VERSIONS =
  2025-11-25
  2025-06-18
  2025-03-26
  2024-11-05
  2024-10-07
```

The public v1 server/client implementation performs the legacy `initialize` negotiation and rejects protocol-version headers outside that fixed list.

The installed package contains generated draft-2026 schema artifacts, but its actual public supported-version list does **not** include `2026-07-28`. Those generated files are not evidence that the v1 runtime can serve the modern protocol era.

Therefore the current Queqiao SDK can cover the selected three 2025 revisions but cannot satisfy the current `2026-07-28` revision.

## Current upstream SDK state

As checked on 2026-08-13, the npm registry reports:

```text
@modelcontextprotocol/sdk      1.30.0
@modelcontextprotocol/core     2.0.0
@modelcontextprotocol/server   2.0.0
@modelcontextprotocol/client   2.0.0
@modelcontextprotocol/node     2.0.0
@modelcontextprotocol/express  2.0.0
```

The official TypeScript SDK repository describes v2 as the stable release line shipped with the `2026-07-28` specification. The monolithic v1 package continues to receive a limited compatibility/security support period, but modern protocol support is in the v2 split packages.

The next adapter implementation ticket should therefore migrate the Gateway MCP adapter and its MCP client contract tests from `@modelcontextprotocol/sdk` v1 to the official v2 packages rather than patching v1 internals.

## Two protocol eras that must coexist

The official v2 SDK describes two behavior families.

### 2025 legacy era

Applies to the selected:

- `2025-03-26`
- `2025-06-18`
- `2025-11-25`

Properties relevant to Queqiao:

- connection begins with `initialize` / `initialized`;
- protocol/client capability state is negotiated during initialization;
- Streamable HTTP may use an `Mcp-Session-Id`, but a server may also be stateless;
- cancellation is represented by `notifications/cancelled`;
- later HTTP requests identify the negotiated revision using `MCP-Protocol-Version` according to the applicable revision;
- server/client requests and notifications use the legacy bidirectional model.

### 2026 modern era

Applies initially to:

- `2026-07-28`

Properties relevant to Queqiao:

- `initialize` / `initialized` is removed;
- protocol-level sessions and `Mcp-Session-Id` are removed;
- each request is self-describing with protocol/client metadata;
- `server/discover` can advertise supported protocol versions/capabilities before normal calls;
- method/tool routing metadata is exposed in HTTP headers such as `Mcp-Method` and `Mcp-Name`;
- cancellation for Streamable HTTP is tied to closing the request response stream rather than sending the legacy cancellation notification;
- server-to-client interaction semantics use the modern multi-round-trip model;
- list responses may carry cache hints.

Queqiao Core tool/runtime semantics must remain independent of these differences. The MCP adapter is responsible for mapping both eras to the same transport-neutral tool runtime.

## Why v2 fits Queqiao's current server shape

Queqiao currently creates a fresh `McpServer` and a `StreamableHTTPServerTransport` for each authenticated POST request. It does not configure a session ID generator or maintain a shared MCP session store.

The official v2 migration guide states that a v1 stateless Streamable HTTP setup maps directly to the v2 `createMcpHandler(factory)` path. That handler can serve `2026-07-28` and, by default, also serve the 2025 legacy era through the stateless compatibility path.

This means the SDK migration can stay at the MCP adapter/Gateway boundary. It does not justify adding sticky sessions, a distributed MCP session store, or MCP types to Core/Worker packages.

## Explicit version-pinning requirement

The v2 SDK exposes supported-protocol-version controls. Queqiao must use those controls so its public compatibility claim is a product contract rather than an SDK implementation accident.

The resolved list must be exactly the selected window for this release slice:

```text
[
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26"
]
```

Required behavior:

1. a selected revision succeeds using its defined era semantics;
2. `2024-11-05` and `2024-10-07` are rejected rather than silently mapped onto Streamable HTTP;
3. an unknown future date revision is rejected even if a future SDK understands it;
4. diagnostics expose this Queqiao-owned window rather than the SDK's raw default list;
5. an SDK upgrade cannot widen the window without an explicit Queqiao change and test update.

## Revision-specific compatibility requirements

### 2025-03-26

This is the first selected Streamable HTTP revision.

Tests must cover:

- legacy `initialize` negotiation;
- `tools/list` and one bounded `tools/call` through Streamable HTTP;
- JSON response handling used by Queqiao;
- no requirement for the deprecated HTTP+SSE endpoint pair;
- compatibility behavior when a later-request protocol header is absent must not be mistaken for a newer negotiated revision.

The specification allows an implementation without another way to identify the revision to assume `2025-03-26` when a subsequent HTTP request omits the protocol-version header. The adapter tests must make this fallback explicit rather than accidental.

### 2025-06-18

This revision removed JSON-RPC batching and tightened HTTP/authorization behavior. It also requires the negotiated protocol version to be sent in the `MCP-Protocol-Version` header on subsequent HTTP requests.

Tests must cover:

- successful initialize/list/call with `MCP-Protocol-Version: 2025-06-18`;
- rejection/defined fallback behavior for malformed or unsupported version headers;
- OAuth Protected Resource Metadata discovery;
- RFC 8707 resource binding for authorization/token requests and access-token audience.

### 2025-11-25

This revision retains the legacy initialize/session era but adds/clarifies several interoperability and security requirements relevant to Queqiao:

- OAuth authorization-server discovery may use RFC 8414 or OpenID Connect Discovery;
- Protected Resource Metadata is required for MCP authorization discovery;
- OAuth Client ID Metadata Documents (CIMD) become the recommended client-registration mechanism, while Dynamic Client Registration remains allowed for backwards compatibility;
- insufficient-scope challenges support incremental consent;
- invalid `Origin` on Streamable HTTP must return HTTP 403;
- JSON Schema 2020-12 becomes the default schema dialect.

Queqiao already exposes RFC 8414 authorization-server metadata and RFC 9728 protected-resource metadata, and it already returns an `iss` parameter on the authorization callback. DCR must remain available for the currently verified ChatGPT connector flow unless real-client acceptance proves another supported registration path.

CIMD support is **not** required to be added automatically in the adapter ticket because the specification uses SHOULD/MAY language rather than making it the only registration mechanism. Implementing CIMD on the authorization-server side would require safely fetching attacker-controlled HTTPS metadata URLs and therefore introduces a new outbound-request/SSRF trust boundary. If Queqiao later implements CIMD, it requires a dedicated security design and adversarial tests rather than an unreviewed compatibility shortcut.

### 2026-07-28

This is the current MCP specification revision as of this research date and is a breaking protocol era change.

Tests must cover:

- `server/discover` advertising the selected supported revision set/capabilities;
- direct modern request handling with `MCP-Protocol-Version: 2026-07-28`;
- required modern request metadata and header mapping;
- `tools/list` and one bounded `tools/call` against the same transport-neutral Queqiao tool runtime used by legacy requests;
- no `initialize` or `Mcp-Session-Id` dependency on the modern path;
- unsupported revision failure rather than legacy fallback;
- request cancellation/connection-close mapping at the adapter boundary;
- authorization behavior remaining valid before MCP era negotiation is attempted.

The adapter should not introduce modern-only MCP concepts into Worker protocol or Core tools.

## OAuth compatibility audit findings

The current Queqiao OAuth service already has several important properties:

- OAuth Authorization Code + PKCE S256;
- RFC 9728-style Protected Resource Metadata endpoints;
- RFC 8414 Authorization Server Metadata;
- exact redirect-origin/URI validation;
- `resource` validation on the authorization request;
- access/refresh tokens with issuer and resource audience binding;
- access token passed only in the Authorization header;
- `iss` added to the authorization redirect response;
- rotating refresh-token identity with reuse revocation;
- CSP callback-origin allowlisting preserved separately from MCP transport behavior.

The adapter implementation ticket must verify or close these gaps without weakening the existing stable path:

1. **Token endpoint resource parameter** — the current token handler binds issued tokens to the configured resource but does not require/validate the OAuth `resource` parameter on the authorization-code token request. The selected 2025 authorization specification requires Resource Indicators in both authorization and token requests. Candidate behavior must be tested against the shadow connector before any promotion because tightening this can expose client interoperability differences.
2. **Origin validation** — the selected Streamable HTTP revisions require invalid supplied origins to fail with HTTP 403. The v2 app/adapter configuration must have an explicit public-host Origin policy and security test; relying on incidental SDK defaults is insufficient.
3. **CIMD** — do not add generic metadata-URL fetching merely to claim 2025-11-25/2026 compatibility. Retain DCR for verified clients unless a separately reviewed CIMD security feature is implemented.
4. **2026 issuer/credential hardening** — preserve the existing `iss` response behavior and test authorization-server/resource binding through the v2 integration path.
5. **Scope evolution** — Queqiao currently exposes one connector-handshake scope, `queqiao:access`; Workspace authorization remains Worker policy. MCP incremental-scope features must not be used to duplicate or weaken that Worker-side authority model.

## Required implementation test matrix

The next ticket must produce automated adapter contract coverage at minimum for this matrix.

| Case | 2025-03-26 | 2025-06-18 | 2025-11-25 | 2026-07-28 |
|---|---:|---:|---:|---:|
| Supported/advertised explicitly | yes | yes | yes | yes |
| Remote Streamable HTTP | yes | yes | yes | yes |
| Legacy `initialize` | yes | yes | yes | no |
| Modern `server/discover` | no | no | no | yes |
| `tools/list` | pass | pass | pass | pass |
| bounded `tools/call` | pass | pass | pass | pass |
| protocol-version header behavior | explicit fallback case | required path | required path | required on request |
| OAuth protected-resource discovery | pass | pass | pass | pass |
| authenticated call | pass | pass | pass | pass |
| invalid Origin => 403 | security gate | security gate | security gate | security gate |
| cancellation mapping | legacy | legacy | legacy | modern stream close |

Negative matrix:

```text
2024-11-05        -> unsupported
2024-10-07        -> unsupported
unknown future    -> unsupported
malformed version -> unsupported / defined protocol error
```

The exact HTTP/JSON-RPC error shape should be asserted against the v2 SDK/spec behavior chosen by the adapter; tests must not merely assert that an exception occurred.

## Package migration requirements for the next ticket

The implementation ticket should replace Gateway/test imports from the monolithic v1 package with the smallest official v2 package set required by Queqiao, expected to include:

- `@modelcontextprotocol/server`;
- `@modelcontextprotocol/client` for contract/interoperability tests;
- `@modelcontextprotocol/node` for the Node HTTP adapter;
- `@modelcontextprotocol/express` where the Express application helpers are retained;
- `@modelcontextprotocol/core` only where required by the official v2 package dependency/API surface rather than as a blanket direct dependency.

Do not migrate MCP dependencies into `packages/contracts`, `packages/worker-protocol`, policy, Workspace, process runtime, or tool runtime.

The dependency upgrade must be isolated to the candidate worktree/shadow stack and must not rebuild the stable runtime artifact.

## Public-schema compatibility

Supporting multiple MCP protocol revisions is distinct from changing Queqiao's Core public tool manifest.

The adapter migration should initially expose the same Revision 4 tool names/input schemas across every supported MCP revision. A protocol-era migration alone must not be used as an excuse to introduce `run/shell` async schema changes or extension public tools.

This separation allows the MCP compatibility implementation to be verified and committed before a later intentional Core Manifest Revision.

## Real-client acceptance

Automated SDK contract tests are necessary but not sufficient.

After the v2 adapter is running on the isolated shadow endpoint:

1. the existing stable connector remains untouched and operational;
2. the separate shadow ChatGPT connector must complete OAuth, schema discovery, and bounded invocation;
3. at least one standard SDK client test must pin each selected revision;
4. later generic interoperability acceptance should include a real non-ChatGPT MCP client when available.

A client that does not yet support `2026-07-28` may negotiate a selected 2025 revision. That does not justify dropping current-spec support from Queqiao itself.

## Primary sources

Research used only official MCP specification/maintainer/SDK sources plus the exact locally installed SDK artifact and npm registry package metadata:

- MCP 2026-07-28 release: https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP 2025-03-26 transport: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
- MCP 2025-03-26 changelog: https://modelcontextprotocol.io/specification/2025-03-26/changelog
- MCP 2025-06-18 changelog: https://modelcontextprotocol.io/specification/2025-06-18/changelog
- MCP 2025-11-25 changelog: https://modelcontextprotocol.io/specification/2025-11-25/changelog
- MCP 2025-11-25 authorization: https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization
- TypeScript SDK v2 README: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md
- TypeScript SDK protocol-version guide: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/protocol-versions.md
- TypeScript SDK v1-to-v2 migration: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/upgrade-to-v2.md
- TypeScript SDK 2026 revision support: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/migration/support-2026-07-28.md

## Research acceptance conclusion

The research ticket is complete when this document is accepted into the implementation branch.

The next dependency-ordered ticket, **MCP adapter compatibility implementation**, has a concrete target:

1. migrate Gateway MCP adapter/tests to official TypeScript SDK v2;
2. pin exactly four supported revisions (`2025-03-26`, `2025-06-18`, `2025-11-25`, `2026-07-28`);
3. keep only the remote Streamable HTTP endpoint surface;
4. preserve Revision 4 public tool schemas across all revisions;
5. add the positive/negative compatibility matrix above;
6. close the token-resource and Origin-validation gaps through candidate-only security tests;
7. run the complete candidate/shadow validation lane before any promotion.
