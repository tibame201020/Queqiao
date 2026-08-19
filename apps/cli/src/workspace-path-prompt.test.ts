import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { completeDirectoryInput } from "./workspace-path-prompt.js";

describe("workspace path Tab completion", () => {
  it("completes a unique directory match and appends a separator", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-path-tab-"));
    const documents = path.join(root, "Documents");
    await mkdir(documents);
    await mkdir(path.join(root, "Downloads"));
    expect(completeDirectoryInput(path.join(root, "Doc"))).toBe(`${documents}${path.sep}`);
  });

  it("extends to the longest common prefix for multiple matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-path-tab-common-"));
    await mkdir(path.join(root, "ProjectAlpha"));
    await mkdir(path.join(root, "ProjectAlpine"));
    expect(completeDirectoryInput(path.join(root, "Pro"))).toBe(path.join(root, "ProjectAlp"));
  });

  it("leaves input unchanged when nothing matches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-path-tab-none-"));
    const input = path.join(root, "Missing");
    expect(completeDirectoryInput(input)).toBe(input);
  });
});
