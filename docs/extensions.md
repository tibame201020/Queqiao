# Queqiao Extensions

Queqiao extensions add Worker-hosted tools without changing the Gateway/Worker trust boundary. An extension is a normal JavaScript/TypeScript package with a declarative `queqiao` manifest in `package.json` and one compiled module exported by that manifest.

The intended workflow is deliberately LLM-friendly: describe the tool you want, ask an LLM to generate a small extension package from this contract, review the declared capabilities and implementation, build it, then install the local directory with the Queqiao CLI.

## Install sources

Queqiao supports two Extension Hub sources:

```powershell
# Published package. Queqiao installs a managed copy with npm lifecycle scripts disabled.
queqiao extension install npm:@scope/my-extension

# Local development package. Queqiao references the canonical directory in place.
queqiao extension install C:\Users\me\Documents\codes\my-extension
queqiao extension install .\my-extension
```

A local install does **not** copy the package, run `npm install`, run build scripts, or delete the source during uninstall. The package must already be prepared: its `package.json` must exist and its declared `queqiao.module` must resolve to a built file inside that package directory.

Install and Worker attachment are separate operations:

```powershell
queqiao extension install .\my-extension
queqiao extension attach dev.example.my-extension --worker windows

# Or install and attach in one command.
queqiao extension install .\my-extension --worker windows

queqiao extension list
queqiao extension show dev.example.my-extension
queqiao doctor extension
```

A running Worker hot-reloads attachment changes. Detaching removes the capability from that
Worker. Uninstalling a local extension removes only the Hub registration; it never removes the
user-owned source directory. In an interactive terminal, `attach`, `detach`, `show`, and
`uninstall` may omit the extension id and select from the installed Hub inventory; scripts and
`--json` flows should pass explicit identifiers/selectors.

## Minimal package layout

```text
my-extension/
?? package.json
?? tsconfig.json
?? src/
?? ?? index.ts
?? dist/
?? ?? index.js
?? node_modules/        # if the runtime module has dependencies
```

The runtime package should contain only dependencies it actually needs. Queqiao itself does not run package lifecycle scripts for local extensions. For extension development against a Queqiao source checkout before the corresponding SDK types are published, use a dev-only file dependency such as `npm install -D ..\\Queqiao`; do not add Queqiao as a runtime dependency unless the extension actually imports it at runtime.

## `package.json` contract

`package.json` is inspected before extension code is loaded. The package version and manifest version must match. `module` must start with `./` and resolve to a file contained by the package directory.

```json
{
  "name": "my-queqiao-extension",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@tibame201020/queqiao": "<matching Queqiao release>",
    "typescript": "^7.0.0"
  },
  "queqiao": {
    "apiVersion": 1,
    "module": "./dist/index.js",
    "manifest": {
      "id": "dev.example.my-extension",
      "version": "1.0.0",
      "displayName": "My Extension",
      "host": { "kind": "worker" },
      "ordering": {
        "requires": [],
        "before": [],
        "after": []
      },
      "contributions": [
        {
          "operation": "register",
          "tool": "count_lines",
          "visibility": "public",
          "title": "Count lines",
          "description": "Count lines in one UTF-8 file inside the selected Workspace.",
          "inputSchema": {
            "type": "object",
            "properties": {
              "workspaceId": { "type": "string", "minLength": 1, "maxLength": 64 },
              "path": { "type": "string", "minLength": 1, "maxLength": 4096 }
            },
            "required": ["workspaceId", "path"]
          },
          "requiredCapabilities": ["workspace:read"],
          "risk": "read",
          "annotations": {
            "readOnlyHint": true,
            "destructiveHint": false,
            "openWorldHint": false,
            "idempotentHint": true
          }
        }
      ]
    }
  }
}
```

The manifest is the pre-execution authority contract. It is not documentation-only metadata. The Worker uses it to constrain what the extension may do.

## Runtime module

Use the public extension types. Type-only imports do not create a runtime dependency on Queqiao. The runtime receives a capability object already bounded to the selected Workspace and to the tool's declared capability ceiling.

```ts
import { z } from "zod";
import type {
  QueqiaoExtension,
  WorkerExtensionContext,
} from "@tibame201020/queqiao/extension";

const inputSchema = z.object({
  workspaceId: z.string().min(1).max(64),
  path: z.string().min(1).max(4096),
});

const extension = {
  manifest: {
    id: "dev.example.my-extension",
    version: "1.0.0",
    displayName: "My Extension",
  },
  activate(api) {
    api.registerTool({
      name: "count_lines",
      title: "Count lines",
      description: "Count lines in one UTF-8 file inside the selected Workspace.",
      inputSchema,
      requiredCapabilities: ["workspace:read"],
      risk: "read",
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
        idempotentHint: true,
      },
      async execute(input, context) {
        const { path } = inputSchema.parse(input);
        const result = await context.capabilities.readFile(path, 0, 1024 * 1024);
        const text = String((result as { content?: unknown }).content ?? "");
        return { lines: text ? text.split(/\r?\n/).length : 0 };
      },
    });
  },
} satisfies QueqiaoExtension<WorkerExtensionContext>;

export default extension;
```

The runtime registration and package manifest contribution must describe the same tool contract. An LLM can generate both from one tool specification, but they should be reviewed together.

## Worker capability surface

Installing and attaching an Extension explicitly expands the Worker trust boundary. Workspace policy has one Core gate for this model: the Core `extension` tool must be allowed for the selected Workspace. Once that gate is granted, a registered Extension capability is **not** re-authorized against its own capability name, the legacy Workspace profile, `requiredCapabilities`, or the Workspace command allowlist.

`WorkerExtensionContext.capabilities` remains available as a containment/resource helper surface:

- filesystem helpers stay rooted inside the selected Workspace and reject traversal/symlink/junction escape;
- process helpers keep cwd containment plus ProcessRunner timeout, cancellation, concurrency, and output bounds;
- registered Extension process execution does not consult the Core command allowlist;
- native unrestricted shell is not part of the public Extension SDK helper surface.

For registered capabilities, `requiredCapabilities`, `risk`, and annotations are contract metadata for discovery, review, UX, and auditing rather than a second authorization ceiling. The user makes the execution-risk decision when installing/attaching the Extension and granting Core `extension` access to the Workspace.

This trusted-authority rule applies to newly registered Extension capabilities. `extend` and `replace` contributions that participate in a Core tool invocation still run inside that Core tool's contract and Workspace policy envelope.

## Contribution operations

Manifest contributions support:

- `register`: add a new tool.
- `extend`: add a `before`, `after`, or `wrap` hook around an existing tool.
- `replace`: replace an existing tool while preserving its contract.

Start with `register` for user-created extensions. `extend` and `replace` are stronger composition mechanisms and should be used only when the extension really owns that integration behavior.

## Risk and annotations

Choose the narrowest accurate contract:

- `risk: "read"` for bounded observation only.
- `risk: "write"` when Workspace state may change.
- `risk: "execute"` when processes or external actions may be invoked.

Keep `requiredCapabilities`, `risk`, and annotations consistent with the implementation. Do not mark a mutating tool as read-only to make it easier to invoke.

## Build and local dogfood

A typical TypeScript package can use:

```powershell
npm install
npm run build
queqiao extension install . --worker windows
queqiao extension show dev.example.my-extension
queqiao doctor extension
```

During development, edit the local package and rebuild its declared module. Because the Hub stores the canonical local path, it does not need a registry or package copy. Rebuilding the module does not by itself trigger a Worker reload: use `queqiao extension detach <id> --worker <name>` followed by `queqiao extension attach <id> --worker <name>`, or restart that Worker, to load the rebuilt module. Attachment/config reload remains generation-safe.

If the manifest identity or version changes, detach/uninstall the old Hub entry and install the new package identity/version explicitly.

## Prompt template for an LLM

You can give an LLM this repository's `docs/extensions.md` and a requirement such as:

> Create a Queqiao Worker extension named `dev.example.todo` that reads and updates a `todo.json` file inside the selected Workspace. Use only the public `@tibame201020/queqiao/extension` types. Declare the narrowest required Workspace capabilities, keep package manifest contributions synchronized with runtime tool definitions, do not use unrestricted shell commands, include build/test scripts, and make the package installable with `queqiao extension install <local-path>`.

When reviewing generated code, verify at minimum:

1. The package and manifest versions match.
2. `queqiao.module` stays inside the package.
3. Every runtime tool has a matching manifest contribution.
4. Capability/risk declarations match actual behavior.
5. Treat install/attach plus Workspace `extension` access as the explicit trust grant; registered capabilities are not constrained by the Core command allowlist.
6. No secrets, credentials, absolute user paths, or automatic network actions are embedded in the package.
7. `queqiao doctor extension` passes after installation.

## Git extension example

The first-party Git extension uses manifest id `dev.queqiao.git`. It is intentionally external to the Worker core and is a useful reference for a multi-tool trusted extension that combines Workspace-contained filesystem helpers with bounded native Git process execution.
