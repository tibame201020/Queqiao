export const V0_TOOL_NAMES = ["workspace_info", "read_file"] as const;

export const V0_TOOL_CONTRACT = {
  workspace_info: {
    required: [] as const,
    optional: [] as const,
  },
  read_file: {
    required: ["path"] as const,
    optional: ["offset", "limit"] as const,
  },
} as const;

export const MULTI_WORKSPACE_TOOL_NAMES = [
  "workspace_info",
  "read_file",
  "list_workspaces",
  "open_workspace",
] as const;
