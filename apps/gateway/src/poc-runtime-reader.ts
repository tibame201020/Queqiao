export type MarkerAcceptance = {
  workspaceId: string;
  environmentId: string;
  path: string;
  marker: string;
};

// Matches the documented Queqiao MCP read_file output produced in
// apps/gateway/src/core-tools.ts; it is intentionally NOT JSON.
const READ_FILE_TEXT = /^Workspace: ([A-Za-z0-9._-]+)\nPath: ([^\r\n]+)\nLines: (\d+)-(\d+) of (\d+)\n\n([\s\S]*)$/;

export function assertEphemeralRead(
  response: unknown,
  expected: MarkerAcceptance,
): { workerRead: true; environmentId: string } {
  if (!response || typeof response !== "object") {
    throw new Error("MCP tool response is missing");
  }

  const data = response as {
    isError?: unknown;
    content?: Array<{ type?: unknown; text?: unknown }>;
    _meta?: { "dev.queqiao/routing"?: { environmentId?: unknown } };
  };

  if (data.isError === true) throw new Error("MCP read_file failed");

  const routed = data._meta?.["dev.queqiao/routing"]?.environmentId;
  if (typeof routed !== "string") throw new Error("MCP routing receipt is missing");
  if (routed !== expected.environmentId) throw new Error("Unexpected Worker environment");

  const text = data.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error("MCP result text is missing");

  const matched = READ_FILE_TEXT.exec(text);
  if (!matched) throw new Error("Invalid MCP read_file format");

  const [, workspace, path, startLine, endLine, totalLines, contents] = matched;
  if (workspace !== expected.workspaceId) throw new Error("Unexpected read_file workspace");
  if (path !== expected.path) throw new Error("Unexpected read_file path");
  if (Number(startLine) !== 1 || Number(endLine) !== 1 || Number(totalLines) < 1) {
    throw new Error("Unexpected read_file line range");
  }
  if (contents?.trim() !== expected.marker) throw new Error("Worker marker mismatch");

  return { workerRead: true, environmentId: routed };
}
