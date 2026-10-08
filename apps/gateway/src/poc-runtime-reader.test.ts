import { describe, expect, it } from "vitest";
import { assertEphemeralRead } from "./poc-runtime-reader.js";

const expected = {
  workspaceId: "runtime",
  environmentId: "gha_123456789012345678901234",
  path: "poc-marker.txt",
  marker: "QUEQIAO-GITHUB-CONNECTOR-OK",
};

function response(value = expected.marker, extras: { path?: string; workspaceId?: string } = {}) {
  const path = extras.path ?? expected.path;
  const workspaceId = extras.workspaceId ?? expected.workspaceId;
  return {
    content: [{ type: "text", text: `Workspace: ${workspaceId}\nPath: ${path}\nLines: 1-1 of 2\n\n${value}` }],
    _meta: { "dev.queqiao/routing": { environmentId: expected.environmentId, selectedTransport: "websocket" } },
  };
}

describe("GitHub Actions Worker MCP short-task acceptance", () => {
  it("accepts the actual Queqiao read_file text format routed through the expected Worker", () => {
    expect(assertEphemeralRead(response(), expected)).toEqual({ workerRead: true, environmentId: expected.environmentId });
  });

  it("rejects a result from a different Worker even if the marker is correct", () => {
    const result = response();
    result._meta["dev.queqiao/routing"].environmentId = "windows";
    expect(() => assertEphemeralRead(result, expected)).toThrow(/Worker environment/i);
  });

  it("rejects a partial marker, an unexpected path and an unexpected workspace", () => {
    expect(() => assertEphemeralRead(response("QUEQIAO-GITHUB-CONNECTOR"), expected)).toThrow(/marker/i);
    expect(() => assertEphemeralRead(response(expected.marker, { path: "other.txt" }), expected)).toThrow(/path/i);
    expect(() => assertEphemeralRead(response(expected.marker, { workspaceId: "local" }), expected)).toThrow(/workspace/i);
  });

  it("rejects unstructured or injected extra output and any tool error", () => {
    expect(() => assertEphemeralRead({ ...response(), content: [{ type: "text", text: expected.marker }] }, expected)).toThrow(/format/i);
    expect(() => assertEphemeralRead(response(expected.marker + "\nEXTRA"), expected)).toThrow(/marker/i);
    expect(() => assertEphemeralRead({ ...response(), isError: true }, expected)).toThrow(/failed/i);
  });

  it("rejects absent routing receipt rather than inferring success", () => {
    expect(() => assertEphemeralRead({ content: response().content }, expected)).toThrow(/routing/i);
  });
});
