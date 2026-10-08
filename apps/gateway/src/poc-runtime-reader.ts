export type MarkerAcceptance = {
  environmentId: string;
  path: string;
  marker: string;
};

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

  let read: unknown;
  try {
    read = JSON.parse(text);
  } catch {
    throw new Error("Invalid MCP read_file result");
  }

  if (!read || typeof read !== "object") throw new Error("Invalid MCP read_file result");
  const file = read as { path?: unknown; text?: unknown };
  if (file.path !== expected.path) throw new Error("Unexpected read_file path");
  if (typeof file.text !== "string" || file.text.trim() !== expected.marker) {
    throw new Error("Worker marker mismatch");
  }

  return { workerRead: true, environmentId: routed };
}
