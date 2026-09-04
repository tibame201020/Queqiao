# Extension Runtime Services

Queqiao Worker extensions may need to speak downstream protocols such as MCP over native stdio or Streamable HTTP. Those transports must remain inside the Worker trust boundary: an extension must not create an unrestricted `child_process` or ad-hoc network path that bypasses Queqiao authority.

This document defines the public downstream runtime contract exported by `@tibame201020/queqiao/extension`.

## Authority model

Installing and attaching an Extension, plus allowing the Core `extension` tool for a Workspace, remains the user's trust grant for registered Extension capabilities. Downstream process/network access has an additional manifest-declared runtime envelope so the Worker can bound the transport itself.

If `manifest.runtime` is omitted, both downstream process and network access are denied.

```json
{
  "runtime": {
    "processes": {
      "allow": ["node", "python3"]
    },
    "outboundHttp": {
      "allowOrigins": [
        "https://mcp.example.com",
        "http://127.0.0.1:8123"
      ]
    }
  }
}
```

`processes.allow` contains executable basenames only. Paths, shell syntax, and arbitrary command strings are rejected. The Worker resolves the executable from its native `PATH` and always launches it with `shell: false`.

`outboundHttp.allowOrigins` contains exact `http` or `https` origins only. Credentials, paths, queries, fragments, and non-HTTP schemes are rejected. A grant for `https://mcp.example.com` permits URLs below that origin but does not permit another origin.

The runtime policy belongs to the Extension manifest that owns the registered tool. One Extension cannot obtain another Extension's process/network declaration by invoking its own registered capability.

## Managed stdio

A registered Worker extension receives `context.runtime.stdio`:

```ts
const session = await context.runtime.stdio.open({
  executable: "node",
  args: ["dist/server.js"],
  cwd: ".",
  timeoutMs: null,
});

await session.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
const event = await session.next();
await session.close();
```

`timeoutMs` has two deliberate modes:

- a numeric value creates a finite managed session and remains limited by the Worker process timeout ceiling;
- `null` creates a lifecycle-bound session for long-lived transports such as a local MCP server. It remains alive until explicit `close()`, an explicit session `signal`, an I/O/resource bound, process exit, or Worker shutdown.

A lifecycle-bound session does **not** implicitly inherit the current tool invocation's `context.signal`. This matters for cached downstream MCP clients: the transport must not die merely because the tool call that first created it completed. An extension that wants session-lifetime cancellation passes its own `signal` to `stdio.open()`.

The Worker remains authoritative for:

- executable declaration and native PATH resolution;
- Workspace cwd containment, including symlink/junction escape rejection;
- the shared Worker process concurrency limit for the entire session lifetime;
- explicit numeric session timeout when configured;
- explicit session cancellation;
- bounded output and bounded individual stdin writes;
- process-tree termination and Worker shutdown cleanup.

The returned object is a managed process session, not an unrestricted Node `ChildProcess` and not a durable Queqiao Job.

## Outbound HTTP

A registered Worker extension receives two HTTP surfaces.

### Buffered request

`http.request()` is the convenience API for finite buffered operations. It binds the current Extension invocation cancellation and applies an explicit request timeout.

```ts
const response = await context.runtime.http.request({
  url: "https://mcp.example.com/mcp",
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  timeoutMs: 30_000,
});
```

### Streaming fetch

`http.fetch()` is the fetch-compatible seam for protocol libraries that must consume a streaming response, including the official MCP `StreamableHTTPClientTransport`.

```ts
const transport = new StreamableHTTPClientTransport(
  new URL("https://mcp.example.com/mcp"),
  { fetch: context.runtime.http.fetch },
);
```

The Worker does not expose unrestricted global `fetch`. The injected function still enforces the owning Extension's exact-origin grant, HTTP method/header rules, request/response byte bounds, redirect policy, and a bounded stream lifetime. Cancellation comes from the `Request` / `RequestInit.signal` supplied for that individual fetch, so a cached MCP client does not retain the signal from the tool invocation that created it.

For both HTTP surfaces, the Worker remains authoritative for:

- exact-origin authorization;
- `http`/`https` scheme validation and rejection of embedded credentials;
- bounded request and response bodies;
- bounded header count/value/response-header size;
- transport-owned headers such as `Host` and `Content-Length`;
- redirect handling;
- operation/stream cancellation and lifetime bounds.

Redirects are deliberately not followed. A 3xx response fails with `extension_http_redirect_denied`, preventing an allowed origin from becoming an implicit grant to a second origin.

## Error behavior

Important Worker errors include:

| Code | Meaning |
| --- | --- |
| `extension_process_denied` | Executable is not declared by the owning Extension manifest. |
| `extension_network_denied` | HTTP origin is not declared by the owning Extension manifest. |
| `extension_runtime_unavailable` | The Worker process executor does not provide managed stdio. |
| `extension_http_redirect_denied` | The downstream endpoint attempted a redirect. |
| `extension_http_request_too_large` | Request body exceeded the Worker bound. |
| `extension_http_response_too_large` | Response body exceeded the Worker bound. |

Cancellation, explicit timeout, resource bounds, and Worker shutdown terminate Worker-owned transport resources instead of leaving detached processes or requests.

## External Extension SDK

External packages should import only public types:

```ts
import type {
  QueqiaoExtension,
  WorkerExtensionContext,
} from "@tibame201020/queqiao/extension";
```

They do not need private Worker types or imports from `@queqiao/*` source packages. Repository CI compiles an external ESM consumer against the published `extension.d.ts` surface with no Node global types loaded. Integration tests also run the official MCP client through both a public managed-stdio transport adapter and `StreamableHTTPClientTransport` with Worker-owned `http.fetch`.

## Scope

This contract is for downstream transport I/O used by Worker-hosted registered Extension capabilities. It does not change the public Queqiao MCP manifest or the Gateway/Worker transport contract.

`extend` and `replace` contributions continue to execute inside the Core tool contract they extend or replace. The managed downstream runtime service is bound to registered Extension capability ownership rather than becoming a general Core escape hatch.
