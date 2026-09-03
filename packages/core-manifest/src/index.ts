import { z } from "zod";
import { MAX_TEXT_MUTATION_BYTES, extensionIdSchema, processExecutionModeSchema, toolNameSchema } from "@queqiao/contracts";
import { MAX_PROCESS_TIMEOUT_MS } from "@queqiao/process-runtime";
import type { ToolAnnotations, ToolCapability, ToolRisk } from "@queqiao/contracts";

export const QUEQIAO_CORE_MANIFEST_REVISION = 9 as const;

export type CorePublicToolContract = {
  name: string;
  title: string;
  description: string;
  inputSchema: z.ZodObject;
  requiredCapabilities: readonly ToolCapability[];
  risk: ToolRisk;
  annotations: ToolAnnotations;
};

export const workerTransportHintSchema = z.string().min(1).max(64).regex(/^[a-z][a-z0-9.-]*$/, "transport must be a lowercase protocol identifier").optional();

const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
  idempotentHint: true,
} as const;

export const CORE_PUBLIC_TOOL_CONTRACTS = {
  workspace_info: {
    name: "workspace_info", title: "Workspace information",
    description: "Show one configured workspace and its native environment. Omit workspaceId only when exactly one Workspace is available.",
    inputSchema: z.object({ workspaceId: z.string().min(1).max(64).optional(), transport: workerTransportHintSchema }), requiredCapabilities: ["workspace:read"], risk: "read", annotations: readAnnotations,
  },
  read_file: {
    name: "read_file", title: "Read text file",
    description: "Read UTF-8 text from a workspace-relative path in a configured workspace. Omit workspaceId only when exactly one Workspace is available.",
    inputSchema: z.object({ workspaceId: z.string().min(1).optional(), transport: workerTransportHintSchema, path: z.string().min(1).max(4096), offset: z.number().int().min(0).default(0), limit: z.number().int().min(1).max(5000).default(500) }),
    requiredCapabilities: ["workspace:read"], risk: "read", annotations: readAnnotations,
  },
  list_workspaces: {
    name: "list_workspaces", title: "List configured workspaces",
    description: "List only explicitly configured workspaces across Queqiao environments, including environment availability and safe deployment attestation.",
    inputSchema: z.object({}), requiredCapabilities: ["workspace:read"], risk: "read", annotations: readAnnotations,
  },
  open_workspace: {
    name: "open_workspace", title: "Open configured workspace",
    description: "Resolve a configured workspace ID in its native environment. Arbitrary filesystem paths are not accepted.",
    inputSchema: z.object({ workspaceId: z.string().min(1).max(64), transport: workerTransportHintSchema }), requiredCapabilities: ["workspace:read"], risk: "read", annotations: readAnnotations,
  },
  write_file: {
    name: "write_file", title: "Write text file",
    description: "Atomically create or replace a UTF-8 text file at a workspace-relative path.",
    inputSchema: z.object({ workspaceId: z.string().min(1).optional(), transport: workerTransportHintSchema, path: z.string().min(1).max(4096), content: z.string().max(MAX_TEXT_MUTATION_BYTES) }),
    requiredCapabilities: ["workspace:write"], risk: "write",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false, idempotentHint: true },
  },
  edit_file: {
    name: "edit_file", title: "Edit text file",
    description: "Atomically replace one unique exact text occurrence in a workspace file.",
    inputSchema: z.object({ workspaceId: z.string().min(1).optional(), transport: workerTransportHintSchema, path: z.string().min(1).max(4096), oldText: z.string().min(1).max(MAX_TEXT_MUTATION_BYTES), newText: z.string().max(MAX_TEXT_MUTATION_BYTES) }),
    requiredCapabilities: ["workspace:write"], risk: "write",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  run: {
    name: "run", title: "Run command",
    description: "Run one locally allowlisted executable without a shell in a configured coding workspace. mode defaults to sync; async returns after native process start and does not retain stdout/stderr.",
    inputSchema: z.object({ workspaceId: z.string().min(1).optional(), transport: workerTransportHintSchema, executable: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/), args: z.array(z.string().max(8192)).max(256).default([]), cwd: z.string().min(1).max(4096).default("."), timeoutMs: z.number().int().min(100).max(MAX_PROCESS_TIMEOUT_MS).default(30_000), mode: processExecutionModeSchema.default("sync") }),
    requiredCapabilities: ["workspace:exec"], risk: "execute",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  shell: {
    name: "shell", title: "Run native shell",
    description: "Run a command through the workspace environment's native shell. This high-risk tool must be explicitly enabled for a coding workspace. mode defaults to sync; async returns after native process start and does not retain stdout/stderr.",
    inputSchema: z.object({ workspaceId: z.string().min(1).optional(), transport: workerTransportHintSchema, shell: z.enum(["default", "bash", "powershell", "cmd", "git-bash"]).default("default"), command: z.string().min(1).max(32_768).refine((value) => !value.includes("\0"), "command must not contain NUL"), cwd: z.string().min(1).max(4096).default("."), timeoutMs: z.number().int().min(100).max(MAX_PROCESS_TIMEOUT_MS).default(30_000), mode: processExecutionModeSchema.default("sync") }),
    requiredCapabilities: ["workspace:exec"], risk: "execute",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  extension: {
    name: "extension", title: "Extension proxy",
    description: "Discover and invoke capabilities exposed by trusted Queqiao extensions without changing the public MCP manifest for each installed extension. The selected Workspace and target capability remain Worker-authoritative.",
    inputSchema: z.object({
      workspaceId: z.string().min(1).max(64).optional(),
      transport: workerTransportHintSchema,
      operation: z.enum(["list", "search", "describe", "call"]),
      extensionId: extensionIdSchema.optional(),
      capability: toolNameSchema.optional(),
      query: z.string().min(1).max(256).optional(),
      arguments: z.record(z.string(), z.unknown()).default({}),
      limit: z.number().int().min(1).max(50).default(20),
    }),
    requiredCapabilities: ["workspace:read"], risk: "execute",
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  },
  list_directory: {
    name: "list_directory", title: "List directory",
    description: "List bounded workspace-relative directory entries. Omit workspaceId only when exactly one Workspace is available.",
    inputSchema: z.object({ workspaceId: z.string().min(1).max(64).optional(), transport: workerTransportHintSchema, path: z.string().min(1).max(4096).default("."), depth: z.number().int().min(1).max(5).default(1), limit: z.number().int().min(1).max(1000).default(500), cursor: z.string().max(128).optional(), includeHidden: z.boolean().default(false) }),
    requiredCapabilities: ["workspace:read"], risk: "read", annotations: readAnnotations,
  },
  search_text: {
    name: "search_text", title: "Search text",
    description: "Search for a literal string in bounded UTF-8 workspace files. Omit workspaceId only when exactly one Workspace is available.",
    inputSchema: z.object({ workspaceId: z.string().min(1).max(64).optional(), transport: workerTransportHintSchema, query: z.string().min(1).max(4096), path: z.string().min(1).max(4096).default("."), globs: z.array(z.string().min(1).max(256)).max(32).default([]), maxResults: z.number().int().min(1).max(500).default(100), caseSensitive: z.boolean().default(false), timeoutMs: z.number().int().min(100).max(30_000).default(10_000) }),
    requiredCapabilities: ["workspace:read"], risk: "read", annotations: readAnnotations,
  },
} as const satisfies Record<string, CorePublicToolContract>;

export type CorePublicToolName = keyof typeof CORE_PUBLIC_TOOL_CONTRACTS;
export const CORE_PUBLIC_TOOL_ORDER = ["workspace_info", "read_file", "list_workspaces", "open_workspace", "write_file", "edit_file", "run", "shell", "extension", "list_directory", "search_text"] as const satisfies readonly CorePublicToolName[];
export const CORE_PUBLIC_TOOLS: readonly CorePublicToolContract[] = Object.freeze(CORE_PUBLIC_TOOL_ORDER.map((name) => CORE_PUBLIC_TOOL_CONTRACTS[name]));
