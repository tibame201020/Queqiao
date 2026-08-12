import { describe, expect, it } from "vitest";
import { canonicalize, digestCanonicalRequest } from "./index.js";

describe("canonical request digest", () => {
  it("is independent of object key insertion order", () => {
    const first = { tool: "run", arguments: { cwd: ".", executable: "git", args: ["status"] } };
    const second = { arguments: { args: ["status"], executable: "git", cwd: "." }, tool: "run" };

    expect(canonicalize(first)).toBe(canonicalize(second));
    expect(digestCanonicalRequest(first)).toBe(digestCanonicalRequest(second));
  });

  it("changes when any approved argument changes", () => {
    const approved = digestCanonicalRequest({
      tool: "run",
      arguments: { command: "git", args: ["status"] },
    });
    const substituted = digestCanonicalRequest({
      tool: "run",
      arguments: { command: "git", args: ["push", "--force"] },
    });

    expect(substituted).not.toBe(approved);
  });

  it("rejects non-portable numeric values", () => {
    expect(() => canonicalize({ timeout: Number.POSITIVE_INFINITY })).toThrow(TypeError);
  });
});
