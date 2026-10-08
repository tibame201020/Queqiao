import { describe, expect, it } from "vitest";
import { assertEphemeralRead } from "./poc-runtime-reader.js";

const expected = {
  environmentId: "gha_123456789012345678901234",
  path: "poc-marker.txt",
  marker: "QUEQIAO-GITHUB-CONNECTOR-OK",
};

function response(text = "QUEQIAO-GITHUB-CONNECTOR-OK") {
  return {
    content: [{ type: "text", text: JSON.stringify({ path: expected.path, text }) }],
    _meta: { "dev.queqiao/routing": { environmentId: expected.environmentId, selectedTransport: "websocket" } },
  };
}

describe("GitHub Actions Worker MCP short-task acceptance", () => {
  it("accepts an exact marker read routed through the target ephemeral Worker", () => {
    expect(assertEphemeralRead(response(), expected)).toEqual({ workerRead: true, environmentId: expected.environmentId });
  });

  it("rejects a result from a different Worker even if the marker is correct", () => {
    const result = response();
    result._meta["dev.queqiao/routing"].environmentId = "windows";
    expect(() => assertEphemeralRead(result, expected)).toThrow(/Worker environment/i);
  });

  it("rejects partial marker, an unexpected file path and tool errors", () => {
    expect(() => assertEphemeralRead(response("QUEQIAO-GITHUB-CONNECTOR"), expected)).toThrow(/marker/i);
    expect(() => assertEphemeralRead({
      ...response(),
      content: [{ type: "text", text: JSON.stringify({ path: "other.txt", text: expected.marker }) }],
    }, expected)).toThrow(/path/i);
    expect(() => assertEphemeralRead({ ...response(), isError: true }, expected)).toThrow(/failed/i);
  });

  it("rejects absent routing receipt rather than guessing successful execution", () => {
    expect(() => assertEphemeralRead({ content: response().content }, expected)).toThrow(/routing/i);
  });
});
