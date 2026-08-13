export const QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
] as const;

export type QueqiaoSupportedMcpProtocolVersion = typeof QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS[number];
