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
  timeoutMs: 30_000,
});

await session.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
const event = await session.next();
const finalState = await session.closed;
```

The Worker remains authoritative for:

- executable declaration and native PATH resolution;
- Workspace cwd containment, including symlink/junction escape rejection;
- the shared Worker process concurrency limit;
- request cancellation for the entire session lifetime;
- maximum process lifetime;
- bounded output and bounded individual stdin writes;
- process-tree termination and Worker shutdown cleanup.

The returned object is a bounded process session, not an unrestricted Node `ChildProcess` and not a durable Queqiao Job.

## Outbound HTTP

A registered Worker extension receives `context.runtime.http`:

```ts
const response = await context.runtime.http.request({
  url: "https://mcp.example.com/mcp",
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
  timeoutMs: 30_000,
});
```

The Worker remains authoritative for:

- exact-origin authorization;
- `http`/`https` scheme validation and rejection of embedded credentials;
- request timeout and request cancellation;
- bounded request and response bodies;
- bounded header count/value/response-header size;
- transport-owned headers such as `Host` and `Content-Length`;
- redirect handling.

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

Cancellation and timeout terminate the Worker-owned operation rather than returning a detached downstream process or request.

## External Extension SDK

External packages should import only public types:

```ts
import type {
  QueqiaoExtension,
  WorkerExtensionContext,
} from "@tibame201020/queqiao/extension";
```

They do not need private Worker types or imports from `@queqiao/*` source packages. The repository CI compiles an external-consumer fixture against the published `extension.d.ts` surface and exercises a registered Extension tool through Worker Protocol into the managed stdio runtime.

## Scope

This contract is for downstream transport I/O used by Worker-hosted registered Extension capabilities. It does not change the public Queqiao MCP manifest or the Gateway/Worker transport contract.

`extend` and `replace` contributions continue to execute inside the Core tool contract they extend or replace. The managed downstream runtime service is bound to registered Extension capability ownership rather than becoming a general Core escape hatch.
